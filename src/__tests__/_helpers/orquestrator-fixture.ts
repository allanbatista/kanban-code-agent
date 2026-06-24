import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Orquestrator } from '../../application/orquestrator.js';
import { PiAgentClient } from '../../application/pi-client.js';
import { EventStore } from '../../infrastructure/persistence/event-store.js';
import { SnapshotStore } from '../../infrastructure/persistence/snapshot-store.js';
import { TaskFileStore } from '../../infrastructure/persistence/task-file-store.js';
import { PathSandbox } from '../../infrastructure/filesystem/sandbox.js';
import type { AgentRunner } from '../../application/pi-client.js';
import type { OrquestratorDeps, OrquestratorOptions } from '../../application/orquestrator.js';
import type { SwarmEvent } from '../../domain/events.js';
import type { Task } from '../../domain/task.js';
import { makeRunner, testAgent } from './mock-agent.js';

// ---------------------------------------------------------------------------
// Default models for tests (DeepSeek, matching production config)
// ---------------------------------------------------------------------------

const TEST_MODELS = {
  fast: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'tarefas simples e baixo custo' },
  balanced: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'uso geral equilibrado' },
  deep: { provider: 'deepseek', modelId: 'deepseek-v4-pro', description: 'tarefas complexas ou criticas' },
};

// ---------------------------------------------------------------------------
// PiAgentClient builders
// ---------------------------------------------------------------------------

export function createPiClient(responses: string[]): PiAgentClient {
  return new PiAgentClient(makeRunner(responses), '', ['read'], TEST_MODELS, 60);
}

export function createPiClientWithRunner(runner: AgentRunner): PiAgentClient {
  return new PiAgentClient(runner, '', ['read'], TEST_MODELS, 60);
}

// ---------------------------------------------------------------------------
// OrquestratorDeps builder
// ---------------------------------------------------------------------------

export function createDeps(
  dir: string,
  piClient: PiAgentClient,
  agents = [testAgent],
): OrquestratorDeps {
  const sandbox = new PathSandbox(dir);
  return {
    eventStore: new EventStore(sandbox),
    snapshotStore: new SnapshotStore(sandbox),
    taskFileStore: new TaskFileStore(sandbox),
    sandbox,
    agents,
    piClient,
    models: TEST_MODELS,
  };
}

// ---------------------------------------------------------------------------
// Orquestrator builder
// ---------------------------------------------------------------------------

export function buildOrquestrator(
  deps?: Partial<OrquestratorDeps>,
  options?: OrquestratorOptions,
): { orquestrator: Orquestrator; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'orc-'));
  const cleanup = () => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  };

  const sandbox = new PathSandbox(dir);
  const piClient = deps?.piClient ?? createPiClient([]);
  const defaultDeps: OrquestratorDeps = {
    eventStore: deps?.eventStore ?? new EventStore(sandbox),
    snapshotStore: deps?.snapshotStore ?? new SnapshotStore(sandbox),
    taskFileStore: deps?.taskFileStore ?? new TaskFileStore(sandbox),
    sandbox: deps?.sandbox ?? sandbox,
    agents: deps?.agents ?? [testAgent],
    piClient,
    models: TEST_MODELS,
  };

  const orquestrator = new Orquestrator(defaultDeps, options);
  return { orquestrator, dir, cleanup };
}

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

export function waitForStatus(orc: Orquestrator, task: Task, status: string): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (task.status === status) return resolve();
      orc.once('state:changed', check);
    };
    check();
  });
}

export function getEvents(o: Orquestrator): SwarmEvent[] {
  return (o as any).events;
}

export function findEvent(events: SwarmEvent[], type: string, taskId?: string): SwarmEvent | undefined {
  return events.find((e) => {
    if (e.type !== type) return false;
    if (taskId !== undefined && e.taskId !== taskId) return false;
    return true;
  });
}
