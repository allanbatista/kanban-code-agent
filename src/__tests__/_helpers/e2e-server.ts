import type { FastifyInstance } from 'fastify';
import type { Orquestrator } from '../../application/orquestrator.js';
import { createServer } from '../../infrastructure/api/http-server.js';
import { Logger } from '../../infrastructure/logging/logger.js';

// ---------------------------------------------------------------------------
// Build the REAL production Fastify app for e2e testing (HTTP + WS), silenced.
// Previously this built a bespoke HTTP-only app that skipped the WS route, so
// the e2e harness never exercised the real server. Delegating to createServer
// closes that gap (F0.T5) — inject-based tests hit the same code as production.
// ---------------------------------------------------------------------------

const silentLogger = new Logger('e2e', 'fatal');

export function buildServer(orquestrator: Orquestrator): FastifyInstance {
  return createServer(orquestrator, silentLogger, { corsOrigins: ['*'] });
}

/**
 * Build and listen on an ephemeral port — required for real WebSocket clients
 * (fastify.inject cannot perform the WS upgrade). Returns the base URL + a
 * close hook. Binds to 127.0.0.1:0 so the OS assigns a free port.
 */
export async function buildAndListen(
  orquestrator: Orquestrator,
): Promise<{ server: FastifyInstance; baseUrl: string; wsUrl: string; close: () => Promise<void> }> {
  const server = buildServer(orquestrator);
  await server.listen({ port: 0, host: '127.0.0.1' });
  const address = server.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  return {
    server,
    baseUrl,
    wsUrl,
    close: async () => {
      await server.close();
    },
  };
}
