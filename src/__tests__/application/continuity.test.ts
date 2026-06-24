import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.SWARM_RETRY_BASE_DELAY_MS = '10';
process.env.SWARM_MAX_TASK_RETRIES = '2';
process.env.SWARM_MAX_TECHNICAL_RETRIES = '1';

import { Orquestrator } from '../../application/orquestrator.js';
import { PiAgentClient } from '../../application/pi-client.js';
import { EventStore } from '../../infrastructure/persistence/event-store.js';
import { SnapshotStore } from '../../infrastructure/persistence/snapshot-store.js';
import { TaskFileStore } from '../../infrastructure/persistence/task-file-store.js';
import { PathSandbox } from '../../infrastructure/filesystem/sandbox.js';
import { TASK_STATUS } from '../../domain/types.js';
import type { Agent } from '../../domain/agent.js';
import type { OrquestratorDeps } from '../../application/orquestrator.js';
import { makeRunner, completedDecision, testAgent } from '../_helpers/mock-agent.js';

const TEST_MODELS = {
  fast: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'fast' },
  balanced: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'balanced' },
  deep: { provider: 'deepseek', modelId: 'deepseek-v4-pro', description: 'deep' },
};

describe('Continuity: rehydration preserves scope-spec and progress', () => {
  let dir: string;
  let sandbox: PathSandbox;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'continuity-'));
    sandbox = new PathSandbox(dir);
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  function createOrquestrator(runnerResponses: string[], agents = [testAgent]): Orquestrator {
    const runner = makeRunner(runnerResponses);
    const piClient = new PiAgentClient(runner, '', ['read'], TEST_MODELS, 60);
    const deps: OrquestratorDeps = {
      eventStore: new EventStore(sandbox),
      snapshotStore: new SnapshotStore(sandbox),
      taskFileStore: new TaskFileStore(sandbox),
      sandbox,
      agents,
      piClient,
      models: TEST_MODELS,
    };
    return new Orquestrator(deps);
  }

  it('scope-spec is created on task start', async () => {
    const orc = createOrquestrator([completedDecision()]);
    const task = orc.createRootTask('Build API endpoint', 'agent-tester');

    // Wait for task to complete
    await new Promise<void>((resolve) => {
      const check = () => {
        if (task.status === TASK_STATUS.REVIEW || task.status === TASK_STATUS.COMPLETED) return resolve();
        setTimeout(check, 10);
      };
      check();
    });

    const scopeSpec = new TaskFileStore(sandbox).loadScopeSpec(task.taskId);
    expect(scopeSpec.length).toBeGreaterThan(0);
    expect(scopeSpec[0].description).toBe('Build API endpoint');
  });

  it('scope-spec persists across rehydration', async () => {
    // First orquestrator: create and complete task
    const orc1 = createOrquestrator([completedDecision()]);
    const task = orc1.createRootTask('Persist test', 'agent-tester');

    await new Promise<void>((resolve) => {
      const check = () => {
        if (task.status === TASK_STATUS.REVIEW || task.status === TASK_STATUS.COMPLETED) return resolve();
        setTimeout(check, 10);
      };
      check();
    });

    const taskId = task.taskId;

    // Second orquestrator: rehydrate from same directory
    const orc2 = createOrquestrator([completedDecision()]);
    const restoredTask = orc2.tasks.get(taskId);
    expect(restoredTask).toBeDefined();

    // Scope-spec should be accessible
    const scopeSpec = new TaskFileStore(sandbox).loadScopeSpec(taskId);
    expect(scopeSpec.length).toBeGreaterThan(0);
  });

  it('progress-log accumulates across runs', () => {
    const store = new TaskFileStore(sandbox);
    store.ensureTaskDir('task_test');

    store.appendProgressLog('task_test', { ts: new Date().toISOString(), action: 'started' });
    store.appendProgressLog('task_test', { ts: new Date().toISOString(), epoch: 1, action: 'progress', detail: 'Half done' });
    store.appendProgressLog('task_test', { ts: new Date().toISOString(), epoch: 2, action: 'completed' });

    const log = store.loadProgressLog('task_test');
    expect(log).toHaveLength(3);
    expect(log[2].action).toBe('completed');
  });

  it('env-resume is available after rehydration', () => {
    const store = new TaskFileStore(sandbox);
    store.ensureTaskDir('task_test');
    store.saveEnvResume('task_test', {
      testCommand: 'npm test',
      buildCommand: 'npm run build',
      notes: 'Run typecheck too',
    });

    // New store instance (simulates rehydration)
    const store2 = new TaskFileStore(sandbox);
    const resume = store2.loadEnvResume('task_test');
    expect(resume).not.toBeNull();
    expect(resume!.testCommand).toBe('npm test');
  });
});
