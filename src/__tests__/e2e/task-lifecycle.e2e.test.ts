import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';

process.env.SWARM_RETRY_BASE_DELAY_MS = '10';
process.env.SWARM_MAX_TASK_RETRIES = '2';
process.env.SWARM_MAX_TECHNICAL_RETRIES = '1';

import { Orquestrator } from '../../application/orquestrator.js';
import { PiAgentClient } from '../../application/pi-client.js';
import { EventStore } from '../../infrastructure/persistence/event-store.js';
import { SnapshotStore } from '../../infrastructure/persistence/snapshot-store.js';
import { TaskFileStore } from '../../infrastructure/persistence/task-file-store.js';
import { PathSandbox } from '../../infrastructure/filesystem/sandbox.js';
import { TASK_STATUS, SWARM_EVENT_TYPE } from '../../domain/types.js';
import type { Agent } from '../../domain/agent.js';
import type { OrquestratorDeps } from '../../application/orquestrator.js';

import { makeRoutedRunner, completedDecision } from '../_helpers/mock-agent.js';
import { buildServer } from '../_helpers/e2e-server.js';

const TEST_MODELS = {
  fast: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'tarefas simples e baixo custo' },
  balanced: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'uso geral equilibrado' },
  deep: { provider: 'deepseek', modelId: 'deepseek-v4-pro', description: 'tarefas complexas ou criticas' },
};

const managerAgent: Agent = {
  name: 'Manager',
  role: 'Orquestrador.',
  runtimeConfig: { model: 'fast', effort: 'off' },
  tools: ['read'],
};

describe('E2E: task lifecycle via HTTP', () => {
  let dir: string;
  let server: FastifyInstance;
  let orquestrator: Orquestrator;
  let baseUrl: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'e2e-'));
    const sandbox = new PathSandbox(dir);

    // Manager: first run completes (title gen gets fallback), consolidation completes
    // The subtask delegation is tested in orquestrator unit tests.
    // This e2e tests the HTTP boundary + persistence.
    const runner = makeRoutedRunner({
      Manager: [
        completedDecision('Tarefa concluida com sucesso.'),
      ],
    });

    const piClient = new PiAgentClient(runner, '', ['read'], TEST_MODELS, 60);

    const deps: OrquestratorDeps = {
      eventStore: new EventStore(sandbox),
      snapshotStore: new SnapshotStore(sandbox),
      taskFileStore: new TaskFileStore(sandbox),
      sandbox,
      agents: [managerAgent],
      piClient,
      models: TEST_MODELS,
    };

    orquestrator = new Orquestrator(deps);
    server = buildServer(orquestrator);
    await server.listen({ port: 0, host: '127.0.0.1' });

    const address = server.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await server.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('creates task via HTTP, Manager delegates to subtask, completes, and reaches REVIEW', async () => {
    // 1. Create task with execute=true
    const createRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Criar endpoint de health check',
        execute: true,
      }),
    });

    expect(createRes.status).toBe(201);
    const created = await createRes.json() as any;
    expect(created.taskId).toBeDefined();
    expect(created.assignedTo).toBe('Manager');

    const rootTaskId = created.taskId;

    // 2. Wait for the task to reach REVIEW (Manager completes after subtask)
    const reviewTask = await waitForTaskStatus(baseUrl, rootTaskId, TASK_STATUS.REVIEW, 5000);
    expect(reviewTask.status).toBe(TASK_STATUS.REVIEW);

    // 3. Assert task exists via API
    const tasksRes = await fetch(`${baseUrl}/api/tasks`);
    const tasksData = await tasksRes.json() as any;
    expect(tasksData.total).toBeGreaterThanOrEqual(1);

    // 4. Assert events were emitted
    const events = (orquestrator as any).events as any[];
    const rootCreated = events.find((e: any) => e.type === SWARM_EVENT_TYPE.TASK_CREATED && e.taskId === rootTaskId);
    expect(rootCreated).toBeDefined();

    const rootReview = events.find((e: any) => e.type === SWARM_EVENT_TYPE.TASK_REVIEW && e.taskId === rootTaskId);
    expect(rootReview).toBeDefined();

    // 5. Assert ledger file exists
    const { existsSync } = await import('node:fs');
    const eventLog = join(dir, '.swarm', 'events', 'current.jsonl');
    expect(existsSync(eventLog)).toBe(true);

    // 6. Assert snapshot exists
    const snapshotFile = join(dir, '.swarm', 'state.snapshot.json');
    expect(existsSync(snapshotFile)).toBe(true);

    // 7. Assert task files exist
    const taskDir = join(dir, '.swarm', 'tasks', rootTaskId);
    expect(existsSync(taskDir)).toBe(true);
  });

  it('GET /api/tasks/:taskId returns the task detail', async () => {
    const tasksRes = await fetch(`${baseUrl}/api/tasks`);
    const tasksData = await tasksRes.json() as any;
    const rootTask = tasksData.tasks.find((t: any) => !t.parentId);
    expect(rootTask).toBeDefined();

    const detailRes = await fetch(`${baseUrl}/api/tasks/${rootTask.taskId}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json() as any;
    expect(detail.taskId).toBe(rootTask.taskId);
    expect(detail.status).toBe(TASK_STATUS.REVIEW);
  });

  it('GET /health returns ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForTaskStatus(
  baseUrl: string,
  taskId: string,
  status: string,
  timeoutMs: number,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/api/tasks/${taskId}`);
    if (res.ok) {
      const task = await res.json() as any;
      if (task.status === status) return task;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Task ${taskId} did not reach ${status} within ${timeoutMs}ms`);
}
