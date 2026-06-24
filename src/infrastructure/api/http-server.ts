import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { Orquestrator } from '../../application/orquestrator.js';
import type { Logger } from '../logging/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerEventRoutes } from './routes/events.js';
import { registerReportRoutes } from './routes/reports.js';
import { registerWebSocket } from './ws-server.js';
import { ProjectFileStore } from '../persistence/project-file-store.js';

// --- Types ---

export interface ServerOptions {
  port?: number;
  host?: string;
  staticDir?: string;
  corsOrigins?: string[];
}

const DEFAULT_OPTIONS: Required<ServerOptions> = {
  port: 35000,
  host: '127.0.0.1',
  staticDir: '',
  corsOrigins: ['http://localhost:5173', 'http://localhost:8888', 'http://localhost:35000'],
};

// --- Version ---

let _version: string | undefined;

function readVersion(): string {
  if (_version) return _version;
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(__dirname, '../../../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    _version = pkg.version ?? '0.0.0';
  } catch {
    _version = '0.0.0';
  }
  return _version;
}

// --- Server Factory ---

export function createServer(
  orquestrator: Orquestrator,
  logger: Logger,
  options?: ServerOptions,
): FastifyInstance {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const fastify = Fastify({
    logger: false,
    trustProxy: true,
  });

  // --- Plugins ---

  fastify.register(cors, {
    origin: opts.corsOrigins,
    credentials: true,
    // Must be explicit: PATCH (move/update) and DELETE (cancel) are otherwise
    // omitted from the preflight allow-methods, so the browser blocks them.
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  if (opts.staticDir) {
    fastify.register(fastifyStatic, {
      root: opts.staticDir,
      prefix: '/',
    });
  }

  // --- Middleware ---

  fastify.addHook('onRequest', requestLogger(logger.child('http')));

  fastify.setErrorHandler((err, request, reply) => {
    const error = err as Error;
    logger.error('request error', error, {
      method: request.method,
      url: request.url,
    });
    errorHandler(error, request, reply);
  });

  // --- Health Check ---

  const startTime = Date.now();
  const version = readVersion();

  fastify.get('/health', async () => {
    const tasks = [...orquestrator.tasks.values()];
    const byStatus: Record<string, number> = {};
    for (const t of tasks) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    }
    return {
      status: 'ok',
      uptime: Date.now() - startTime,
      version,
      tasks: { total: tasks.length, byStatus },
      events: orquestrator.events.length,
    };
  });

  // --- Routes ---

  registerTaskRoutes(fastify, orquestrator);
  registerAgentRoutes(fastify, orquestrator);
  registerProjectRoutes(fastify, new ProjectFileStore(orquestrator.sandbox));
  registerSettingsRoutes(fastify);
  registerEventRoutes(fastify, orquestrator);
  registerReportRoutes(fastify, orquestrator);

  // The @fastify/websocket onRoute hook only tags routes registered AFTER the
  // plugin has loaded. Registering the plugin and the /ws route together in an
  // awaited encapsulated scope guarantees the route is recognized as a
  // websocket route (otherwise the handler is invoked as a plain HTTP GET).
  fastify.register(async (instance) => {
    await instance.register(websocket);
    registerWebSocket(instance, orquestrator);
  });

  // --- SPA fallback ---
  // Serve index.html for non-API routes so client-side routing works
  if (opts.staticDir) {
    fastify.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return fastify;
}

// --- Start Helper ---

export async function startServer(
  orquestrator: Orquestrator,
  logger: Logger,
  options?: ServerOptions,
): Promise<FastifyInstance> {
  const server = createServer(orquestrator, logger, options);
  const port = options?.port ?? DEFAULT_OPTIONS.port;
  const host = options?.host ?? DEFAULT_OPTIONS.host;

  await server.listen({ port, host });
  logger.info(`Server listening on http://${host}:${port}`);

  return server;
}
