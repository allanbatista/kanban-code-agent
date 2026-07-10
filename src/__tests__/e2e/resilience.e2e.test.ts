import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
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
import { completedDecision, waitingDecision } from '../_helpers/mock-agent.js';
import { waitForStatus } from '../_helpers/orquestrator-fixture.js';

const MODELS = {
  fast: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'x' },
  balanced: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'y' },
  deep: { provider: 'deepseek', modelId: 'deepseek-v4-pro', description: 'z' },
};
const ag = (name: string): Agent => ({ name, role: `Voce e ${name}.`, runtimeConfig: { model: 'fast', effort: 'off' }, tools: ['read'] });
const STATS = { tokens: { input: 5, output: 5, total: 10 }, cost: 0.001 };

function makeOrc(dir: string, runner: AgentRunner, agents: Agent[]): Orquestrator {
  const sandbox = new PathSandbox(dir);
  return new Orquestrator({
    eventStore: new EventStore(sandbox),
    snapshotStore: new SnapshotStore(sandbox),
    taskFileStore: new TaskFileStore(sandbox),
    sandbox,
    agents,
    piClient: new PiAgentClient(runner, '', ['read'], MODELS, 60),
    models: MODELS,
  });
}

describe('E2E: resilience / chaos (F8.T5)', () => {
  let dir: string;
  const orcs: Orquestrator[] = [];
  afterEach(() => {
    for (const o of orcs) o.shutdown();
    orcs.length = 0;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('resumes a parent across a simulated crash: a NEW instance finishes the interrupted work', async () => {
    dir = mkdtempSync(join(tmpdir(), 'res-crash-'));

    // Instance 1: the Engineer subtask "hangs" (never returns) → the work is
    // interrupted mid-flight with the parent WAITING on it.
    const hanging: AgentRunner = {
      async run(config) {
        const taskId = basename(dirname(String(config.cwd)));
        if (taskId === 'task_2') return new Promise<never>(() => {}); // never resolves
        return { output: waitingDecision([{ waitId: 'g', mode: 'WAIT_ALL', taskIds: ['task_2'] }], 'aguardando'), stats: STATS };
      },
    };
    const orc1 = makeOrc(dir, hanging, [ag('Manager'), ag('Engineer')]);
    orcs.push(orc1);
    const root = orc1.createRootTask('Crash me', 'Manager');
    orc1.spawnSubtask(root, 'Engineer', 'Eng', 'work');
    await waitForStatus(orc1, root, TASK_STATUS.WAITING);
    orc1.shutdown(); // simulate process kill (resets RUNNING→PENDING, persists)

    // Instance 2 over the same data dir: the Engineer now completes; the parent
    // wakes from the durable wait group and consolidates → REVIEW.
    const completing: AgentRunner = {
      async run(config) {
        const taskId = basename(dirname(String(config.cwd)));
        if (taskId === 'task_2') return { output: completedDecision('impl done'), stats: STATS };
        return { output: completedDecision('consolidado'), stats: STATS };
      },
    };
    const orc2 = makeOrc(dir, completing, [ag('Manager'), ag('Engineer')]);
    orcs.push(orc2);
    const root2 = orc2.tasks.get(root.taskId)!;
    const sub2 = orc2.tasks.get('task_2')!;
    expect(root2).toBeDefined();
    await waitForStatus(orc2, root2, TASK_STATUS.REVIEW);
    expect(sub2.status).toBe(TASK_STATUS.COMPLETED);
    expect(root2.status).toBe(TASK_STATUS.REVIEW);
  });

  it('tolerates a corrupted/truncated last line in the event log', async () => {
    dir = mkdtempSync(join(tmpdir(), 'res-log-'));
    const orc1 = makeOrc(dir, { async run() { return { output: completedDecision('ok'), stats: STATS }; } }, [ag('agent-tester')]);
    orcs.push(orc1);
    const task = orc1.createRootTask('t', 'agent-tester');
    await orc1.waitUntilSettled(task);
    orc1.shutdown();

    // Corrupt the ledger with a half-written final line (crash during append).
    appendFileSync(join(dir, '.swarm', 'events', 'current.jsonl'), '{"seq":999,"type":"TASK_');

    // A fresh instance loads without throwing and the task survives.
    const orc2 = makeOrc(dir, { async run() { return { output: completedDecision(), stats: STATS }; } }, [ag('agent-tester')]);
    orcs.push(orc2);
    expect(orc2.tasks.get(task.taskId)).toBeDefined();
    expect(orc2.tasks.get(task.taskId)!.status).toBe(TASK_STATUS.COMPLETED);
  });

  it('composite failure: a ceiling card and a human-timeout card each stop cleanly and independently', async () => {
    dir = mkdtempSync(join(tmpdir(), 'res-comp-'));
    process.env.SWARM_MAX_TOTAL_COST = '0.0001';
    let asked = false;
    const runner: AgentRunner = {
      async run(config) {
        const taskId = basename(dirname(String(config.cwd)));
        if (taskId === 'task_2') {
          const tool = config.customTools?.find((t) => t.name === 'ask_human');
          if (tool && !asked) { asked = true; await tool.execute({ question: 'detalhe?' }); }
          return { output: completedDecision('feito'), stats: { tokens: { input: 1, output: 1, total: 2 }, cost: 0 } };
        }
        // task_1: expensive → trips the per-card ceiling.
        return { output: completedDecision('caro'), stats: { tokens: { input: 10, output: 10, total: 20 }, cost: 0.01 } };
      },
    };
    const orc = makeOrc(dir, runner, [ag('agent-tester')]);
    orcs.push(orc);
    const ceilingCard = orc.createRootTask('Caro', 'agent-tester');
    const humanCard = orc.createRootTask('Pergunta', 'agent-tester');

    await waitForStatus(orc, ceilingCard, TASK_STATUS.FAILED);
    expect(ceilingCard.failureReason).toBe('ceiling');

    await waitForStatus(orc, humanCard, TASK_STATUS.WAITING);
    orc.checkHumanDeadlines(Date.now() + 7_200_000);
    expect(humanCard.status).toBe(TASK_STATUS.SUSPENDED);
    expect(humanCard.failureReason).toBe('human_timeout');
    delete process.env.SWARM_MAX_TOTAL_COST;
  });
});
