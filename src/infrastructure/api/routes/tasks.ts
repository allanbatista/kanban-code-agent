import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Orquestrator } from '../../../application/orquestrator.js';
import type { Task, RuntimeConfig } from '../../../domain/task.js';
import { TASK_STATUS } from '../../../domain/types.js';

// --- Zod Schemas ---

const runtimeConfigSchema = z.object({
  model: z.enum(['fast', 'balanced', 'deep']).optional(),
  effort: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
});

const createTaskBody = z.object({
  message: z.string().min(1).max(10000),
  runtimeConfig: runtimeConfigSchema.optional(),
  attachmentPaths: z.array(z.string()).optional(),
  // false (default) → task parked in Inbox; true → sent to the Manager.
  execute: z.boolean().optional(),
});

const updateTaskBody = z.object({
  status: z.enum([
    TASK_STATUS.PENDING,
    TASK_STATUS.QUEUED,
    TASK_STATUS.RUNNING,
    TASK_STATUS.WAITING,
    TASK_STATUS.COMPLETED,
    TASK_STATUS.FAILED,
    TASK_STATUS.CANCELLED,
  ]).optional(),
  runtimeConfig: runtimeConfigSchema.optional(),
  // The only user-permitted reassignments: park in Inbox or send to the Manager.
  assignedTo: z.enum(['inbox', 'manager']).optional(),
});

const taskParams = z.object({
  taskId: z.string().min(1).max(128),
});

const listQuery = z.object({
  status: z.enum([
    TASK_STATUS.PENDING,
    TASK_STATUS.QUEUED,
    TASK_STATUS.RUNNING,
    TASK_STATUS.WAITING,
    TASK_STATUS.COMPLETED,
    TASK_STATUS.FAILED,
    TASK_STATUS.CANCELLED,
  ]).optional(),
});

// --- Helpers ---

function toTaskResponse(task: Task, orquestrator: Orquestrator) {
  const metadata = orquestrator.toMetadata(task);
  return {
    taskId: task.taskId,
    title: task.title,
    assignedTo: task.assignedTo,
    parentId: task.parentId,
    status: task.status,
    depth: task.depth,
    subtaskIds: task.subtaskIds,
    runtimeConfig: task.runtimeConfig,
    metadata,
    createdAt: task.metrics.startedAt ?? null,
    updatedAt: task.metrics.finishedAt ?? null,
  };
}

// --- Route Registration ---

export function registerTaskRoutes(
  fastify: FastifyInstance,
  orquestrator: Orquestrator,
): void {
  // GET /api/tasks — list all tasks
  fastify.get('/api/tasks', async (request, reply) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query', issues: query.error.issues });
    }

    const tasks = [...orquestrator.tasks.values()];
    const filtered = query.data.status
      ? tasks.filter((t) => t.status === query.data.status)
      : tasks;

    return {
      tasks: filtered.map((t) => toTaskResponse(t, orquestrator)),
      total: filtered.length,
    };
  });

  // GET /api/tasks/:taskId — get task detail
  fastify.get('/api/tasks/:taskId', async (request, reply) => {
    const params = taskParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }

    const task = orquestrator.tasks.get(params.data.taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    return toTaskResponse(task, orquestrator);
  });

  // POST /api/tasks — create new task
  fastify.post('/api/tasks', async (request, reply) => {
    const body = createTaskBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: body.error.issues });
    }

    const { message, runtimeConfig, attachmentPaths, execute } = body.data;

    try {
      const task = orquestrator.addTask({
        message,
        runtimeConfig: runtimeConfig as RuntimeConfig | undefined,
        attachmentPaths,
        execute,
      });
      reply.status(201);
      return toTaskResponse(task, orquestrator);
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to create task',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // PATCH /api/tasks/:taskId — update task status or config
  fastify.patch('/api/tasks/:taskId', async (request, reply) => {
    const params = taskParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }

    const body = updateTaskBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: body.error.issues });
    }

    const task = orquestrator.tasks.get(params.data.taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    // Reassignment (Inbox ⇄ Manager) is a distinct operation: it re-schedules.
    if (body.data.assignedTo) {
      try {
        const moved = orquestrator.moveTask(params.data.taskId, body.data.assignedTo);
        return toTaskResponse(moved, orquestrator);
      } catch (error) {
        return reply.status(400).send({
          error: 'Failed to move task',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (body.data.status) {
      task.status = body.data.status;
    }
    if (body.data.runtimeConfig) {
      task.options.runtimeConfig = {
        ...(task.options.runtimeConfig ?? {}),
        ...body.data.runtimeConfig,
      };
    }

    orquestrator.persistTask(task);
    return toTaskResponse(task, orquestrator);
  });

  // GET /api/tasks/:taskId/chat — get task chat history
  fastify.get('/api/tasks/:taskId/chat', async (request, reply) => {
    const params = taskParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }

    const task = orquestrator.tasks.get(params.data.taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    const chat = orquestrator.taskFileStore.loadChat(params.data.taskId);
    return { chat };
  });

  // DELETE /api/tasks/:taskId — cancel task
  fastify.delete('/api/tasks/:taskId', async (request, reply) => {
    const params = taskParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }

    const task = orquestrator.tasks.get(params.data.taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    task.status = TASK_STATUS.CANCELLED;
    orquestrator.persistTask(task);

    return { taskId: task.taskId, status: task.status };
  });
}
