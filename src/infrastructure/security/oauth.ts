import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthProvider {
  getAuthorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<{ accessToken: string }>;
  getUserProfile(accessToken: string): Promise<ProviderUser>;
}

export interface ProviderUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  provider: string;
}

interface StoredState {
  state: string;
  codeVerifier?: string;
  expiresAt: number; // ms timestamp
}

interface JwtPayload {
  sub: string;        // userId
  login: string;      // username
  avatar_url: string | null;
  provider: string;
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 10 * 60 * 1000;   // 10 minutes
const JWT_TTL_MS = 60 * 60 * 1000;      // 1 hour
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com/user';

// ---------------------------------------------------------------------------
// GitHub OAuth Provider
// ---------------------------------------------------------------------------

export class GitHubOAuthProvider implements OAuthProvider {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  getAuthorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: '', // será definido dinamicamente pelo callback route
      state,
      scope: 'read:user',
    });
    return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{ accessToken: string }> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
    });

    const res = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(`GitHub token exchange failed: ${res.status}`);
    }

    const data = (await res.json()) as { access_token?: string; error?: string };
    if (!data.access_token) {
      throw new Error(`GitHub token exchange error: ${data.error ?? 'unknown'}`);
    }

    return { accessToken: data.access_token };
  }

  async getUserProfile(accessToken: string): Promise<ProviderUser> {
    const res = await fetch(GITHUB_API_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json' },
    });

    if (!res.ok) {
      throw new Error(`GitHub API user fetch failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      id: number;
      login: string;
      name: string | null;
      avatar_url: string;
    };

    return {
      id: String(data.id),
      login: data.login,
      name: data.name,
      avatarUrl: data.avatar_url,
      provider: 'github',
    };
  }
}

// ---------------------------------------------------------------------------
// OAuth Service
// ---------------------------------------------------------------------------

export class OAuthService {
  private readonly providers = new Map<string, OAuthProvider>();
  private readonly states = new Map<string, StoredState>();
  private readonly jwtSecret: string;

  constructor() {
    // Read config from environment
    const sessionSecret = process.env.SWARM_SESSION_SECRET ?? randomBytes(32).toString('hex');
    this.jwtSecret = sessionSecret;

    // Register built-in providers if configured
    const githubClientId = process.env.OAUTH_GITHUB_CLIENT_ID;
    const githubClientSecret = process.env.OAUTH_GITHUB_CLIENT_SECRET;
    if (githubClientId && githubClientSecret) {
      this.providers.set('github', new GitHubOAuthProvider(githubClientId, githubClientSecret));
    }

    // Periodic cleanup of expired states (every 5 minutes)
    setInterval(() => this.cleanupExpiredStates(), 5 * 60 * 1000).unref();
  }

  // -----------------------------------------------------------------------
  // Provider access
  // -----------------------------------------------------------------------

  /** Returns the provider for the given name, or undefined if not configured. */
  getProvider(name: string): OAuthProvider | undefined {
    return this.providers.get(name);
  }

  /** Returns true if the named provider is registered. */
  hasProvider(name: string): boolean {
    return this.providers.has(name);
  }

  // -----------------------------------------------------------------------
  // State management
  // -----------------------------------------------------------------------

  /** Generates a cryptographically random state and stores it in memory. */
  generateState(): string {
    const state = randomBytes(32).toString('hex');
    this.states.set(state, {
      state,
      expiresAt: Date.now() + STATE_TTL_MS,
    });
    return state;
  }

  /**
   * Validates and consumes a state token using constant-time comparison
   * to prevent timing attacks.
   */
  validateState(state: string): boolean {
    const stored = this.states.get(state);
    if (!stored) return false;

    // Remove consumed state regardless of validity (one-time use)
    this.states.delete(state);

    // Check expiry
    if (Date.now() > stored.expiresAt) return false;

    // Constant-time comparison to prevent timing attacks
    const a = Buffer.from(stored.state);
    const b = Buffer.from(state);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /** Removes all expired states from memory. */
  private cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [key, stored] of this.states) {
      if (now > stored.expiresAt) {
        this.states.delete(key);
      }
    }
  }

  // -----------------------------------------------------------------------
  // JWT session management
  // -----------------------------------------------------------------------

  /** Creates a signed JWT session for the given provider user. */
  createSession(user: ProviderUser): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      sub: user.id,
      login: user.login,
      avatar_url: user.avatarUrl,
      provider: user.provider,
      iat: now,
      exp: now + Math.floor(JWT_TTL_MS / 1000),
    };

    return this.signJwt(payload as Record<string, unknown>);
  }

  /** Verifies and decodes a JWT. Returns null if invalid/expired. */
  verifySession(token: string): JwtPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [headerB64, payloadB64, signatureB64] = parts;

      // Verify signature
      const expectedSig = this.hmacSign(`${headerB64}.${payloadB64}`);
      const sigBuf = Buffer.from(signatureB64);
      const expectedBuf = Buffer.from(expectedSig);

      if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
        return null;
      }

      // Decode payload
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as JwtPayload;

      // Check expiry
      if (Date.now() / 1000 > payload.exp) return null;

      return payload;
    } catch {
      return null;
    }
  }

  /** Signs a JWT payload and returns the complete JWT string. */
  private signJwt(payload: Record<string, unknown>): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerB64 = this.base64url(JSON.stringify(header));
    const payloadB64 = this.base64url(JSON.stringify(payload));
    const signature = this.hmacSign(`${headerB64}.${payloadB64}`);
    return `${headerB64}.${payloadB64}.${signature}`;
  }

  private hmacSign(data: string): string {
    return createHmac('sha256', this.jwtSecret).update(data).digest('base64url');
  }

  private base64url(data: string): string {
    return Buffer.from(data).toString('base64url');
  }
}
