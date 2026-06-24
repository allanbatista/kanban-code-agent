import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

import { Orquestrator } from '../../application/orquestrator.js';
import { TASK_STATUS } from '../../domain/types.js';
import type { Agent } from '../../domain/agent.js';
import type { AgentRunResult, AgentRunner, AgentRunConfig } from '../../application/pi-client.js';
import { createPiClientWithRunner, createDeps } from '../_helpers/orquestrator-fixture.js';

const managerAgent: Agent = { name: 'Manager', role: 'mgr', runtimeConfig: { model: 'fast', effort: 'off' }, tools: ['read'] };
const workerAgent: Agent = { name: 'Worker', role: 'wrk', runtimeConfig: { model: 'fast', effort: 'off' }, tools: ['read'] };

// Mimics the real Pi flow: the Manager calls the create_subtask custom tool
// mid-run, then on its first resume — like a weak model — wrongly re-emits
// `waiting` on subtasks that already finished, before finally consolidating.
function rewaitRunner(): AgentRunner {
  const calls: Record<string, number> = {};
  return {
    async run(config: AgentRunConfig): Promise<AgentRunResult> {
      const taskId = basename(String(config.cwd));
      const n = (calls[taskId] = (calls[taskId] ?? 0) + 1);
      const stats = { tokens: { input: 10, output: 5, total: 15 }, cost: 0.001 };

      if (taskId === 'task_1') {
        if (n === 1) {
          const create = (config.customTools ?? []).find((t) => t.name === 'create_subtask')!;
          const id1 = JSON.parse(await create.execute({ assignedTo: 'Worker', title: 'A', message: 'do A' })).taskId;
          const id2 = JSON.parse(await create.execute({ assignedTo: 'Worker', title: 'B', message: 'do B' })).taskId;
          return { output: JSON.stringify({ status: 'waiting', messages: [{ type: 'text', text: 'delegated' }], waitGroups: [{ waitId: 'g1', mode: 'WAIT_ALL', taskIds: [id1, id2] }] }), stats };
        }
        if (n === 2) {
          const subIds = Object.keys(calls).filter((k) => k !== 'task_1');
          return { output: JSON.stringify({ status: 'waiting', messages: [{ type: 'text', text: 'still waiting' }], waitGroups: [{ waitId: 'g1', mode: 'WAIT_ALL', taskIds: subIds }] }), stats };
        }
        return { output: JSON.stringify({ status: 'completed', messages: [{ type: 'text', text: 'consolidated' }] }), stats };
      }
      return { output: JSON.stringify({ status: 'completed', messages: [{ type: 'text', text: `${taskId} done` }] }), stats };
    },
  };
}

function waitForReview(orc: Orquestrator, task: { status: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`stuck in ${task.status}`)), 4000);
    const check = (): void => {
      if ([TASK_STATUS.REVIEW, TASK_STATUS.COMPLETED, TASK_STATUS.FAILED].includes(task.status as never)) {
        clearTimeout(timer);
        return resolve();
      }
      orc.once('state:changed', check);
    };
    check();
  });
}

describe('Manager resume when re-waiting on already-settled subtasks', () => {
  let dir: string;
  let cleanup: () => void;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rewait-')); cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} }; });
  afterEach(() => cleanup());

  it('resumes to REVIEW instead of stalling in WAITING', async () => {
    const orc = new Orquestrator(createDeps(dir, createPiClientWithRunner(rewaitRunner()), [managerAgent, workerAgent]));
    const parent = orc.createRootTask('Parent', 'Manager');

    await waitForReview(orc, parent);

    const subs = orc.getSubtasks(parent);
    expect(subs.length).toBe(2);
    expect(subs.every((s) => s.status === TASK_STATUS.COMPLETED)).toBe(true);
    expect(parent.status).toBe(TASK_STATUS.REVIEW);
  });
});
