import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Orquestrator } from '../../../application/orquestrator.js';
import type { SwarmEvent } from '../../../domain/events.js';
import type { TaskMetadata } from '../../../domain/task.js';

const taskIdParams = z.object({
  taskId: z.string().min(1).max(128),
});

// --- SSE Event Stream ---

export function registerEventRoutes(
  fastify: FastifyInstance,
  orquestrator: Orquestrator,
): void {
  // GET /api/events — SSE stream of all swarm events
  fastify.get('/api/events', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    reply.raw.write('event: connected\ndata: {}\n\n');

    const onStateChanged = () => {
      const latest = orquestrator.events.slice(-1)[0];
      if (latest) {
        const data = JSON.stringify(latest);
        if (!reply.raw.destroyed) {
          reply.raw.write(`event: event\ndata: ${data}\n\n`);
        }
      }
    };

    // Send current state on connect
    const state = [...orquestrator.tasks.values()].map((t) => orquestrator.toMetadata(t));
    const stateData = JSON.stringify({ tasks: state });
    if (!reply.raw.destroyed) {
      reply.raw.write(`event: state\ndata: ${stateData}\n\n`);
    }

    orquestrator.on('state:changed', onStateChanged);

    request.raw.on('close', () => {
      orquestrator.off('state:changed', onStateChanged);
    });

    // Keep connection alive
    const keepAlive = setInterval(() => {
      if (!reply.raw.destroyed) {
        reply.raw.write(': keepalive\n\n');
      }
    }, 15000);

    request.raw.on('close', () => {
      clearInterval(keepAlive);
    });

    // Never resolve — SSE is long-lived
    await new Promise<void>(() => {});
  });

  // GET /api/events/:taskId — SSE stream filtered by task
  fastify.get('/api/events/:taskId', async (request, reply) => {
    const params = taskIdParams.safeParse(request.params);
    if (!params.success) {
      reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
      return;
    }

    const { taskId } = params.data;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    reply.raw.write(`event: connected\ndata: {}\n\n`);

    // Send initial task state
    const task = orquestrator.tasks.get(taskId);
    if (task) {
      const metadata = JSON.stringify(orquestrator.toMetadata(task));
      if (!reply.raw.destroyed) {
        reply.raw.write(`event: state\ndata: ${metadata}\n\n`);
      }
    }

    const onStateChanged = () => {
      if (reply.raw.destroyed) return;
      // Filter events relevant to this task
      const relevant = orquestrator.events.filter(
        (e) => e.taskId === taskId || e.parentId === taskId,
      );
      const latest = relevant.slice(-1)[0];
      if (latest) {
        const data = JSON.stringify(latest);
        if (!reply.raw.destroyed) {
          reply.raw.write(`event: event\ndata: ${data}\n\n`);
        }
      }
    };

    orquestrator.on('state:changed', onStateChanged);

    request.raw.on('close', () => {
      orquestrator.off('state:changed', onStateChanged);
    });

    const keepAlive = setInterval(() => {
      if (!reply.raw.destroyed) {
        reply.raw.write(': keepalive\n\n');
      }
    }, 15000);

    request.raw.on('close', () => {
      clearInterval(keepAlive);
    });

    await new Promise<void>(() => {});
  });
}
