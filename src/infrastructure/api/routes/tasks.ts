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
  projectIds: z.array(z.string().min(1).max(128)).optional(),
  // false (default) → task parked in Inbox; true → sent to the Manager.
  execute: z.boolean().optional(),
});

// User-permitted status transitions: complete (Revisão→Done) or cancel.
const updateTaskBody = z.object({
  status: z.enum([TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED]).optional(),
  runtimeConfig: runtimeConfigSchema.optional(),
  projectIds: z.array(z.string().min(1).max(128)).optional(),
  // The only user-permitted reassignments: park in Inbox or send to the Manager.
  assignedTo: z.enum(['inbox', 'manager']).optional(),
});

const messageBody = z.object({
  message: z.string().min(1).max(10000),
});

const archiveBody = z.object({
  status: z.enum([TASK_STATUS.COMPLETED, TASK_STATUS.CANCELLED]),
});

const taskParams = z.object({
  taskId: z.string().min(1).max(128),
});

const artifactParams = z.object({
  taskId: z.string().min(1).max(128),
  // Strict allowlist: no path separators, quotes, or CR/LF (header-breakout safe).
  fileName: z.string().min(1).max(256).regex(/^[A-Za-z0-9._-]+$/, 'invalid file name'),
});

const artifactEditBody = z.object({
  content: z.string().max(1_000_000),
});

// Dep-free attachment upload: base64 payload in JSON (no @fastify/multipart).
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB
const attachmentBody = z.object({
  fileName: z.string().min(1).max(256),
  contentBase64: z.string().min(1),
  message: z.string().max(10000).optional(),
});

