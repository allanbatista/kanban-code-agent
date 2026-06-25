import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

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
