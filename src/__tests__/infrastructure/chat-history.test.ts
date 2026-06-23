import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerTaskRoutes } from '../../infrastructure/api/routes/tasks.js';
import { Orquestrator } from '../../application/orquestrator.js';
import { PiAgentClient } from '../../application/pi-client.js';
import { EventStore } from '../../infrastructure/persistence/event-store.js';
import { SnapshotStore } from '../../infrastructure/persistence/snapshot-store.js';
import { TaskFileStore } from '../../infrastructure/persistence/task-file-store.js';
import { PathSandbox } from '../../infrastructure/filesystem/sandbox.js';
import { Task } from '../../domain/task.js';
import type { Agent } from '../../domain/agent.js';

function createOrquestrator(dir: string): Orquestrator {
  const sandbox = new PathSandbox(dir);
  const allowedModels = {
    fast: { provider: 'test', modelId: 'test-fast' },
    balanced: { provider: 'test', modelId: 'test-balanced' },
    deep: { provider: 'test', modelId: 'test-deep' },
  };
  const runner = {
    async run() {
      return { output: '{"status":"completed","messages":[{"type":"text","text":"done"}]}', stats: { tokens: { input: 0, output: 0, total: 0 }, cost: 0 } };
    },
  };
  const piClient = new PiAgentClient(runner, '', ['read'], allowedModels, 60);
  const agents: Agent[] = [{ name: 'test', role: 'test', runtimeConfig: { model: 'fast', effort: 'off' }, tools: ['read'] }];
  const deps = {
    eventStore: new EventStore(sandbox),
    snapshotStore: new SnapshotStore(sandbox),
    taskFileStore: new TaskFileStore(sandbox),
    sandbox,
    agents,
    piClient,
  };
  return new Orquestrator(deps);
}

describe('Chat history endpoint', () => {
  let fastify: FastifyInstance;
  let orquestrator: Orquestrator;
  let taskId: string;
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'chat-'));
    orquestrator = createOrquestrator(dir);

    const task = orquestrator.createRootTask('Test task', 'test');
    taskId = task.taskId;

    // Add some chat messages
    task.appendChat('user', 'text', 'Hello');
    task.appendChat('assistant', 'text', 'Hi there');
    orquestrator.taskFileStore.saveChat(taskId, task.chat);

    fastify = Fastify();
    registerTaskRoutes(fastify, orquestrator);
  });

  afterEach(async () => {
    await fastify.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  describe('GET /api/tasks/:taskId/chat', () => {
    it('returns chat messages for existing task', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: `/api/tasks/${taskId}/chat`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('chat');
      expect(Array.isArray(body.chat)).toBe(true);
      expect(body.chat.length).toBeGreaterThanOrEqual(2);
    });

    it('returns 404 for nonexistent task', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/tasks/nonexistent/chat',
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns initial chat message for newly created task', async () => {
      const task = orquestrator.createRootTask('New task chat test', 'test');
      const response = await fastify.inject({
        method: 'GET',
        url: `/api/tasks/${task.taskId}/chat`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.chat)).toBe(true);
      expect(body.chat.length).toBeGreaterThanOrEqual(1);
      expect(body.chat[0].role).toBe('user');
      expect(body.chat[0].text).toBe('New task chat test');
    });
  });
});