// Inline-safe content types for agent-authored artifacts. HTML/SVG/XML are
// deliberately EXCLUDED — serving them inline from the same origin is stored
// XSS; they fall through to octet-stream + attachment disposition below.
const CONTENT_TYPES: Record<string, string> = {
  markdown: 'text/markdown; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  mdx: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
  text: 'text/plain; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

const EDITABLE_ARTIFACT_TYPES = new Set([
  'c',
  'cpp',
  'css',
  'csv',
  'go',
  'h',
  'html',
  'java',
  'javascript',
  'js',
  'json',
  'markdown',
  'md',
  'mdx',
  'py',
  'rs',
  'sh',
  'sql',
  'text',
  'ts',
  'tsx',
  'txt',
  'typescript',
  'xml',
  'yaml',
  'yml',
]);

const listQuery = z.object({
  status: z.enum([
    TASK_STATUS.PENDING,
    TASK_STATUS.QUEUED,
    TASK_STATUS.RUNNING,
    TASK_STATUS.WAITING,
    TASK_STATUS.REVIEW,
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
    projectIds: task.projectIds,
    status: task.status,
    waitingReason: task.waitingReason,
    depth: task.depth,
    subtaskIds: task.subtaskIds,
    runtimeConfig: task.runtimeConfig,
    metadata,
    createdAt: task.metrics.startedAt ?? null,
    updatedAt: task.metrics.finishedAt ?? null,
  };
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index >= 0 ? fileName.slice(index + 1).toLowerCase() : '';
}

function artifactContentType(fileType: string | undefined, fileName: string): string | undefined {
  return CONTENT_TYPES[(fileType ?? '').toLowerCase()] ?? CONTENT_TYPES[extensionOf(fileName)];
}

function isEditableArtifact(fileType: string | undefined, fileName: string): boolean {
  const type = (fileType ?? '').toLowerCase();
  return EDITABLE_ARTIFACT_TYPES.has(type) || EDITABLE_ARTIFACT_TYPES.has(extensionOf(fileName));
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

    const { message, runtimeConfig, attachmentPaths, projectIds, execute } = body.data;

    try {
      const task = orquestrator.addTask({
        message,
        runtimeConfig: runtimeConfig as RuntimeConfig | undefined,
        attachmentPaths,
        projectIds,
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

    try {
      if (body.data.status === TASK_STATUS.COMPLETED) {
        orquestrator.completeTaskByUser(params.data.taskId);
      } else if (body.data.status === TASK_STATUS.CANCELLED) {
        orquestrator.cancelTask(params.data.taskId);
      }
      if (body.data.runtimeConfig) {
        orquestrator.updateTaskRuntimeConfig(params.data.taskId, body.data.runtimeConfig as RuntimeConfig);
      }
      if (body.data.projectIds) {
        orquestrator.updateTaskProjects(params.data.taskId, body.data.projectIds);
      }
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to update task',
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return toTaskResponse(orquestrator.tasks.get(params.data.taskId)!, orquestrator);
  });

  // POST /api/tasks/:taskId/messages — append a user message (reopens REVIEW tasks)
  fastify.post('/api/tasks/:taskId/messages', async (request, reply) => {
    const params = taskParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }
    const body = messageBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: body.error.issues });
    }
    if (!orquestrator.tasks.get(params.data.taskId)) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    try {
      const task = orquestrator.appendUserMessage(params.data.taskId, body.data.message);
      return toTaskResponse(task, orquestrator);
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to append message',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /api/tasks/:taskId/approve — approve REVIEW and complete/merge.
  fastify.post('/api/tasks/:taskId/approve', async (request, reply) => {
    const params = taskParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }
    const task = orquestrator.tasks.get(params.data.taskId);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    if (task.status !== TASK_STATUS.REVIEW) return reply.status(409).send({ error: 'Task is not in REVIEW' });

    try {
      return toTaskResponse(orquestrator.completeTaskByUser(params.data.taskId), orquestrator);
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to approve task',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /api/tasks/:taskId/reject — append feedback and reopen REVIEW.
  fastify.post('/api/tasks/:taskId/reject', async (request, reply) => {
    const params = taskParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }
    const body = messageBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: body.error.issues });
    }
    const task = orquestrator.tasks.get(params.data.taskId);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    if (task.status !== TASK_STATUS.REVIEW) return reply.status(409).send({ error: 'Task is not in REVIEW' });

    try {
      const reopened = orquestrator.appendUserMessage(params.data.taskId, body.data.message);
      return toTaskResponse(reopened, orquestrator);
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to reject task',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /api/tasks/:taskId/retry — manually re-run a FAILED/CANCELLED/REVIEW task
  fastify.post('/api/tasks/:taskId/retry', async (request, reply) => {
    const params = taskParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }
    if (!orquestrator.tasks.get(params.data.taskId)) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    try {
      const task = orquestrator.retryTask(params.data.taskId);
      return toTaskResponse(task, orquestrator);
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to retry task',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /api/tasks/:taskId/attachments — human uploads an attachment mid-chat
  fastify.post('/api/tasks/:taskId/attachments', async (request, reply) => {
    const params = taskParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }
    const body = attachmentBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: body.error.issues });
    }
    if (!orquestrator.tasks.get(params.data.taskId)) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    let data: Buffer;
    try {
      data = Buffer.from(body.data.contentBase64, 'base64');
    } catch {
      return reply.status(400).send({ error: 'Invalid base64 content' });
    }
    if (data.byteLength === 0 || data.byteLength > MAX_ATTACHMENT_BYTES) {
      return reply.status(413).send({ error: 'Attachment too large or empty' });
    }
    try {
      const ref = orquestrator.appendUserAttachment(
        params.data.taskId,
        body.data.fileName,
        data,
        body.data.message,
      );
      reply.status(201);
      return { attachment: ref };
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to attach',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // GET /api/tasks/:taskId/artifacts — list the task's artifacts
  fastify.get('/api/tasks/:taskId/artifacts', async (request, reply) => {
    const params = taskParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }
    const task = orquestrator.tasks.get(params.data.taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    return { artifacts: task.artifacts };
  });

  // GET /api/tasks/:taskId/artifacts/:fileName — stream an artifact's content
  fastify.get('/api/tasks/:taskId/artifacts/:fileName', async (request, reply) => {
    const params = artifactParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }
    const task = orquestrator.tasks.get(params.data.taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    let content: Buffer | null;
    try {
      content = orquestrator.taskFileStore.readArtifact(params.data.taskId, params.data.fileName);
    } catch {
      // PathSandbox rejected the resolved path (traversal attempt).
      return reply.status(403).send({ error: 'Forbidden path' });
    }
    if (!content) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }
    const artifact = task.artifacts.find((a) => a.path.endsWith(`/${params.data.fileName}`) || a.path.endsWith(params.data.fileName));
    const safeType = artifactContentType(artifact?.fileType, params.data.fileName);
    // Inline only known-safe renderable types; everything else is a
    // forced download. Hardening headers prevent MIME-sniffing + active content.
    const contentType = safeType ?? 'application/octet-stream';
    const disposition = safeType ? 'inline' : 'attachment';
    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `${disposition}; filename="${params.data.fileName}"`);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
    return reply.send(content);
  });

  // PUT /api/tasks/:taskId/artifacts/:fileName — edit a text-like artifact
  fastify.put('/api/tasks/:taskId/artifacts/:fileName', async (request, reply) => {
    const params = artifactParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid params', issues: params.error.issues });
    }
    const body = artifactEditBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: body.error.issues });
    }
    const task = orquestrator.tasks.get(params.data.taskId);
    if (!task) {
      return reply.status(404).send({ error: 'Task not found' });
    }
    const artifact = task.artifacts.find((a) => a.path.endsWith(`/${params.data.fileName}`) || a.path.endsWith(params.data.fileName));
    if (!artifact) {
      return reply.status(404).send({ error: 'Artifact not found' });
    }
    if (!isEditableArtifact(artifact.fileType, params.data.fileName)) {
      return reply.status(415).send({ error: 'Artifact is not editable as text' });
    }
    try {
      return toTaskResponse(
        orquestrator.updateArtifactContent(params.data.taskId, params.data.fileName, body.data.content),
        orquestrator,
      );
    } catch (error) {
      return reply.status(400).send({
        error: 'Failed to update artifact',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /api/tasks/archive — archive all tasks in a column status (Done/Cancel)
  fastify.post('/api/tasks/archive', async (request, reply) => {
    const body = archiveBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid body', issues: body.error.issues });
    }
    const archived = orquestrator.archiveByStatus(body.data.status);
    return { archived, total: archived.length };
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

    const cancelled = orquestrator.cancelTask(params.data.taskId);
    return { taskId: cancelled.taskId, status: cancelled.status };
  });
}
