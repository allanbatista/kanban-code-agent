import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import type { Orquestrator } from '../../application/orquestrator.js';
import { registerTaskRoutes } from '../../infrastructure/api/routes/tasks.js';
import { registerAgentRoutes } from '../../infrastructure/api/routes/agents.js';
import { registerProjectRoutes } from '../../infrastructure/api/routes/projects.js';
import { registerSettingsRoutes } from '../../infrastructure/api/routes/settings.js';
import { registerEventRoutes } from '../../infrastructure/api/routes/events.js';
import { registerReportRoutes } from '../../infrastructure/api/routes/reports.js';
import { ProjectFileStore } from '../../infrastructure/persistence/project-file-store.js';

// ---------------------------------------------------------------------------
// Build a real Fastify server for e2e testing (no listen, no static files)
// ---------------------------------------------------------------------------

export function buildServer(orquestrator: Orquestrator): FastifyInstance {
  const fastify = Fastify({ logger: false });

  fastify.register(cors, {
    origin: '*',
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Health check
  fastify.get('/health', async () => ({ status: 'ok' }));

  // Routes
  registerTaskRoutes(fastify, orquestrator);
  registerAgentRoutes(fastify, orquestrator);
  registerProjectRoutes(fastify, new ProjectFileStore(orquestrator.sandbox));
  registerSettingsRoutes(fastify);
  registerEventRoutes(fastify, orquestrator);
  registerReportRoutes(fastify, orquestrator);

  return fastify;
}
