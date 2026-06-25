import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Orquestrator } from '../../application/orquestrator.js';
import { PiAgentClient } from '../../application/pi-client.js';
import type { AgentRunner } from '../../application/pi-client.js';
import { EventStore } from '../../infrastructure/persistence/event-store.js';
import { SnapshotStore } from '../../infrastructure/persistence/snapshot-store.js';
import { TaskFileStore } from '../../infrastructure/persistence/task-file-store.js';
import { PathSandbox } from '../../infrastructure/filesystem/sandbox.js';
import { TASK_STATUS } from '../../domain/types.js';
import type { Agent } from '../../domain/agent.js';
import type { OrquestratorDeps } from '../../application/orquestrator.js';
import { completedDecision } from '../_helpers/mock-agent.js';

const MODELS = {
  fast: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'x' },
  balanced: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'y' },
  deep: { provider: 'deepseek', modelId: 'deepseek-v4-pro', description: 'z' },
};
const engineer: Agent = { name: 'Engineer', role: 'Executor.', runtimeConfig: { model: 'fast', effort: 'off' }, tools: ['write'] };

// Runner that produces an artifact then completes — so chat + artifacts + metrics all exist.
const runner: AgentRunner = {
  async run(config) {
    const tool = config.customTools?.find((t) => t.name === 'create_artifact');
    if (tool) await tool.execute({ fileName: 'r.md', content: '# done', description: 'd', file_type: 'markdown' });
    return { output: completedDecision('entrega final'), stats: { tokens: { input: 20, output: 10, cache: 0, total: 30 }, cost: 0.003 } };
  },
};

function deps(dir: string): OrquestratorDeps {
  const sandbox = new PathSandbox(dir);
  return {
    eventStore: new EventStore(sandbox),
    snapshotStore: new SnapshotStore(sandbox),
    taskFileStore: new TaskFileStore(sandbox),
    sandbox,
    agents: [engineer],
    piClient: new PiAgentClient(runner, '', ['write'], MODELS, 60),
    models: MODELS,
  };
}

describe('Rehydration + replay-fold (F2.T1/T5)', () => {
  let dir: string;
  afterEach(() => { if (dir) try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } });

  it('reconstructs the same task state from snapshot and from events-only fold', async () => {
    dir = mkdtempSync(join(tmpdir(), 'rehy-'));

    // 1. Run a task to completion in the first instance.
    const orc1 = new Orquestrator(deps(dir), { stopWhenWaiting: true });
    const task = orc1.createRootTask('Build', 'Engineer');
    const taskId = task.taskId;
    await orc1.waitUntilSettled(task);
    expect(task.status).toBe(TASK_STATUS.COMPLETED);
    expect(task.artifacts.length).toBe(1);
    const chatLen = task.chat.length;
    const cost = task.metrics.cost;

    // 2. Rehydrate from the snapshot — a fresh instance over the same data dir.
    const orc2 = new Orquestrator(deps(dir), { resetState: true });
    const t2 = orc2.tasks.get(taskId)!;
    expect(t2).toBeDefined();
    expect(t2.status).toBe(TASK_STATUS.COMPLETED);
    expect(t2.artifacts.length).toBe(1);
    expect(t2.chat.length).toBe(chatLen);

    // 3. Delete the snapshot → force the events-only fold, and compare key fields.
    const snapshotFile = join(dir, '.swarm', 'state.snapshot.json');
    if (existsSync(snapshotFile)) unlinkSync(snapshotFile);
    // Also remove the per-task chat file so chat MUST be rebuilt from events.
    const chatFile = join(dir, '.swarm', 'tasks', taskId, 'chat.jsonl');
    if (existsSync(chatFile)) unlinkSync(chatFile);

    const orc3 = new Orquestrator(deps(dir), { resetState: true });
    const t3 = orc3.tasks.get(taskId)!;
    expect(t3).toBeDefined();
    expect(t3.status).toBe(TASK_STATUS.COMPLETED);            // status from events
    expect(t3.artifacts.length).toBe(1);                      // artifacts from ARTIFACT_CREATED
    expect(t3.chat.some((m) => m.text === 'entrega final')).toBe(true); // chat from events
    expect(t3.metrics.cost).toBeCloseTo(cost, 6);             // metrics from HEARTBEAT
    expect(t3.runs.length).toBeGreaterThan(0);                // runs reconstructed
  });
});
