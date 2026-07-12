import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { OAuthService } from '../../security/oauth.js';

// --------------------------------------------------------------------------
// Augment Fastify's Request type so handlers can access `request.user`
// when a valid JWT is present.
// --------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      login: string;
      avatarUrl: string | null;
      provider: string;
    };
  }
}

// --------------------------------------------------------------------------
// SWARM_AUTH_TOKEN guard (legacy API token, not JWT)
// --------------------------------------------------------------------------

/**
 * Opt-in bearer-token auth (F8.T2). When `SWARM_AUTH_TOKEN` is set, every
 * `/api/*` request must carry `Authorization: Bearer <token>` (or `?token=` for
 * the WS upgrade, which cannot set headers). When unset (default, local
 * single-user) it is a no-op — no speculative session/RBAC machinery (§1.2).
 *
 * Constant-time compare avoids leaking the token length/prefix via timing.
 */
export function makeAuthHook(token: string | undefined) {
  if (!token) return undefined; // auth disabled

  const expected = Buffer.from(`Bearer ${token}`);

  return function authHook(request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void {
    // Only guard the API + WS surface; /health and static assets stay open.
    const url = request.url.split('?')[0];
    if (!url.startsWith('/api/') && url !== '/ws') return done();

    const header = request.headers['authorization'];
    const queryToken = (request.query as { token?: string } | undefined)?.token;
    const presented = header ?? (queryToken ? `Bearer ${queryToken}` : '');
    const presentedBuf = Buffer.from(presented);
    // crypto.timingSafeEqual throws on length mismatch — guard length first.
    if (presentedBuf.length !== expected.length || !timingSafeEqual(presentedBuf, expected)) {
      reply.status(401).send({ error: 'Unauthorized' });
      return;
    }
    return done();
  };
}

// --------------------------------------------------------------------------
// Optional JWT user hook
// --------------------------------------------------------------------------

/**
 * Optional JWT-aware hook. If a valid JWT is present in the
 * `Authorization: Bearer <jwt>` header, it decodes it and attaches
 * `request.user`. This hook never blocks requests — it's purely additive
 * so that downstream handlers can optionally use `request.user`.
 *
 * Compatible with SWARM_AUTH_TOKEN: if both are active, this runs after
 * the SWARM_AUTH_TOKEN guard and adds user info on top.
 */
export function makeJwtHook(oauthService: OAuthService) {
  return function jwtHook(request: FastifyRequest, _reply: FastifyReply, done: (err?: Error) => void): void {
    const authHeader = request.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const session = oauthService.verifySession(token);
      if (session) {
        request.user = {
          id: session.sub,
          login: session.login,
          avatarUrl: session.avatar_url,
          provider: session.provider,
        };
      }
    }
    // Always pass through — JWT is optional
    return done();
  };
}
