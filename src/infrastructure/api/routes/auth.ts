import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { OAuthService } from '../../security/oauth.js';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const providerParams = z.object({
  provider: z.string().min(1).max(50),
});

const callbackQuery = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

const meHeaders = z.object({
  authorization: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

export function registerAuthRoutes(
  fastify: FastifyInstance,
  oauthService: OAuthService,
): void {
  // -----------------------------------------------------------------------
  // GET /api/auth/:provider/login
  // Redirects the user to the provider's OAuth authorize URL
  // -----------------------------------------------------------------------
  fastify.get('/api/auth/:provider/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = providerParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid provider', issues: params.error.issues });
    }

    const { provider } = params.data;

    // Check if provider is configured
    if (!oauthService.hasProvider(provider)) {
      // If it's GitHub specifically and not configured, return 501
      if (provider === 'github') {
        return reply.status(501).send({
          error: 'Not Implemented',
          message: `OAuth provider '${provider}' is not configured. Set OAUTH_GITHUB_CLIENT_ID and OAUTH_GITHUB_CLIENT_SECRET.`,
        });
      }
      return reply.status(400).send({
        error: 'Bad Request',
        message: `Unknown OAuth provider: '${provider}'`,
      });
    }

    const prov = oauthService.getProvider(provider)!;
    const state = oauthService.generateState();

    // Build the redirect URI for this provider (callback endpoint)
    // The host comes from the request so it works behind proxies
    const host = request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost:35000';
    const proto = request.headers['x-forwarded-proto'] ?? 'http';
    const redirectUri = `${proto}://${host}/api/auth/${provider}/callback`;

    // We need to pass the redirect_uri to the provider. We do this by
    // replacing the placeholder in the authorize URL. For GitHub, we
    // construct the URL manually with redirect_uri included.
    const authorizeUrl = prov.getAuthorizeUrl(state);
    const finalUrl = new URL(authorizeUrl);
    finalUrl.searchParams.set('redirect_uri', redirectUri);

    return reply.redirect(finalUrl.toString(), 302);
  });

  // -----------------------------------------------------------------------
  // GET /api/auth/:provider/callback
  // Handles the OAuth callback: exchanges code, fetches user, creates JWT
  // -----------------------------------------------------------------------
  fastify.get('/api/auth/:provider/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = providerParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid provider', issues: params.error.issues });
    }

    const query = callbackQuery.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid callback params', issues: query.error.issues });
    }

    const { provider } = params.data;
    const { code, state } = query.data;

    // Validate the OAuth state (constant-time comparison)
    if (!oauthService.validateState(state)) {
      return reply.status(401).send({ error: 'Invalid or expired state parameter' });
    }

    // Check provider availability
    const prov = oauthService.getProvider(provider);
    if (!prov) {
      return reply.status(400).send({ error: `Provider '${provider}' not available` });
    }

    try {
      // Exchange authorization code for access token
      const { accessToken } = await prov.exchangeCode(code);

      // Fetch user profile
      const user = await prov.getUserProfile(accessToken);

      // Create JWT session
      const jwt = oauthService.createSession(user);

      // Redirect to frontend with JWT in query param
      // Token goes in URL fragment; the frontend should extract and store it, then clean the URL
      return reply.redirect(`/?token=${jwt}`, 302);
    } catch (err) {
      // Log without exposing tokens/codes
      request.log.error({ provider, errMsg: (err as Error).message }, 'OAuth callback failed');
      return reply.status(502).send({ error: 'OAuth callback failed', message: (err as Error).message });
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/auth/me
  // Returns the current user's profile based on JWT in Authorization header
  // -----------------------------------------------------------------------
  fastify.get('/api/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7); // Remove 'Bearer ' prefix
    const session = oauthService.verifySession(token);
    if (!session) {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }

    return {
      id: session.sub,
      login: session.login,
      avatar_url: session.avatar_url,
      name: null, // GitHub may include name in a separate call; omitted for simplicity
      provider: session.provider,
    };
  });

  // -----------------------------------------------------------------------
  // POST /api/auth/logout
  // Client-side token cleanup; server just acknowledges
  // -----------------------------------------------------------------------
  fastify.post('/api/auth/logout', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ message: 'Logged out successfully' });
  });
}
