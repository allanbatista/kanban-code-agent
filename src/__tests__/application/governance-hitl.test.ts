import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Orquestrator } from '../../application/orquestrator.js';
import { TASK_STATUS, SWARM_EVENT_TYPE, WAIT_GROUP_MODE } from '../../domain/types.js';
import type { Agent } from '../../domain/agent.js';
import type { AgentRunner } from '../../application/pi-client.js';
import { completedDecision, waitingDecision, makeRoutedRunner } from '../_helpers/mock-agent.js';
import { createDeps, createPiClient, createPiClientWithRunner, waitForStatus, getEvents } from '../_helpers/orquestrator-fixture.js';

const agent = (name: string): Agent => ({ name, role: `Voce e ${name}.`, runtimeConfig: { model: 'fast', effort: 'off' }, tools: ['read'] });

function verdictDecision(verdict: 'approved' | 'rejected', text = 'review'): string {
  return JSON.stringify({ status: 'completed', verdict, criteria: [{ name: 'qualidade', passed: verdict === 'approved' }], feedback: text, messages: [{ type: 'text', text }] });
}

describe('Governance / HITL / Evaluation', () => {
  let dir: string;
  let cleanup: () => void;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gov-'));
    cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } };
  });
  afterEach(() => {
    cleanup();
    process.env = { ...savedEnv };
  });

  // -------------------------------------------------------------------
  // F1.T3 — cascade cancel
  // -------------------------------------------------------------------
  it('cancelling a parent cascades to its open subtasks', () => {
    const orc = new Orquestrator(createDeps(dir, createPiClient([]), [agent('agent-tester')]), { stopWhenWaiting: true });
    const parent = orc.createRootTask('Parent', 'agent-tester');
    const child = orc.spawnSubtask(parent, 'agent-tester', 'Child', 'do it');
    orc.cancelTask(parent.taskId);
    expect(parent.status).toBe(TASK_STATUS.CANCELLED);
    expect(child.status).toBe(TASK_STATUS.CANCELLED);
    expect(child.failureReason).toBe('cancelled_by_user');
  });

  // -------------------------------------------------------------------
  // F6.T3 — human-in-the-loop timeout → SUSPENDED + late-answer resume
  // -------------------------------------------------------------------
  it('parks an unanswered WAITING(human) card in SUSPENDED after the deadline, then a late answer revives it', async () => {
    let asked = false;
    const askRunner: AgentRunner = {
      async run(config) {
        const tool = config.customTools?.find((t) => t.name === 'ask_human');
        if (tool && !asked) { asked = true; await tool.execute({ question: 'qual o formato?' }); }
        return { output: completedDecision('feito'), stats: { tokens: { input: 1, output: 1, total: 2 }, cost: 0 } };
      },
    };
    const orc = new Orquestrator(createDeps(dir, createPiClientWithRunner(askRunner), [agent('agent-tester')]));
    const task = orc.createRootTask('Pergunta', 'agent-tester');
    await waitForStatus(orc, task, TASK_STATUS.WAITING);
    expect(task.waitingReason).toBe('human');

    // Force the deadline to have elapsed.
    orc.checkHumanDeadlines(Date.now() + 7_200_000);
    expect(task.status).toBe(TASK_STATUS.SUSPENDED);
    expect(task.failureReason).toBe('human_timeout');
    expect(getEvents(orc).some((e) => e.type === SWARM_EVENT_TYPE.TASK_SUSPENDED)).toBe(true);

    // A late human answer revives the card.
    orc.appendUserMessage(task.taskId, 'use json');
    await orc.waitUntilSettled(task);
    expect(task.status).not.toBe(TASK_STATUS.SUSPENDED);
  });

  // -------------------------------------------------------------------
  // F4.T2 — per-card cost ceiling → FAILED(ceiling)
  // -------------------------------------------------------------------
  it('fails a card with failureReason=ceiling when it exceeds its per-card cost ceiling', async () => {
    process.env.SWARM_MAX_TOTAL_COST = '0.0001'; // governance.maxCost, read at construction
    const runner: AgentRunner = {
      async run() { return { output: completedDecision('done'), stats: { tokens: { input: 10, output: 5, total: 15 }, cost: 0.01 } }; },
    };
    const orc = new Orquestrator(createDeps(dir, createPiClientWithRunner(runner), [agent('agent-tester')]));
    const task = orc.createRootTask('Cara', 'agent-tester');
    await orc.waitUntilSettled(task);
    expect(task.status).toBe(TASK_STATUS.FAILED);
    expect(task.failureReason).toBe('ceiling');
  });

  // -------------------------------------------------------------------
  // F7.T1 — heartbeat carries accumulated metrics between epochs
  // -------------------------------------------------------------------
  it('emits a HEARTBEAT with accumulated metrics when an epoch ends', async () => {
    const runner: AgentRunner = {
      async run() { return { output: completedDecision('ok'), stats: { tokens: { input: 100, output: 50, cache: 0, total: 150 }, cost: 0.002 } }; },
    };
    const orc = new Orquestrator(createDeps(dir, createPiClientWithRunner(runner), [agent('agent-tester')]));
    const task = orc.createRootTask('HB', 'agent-tester');
    await orc.waitUntilSettled(task);
    const hb = getEvents(orc).find((e) => e.type === SWARM_EVENT_TYPE.HEARTBEAT && e.taskId === task.taskId);
    expect(hb).toBeDefined();
    expect((hb!.payload as { cost: number }).cost).toBeGreaterThan(0);
    expect((hb!.payload as { tokens: { total: number } }).tokens.total).toBe(150);
  });

  // -------------------------------------------------------------------
  // F3.T2 — convergence monitor: stagnation vs productive vs max_epochs
  // -------------------------------------------------------------------
  it('detects stagnation (similar outputs) but not productive iteration', () => {
    const orc = new Orquestrator(createDeps(dir, createPiClient([]), [agent('agent-tester')]), { stopWhenWaiting: true });
    const task = orc.createRootTask('Conv', 'agent-tester');
    const mkRun = (text: string, epoch: number) => ({ runId: `run_${epoch}`, status: 'COMPLETED' as const, epoch, waitGroups: [], resultMessages: [{ ts: '', role: 'assistant' as const, type: 'text' as const, text }], createdAt: '' });
    task.runs = [mkRun('mesma abordagem repetida sem mudar nada aqui', 1), mkRun('mesma abordagem repetida sem mudar nada aqui', 2), mkRun('mesma abordagem repetida sem mudar nada aqui', 3)];
    const circular = (orc as unknown as { checkForStagnation(t: typeof task, o: string): string | null }).checkForStagnation(task, 'mesma abordagem repetida sem mudar nada aqui');
    expect(circular).toBe('stagnation');

    task.runs = [mkRun('implementei o parser de tokens hoje', 1), mkRun('agora adicionei testes de borda completos', 2)];
    const productive = (orc as unknown as { checkForStagnation(t: typeof task, o: string): string | null }).checkForStagnation(task, 'refatorei o modulo de rede inteiro agora');
    expect(productive).toBeNull();
  });

  // -------------------------------------------------------------------
  // F5 — independent evaluation gate (opt-in): QA + Code Reviewer must approve
  // -------------------------------------------------------------------
  it('routes a Manager root through QA + Code Reviewer before REVIEW when the gate is enabled', async () => {
    process.env.SWARM_EVALUATION_GATE = '1';
    const agents = [agent('Manager'), agent('Engineer'), agent('Code Reviewer'), agent('QA')];
    // task_1 = Manager root, task_2 = pre-spawned Engineer subtask, task_3/4 = evaluators.
    const runner = makeRoutedRunner({
      task_1: [
        waitingDecision([{ waitId: 'wg1', mode: WAIT_GROUP_MODE.WAIT_ALL, taskIds: ['task_2'] }], 'aguardando engenharia'),
        completedDecision('trabalho consolidado'),
        completedDecision('entrega final'),
      ],
      task_2: [completedDecision('implementacao pronta')],
      task_3: [verdictDecision('approved', 'codigo ok')],
      task_4: [verdictDecision('approved', 'comportamento ok')],
    });
    const orc = new Orquestrator(createDeps(dir, createPiClientWithRunner(runner), agents));
    const root = orc.createRootTask('Feature complexa', 'Manager');
    orc.spawnSubtask(root, 'Engineer', 'Impl', 'implementar');

    await waitForStatus(orc, root, TASK_STATUS.REVIEW);
    const evaluators = root.subtaskIds.map((id) => orc.tasks.get(id)!).filter((t) => t.assignedTo === 'QA' || t.assignedTo === 'Code Reviewer');
    expect(evaluators.length).toBe(2);
    expect(evaluators.every((e) => e.status === TASK_STATUS.COMPLETED && e.evaluationVerdict === 'approved')).toBe(true);
    expect(root.status).toBe(TASK_STATUS.REVIEW);
  });
});
