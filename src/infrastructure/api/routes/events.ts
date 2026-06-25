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

    const onEvent = (event: SwarmEvent) => {
      if (!reply.raw.destroyed) {
        const data = JSON.stringify(event);
        reply.raw.write(`event: event\ndata: ${data}\nid: ${event.seq}\n\n`);
      }
    };

    // Catch-up (F7.T5): EventSource auto-sends Last-Event-ID on reconnect; replay
    // everything missed during the disconnect before the live stream resumes.
    const lastEventId = Number(request.headers['last-event-id']);
    if (Number.isFinite(lastEventId) && lastEventId > 0) {
      for (const event of orquestrator.getEventsSince(lastEventId)) {
        if (reply.raw.destroyed) break;
        reply.raw.write(`event: event\ndata: ${JSON.stringify(event)}\nid: ${event.seq}\n\n`);
      }
    }

    // Send current state on connect
    const state = [...orquestrator.tasks.values()].map((t) => orquestrator.toMetadata(t));
    const stateData = JSON.stringify({ tasks: state });
    if (!reply.raw.destroyed) {
      reply.raw.write(`event: state\ndata: ${stateData}\n\n`);
    }

    orquestrator.on('event', onEvent);

    request.raw.on('close', () => {
      orquestrator.off('event', onEvent);
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

    // Catch-up scoped to this task before the live stream (F7.T5).
    const lastEventId = Number(request.headers['last-event-id']);
    if (Number.isFinite(lastEventId) && lastEventId > 0) {
      for (const event of orquestrator.getEventsSince(lastEventId, taskId)) {
        if (reply.raw.destroyed) break;
        reply.raw.write(`event: event\ndata: ${JSON.stringify(event)}\nid: ${event.seq}\n\n`);
      }
    }

    // Send initial task state
    const task = orquestrator.tasks.get(taskId);
    if (task) {
      const metadata = JSON.stringify(orquestrator.toMetadata(task));
      if (!reply.raw.destroyed) {
        reply.raw.write(`event: state\ndata: ${metadata}\n\n`);
      }
    }

    const onEvent = (event: SwarmEvent) => {
      if (reply.raw.destroyed) return;
      if (event.taskId === taskId || event.parentId === taskId) {
        const data = JSON.stringify(event);
        reply.raw.write(`event: event\ndata: ${data}\nid: ${event.seq}\n\n`);
      }
    };

    orquestrator.on('event', onEvent);

    request.raw.on('close', () => {
      orquestrator.off('event', onEvent);
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
