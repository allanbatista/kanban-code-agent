import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';

import { Orquestrator } from '../../application/orquestrator.js';
import { PiAgentClient } from '../../application/pi-client.js';
import type { AgentRunner, AgentRunResult } from '../../application/pi-client.js';
import { EventStore } from '../../infrastructure/persistence/event-store.js';
import { SnapshotStore } from '../../infrastructure/persistence/snapshot-store.js';
import { TaskFileStore } from '../../infrastructure/persistence/task-file-store.js';
import { PathSandbox } from '../../infrastructure/filesystem/sandbox.js';
import { TASK_STATUS } from '../../domain/types.js';
import type { Agent } from '../../domain/agent.js';
import { completedDecision, waitingDecision } from '../_helpers/mock-agent.js';
import { waitForStatus } from '../_helpers/orquestrator-fixture.js';
import { buildAndListen } from '../_helpers/e2e-server.js';

const MODELS = {
  fast: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'x' },
  balanced: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'y' },
  deep: { provider: 'deepseek', modelId: 'deepseek-v4-pro', description: 'z' },
};
const ag = (name: string): Agent => ({ name, role: `Voce e ${name}.`, runtimeConfig: { model: 'fast', effort: 'off' }, tools: ['read', 'write'] });
const STATS = { tokens: { input: 5, output: 5, total: 10 }, cost: 0.001 };
const verdict = (v: 'approved' | 'rejected') => JSON.stringify({ status: 'completed', verdict: v, criteria: [{ name: 'q', passed: v === 'approved' }], messages: [{ type: 'text', text: v }] });

function makeOrc(dir: string, runner: AgentRunner, agents: Agent[]): Orquestrator {
  const sandbox = new PathSandbox(dir);
  return new Orquestrator({
    eventStore: new EventStore(sandbox),
    snapshotStore: new SnapshotStore(sandbox),
    taskFileStore: new TaskFileStore(sandbox),
    sandbox,
    agents,
    piClient: new PiAgentClient(runner, '', ['read', 'write'], MODELS, 60),
    models: MODELS,
  });
}

describe('E2E: §12 workflow scenarios', () => {
  let dir: string;
  let orc: Orquestrator | undefined;
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    orc?.shutdown();
    if (close) await close();
    close = undefined;
    orc = undefined;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  // Cenário A — alta complexidade: Manager → Architecture/Produto → Engineer →
  // Code Reviewer + QA (gate) → Manager (consolidação) → REVIEW, com artefato.
  it('Scenario A: full route with independent evaluation gate + fetchable artifact', async () => {
    dir = mkdtempSync(join(tmpdir(), 'scen-a-'));
    process.env.SWARM_EVALUATION_GATE = '1';
    const idx: Record<string, number> = {};
    const scripts: Record<string, string[]> = {
      task_1: [
        waitingDecision([{ waitId: 'g', mode: 'WAIT_ALL', taskIds: ['task_2', 'task_3', 'task_4'] }], 'especificacao+impl'),
        completedDecision('consolidado'),
        completedDecision('entrega final'),
      ],
      task_2: [completedDecision('arquitetura definida')],
      task_3: [completedDecision('impacto de produto ok')],
      task_5: [verdict('approved')],
      task_6: [verdict('approved')],
    };
    const runner: AgentRunner = {
      async run(config): Promise<AgentRunResult> {
        const taskId = basename(String(config.cwd));
        if (taskId === 'task_4') {
          const tool = config.customTools?.find((t) => t.name === 'create_artifact');
          if (tool && (idx[taskId] ?? 0) === 0) await tool.execute({ fileName: 'design.md', content: '# design', description: 'd', file_type: 'markdown' });
          idx[taskId] = (idx[taskId] ?? 0) + 1;
          return { output: completedDecision('implementacao pronta'), stats: STATS };
        }
        const i = idx[taskId] ?? 0; idx[taskId] = i + 1;
        return { output: (scripts[taskId] ?? [])[i] ?? completedDecision(), stats: STATS };
      },
    };
    orc = makeOrc(dir, runner, [ag('Manager'), ag('Architecture'), ag('Produto'), ag('Engineer'), ag('Code Reviewer'), ag('QA')]);
    const listen = await buildAndListen(orc);
    const server: FastifyInstance = listen.server;
    close = listen.close;

    const root = orc.createRootTask('Mudanca de arquitetura core', 'Manager');
    orc.spawnSubtask(root, 'Architecture', 'Arq', 'desenhar');
    orc.spawnSubtask(root, 'Produto', 'Prod', 'validar impacto');
    orc.spawnSubtask(root, 'Engineer', 'Eng', 'implementar');

    await waitForStatus(orc, root, TASK_STATUS.REVIEW);
    // Independent evaluation actually fired and approved.
    const evaluators = root.subtaskIds.map((id) => orc!.tasks.get(id)!).filter((t) => t.assignedTo === 'QA' || t.assignedTo === 'Code Reviewer');
    expect(evaluators.length).toBe(2);
    expect(evaluators.every((e) => e.evaluationVerdict === 'approved')).toBe(true);

    // The Engineer's artifact is fetchable over HTTP.
    const res = await server.inject({ method: 'GET', url: '/api/tasks/task_4/artifacts/design.md' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('# design');
    delete process.env.SWARM_EVALUATION_GATE;
  });

  // Cenário B — bug urgente (rota encurtada, sem gate pesado).
  it('Scenario B: shortened route (Produto → Engineer → QA) consolidates to REVIEW', async () => {
    dir = mkdtempSync(join(tmpdir(), 'scen-b-'));
    const idx: Record<string, number> = {};
    const scripts: Record<string, string[]> = {
      task_1: [
        waitingDecision([{ waitId: 'g', mode: 'WAIT_ALL', taskIds: ['task_2', 'task_3', 'task_4'] }], 'fix'),
        completedDecision('bug corrigido'),
      ],
      task_2: [completedDecision('criterio de aceite')],
      task_3: [completedDecision('correcao aplicada')],
      task_4: [completedDecision('caso de borda validado')],
    };
    const runner: AgentRunner = {
      async run(config) {
        const taskId = basename(String(config.cwd));
        const i = idx[taskId] ?? 0; idx[taskId] = i + 1;
        return { output: (scripts[taskId] ?? [])[i] ?? completedDecision(), stats: STATS };
      },
    };
    orc = makeOrc(dir, runner, [ag('Manager'), ag('Produto'), ag('Engineer'), ag('QA')]);
    const root = orc.createRootTask('Erro em regra de desconto', 'Manager');
    orc.spawnSubtask(root, 'Produto', 'Aceite', 'definir');
    orc.spawnSubtask(root, 'Engineer', 'Fix', 'corrigir');
    orc.spawnSubtask(root, 'QA', 'Valida', 'testar');
    await waitForStatus(orc, root, TASK_STATUS.REVIEW);
    expect(root.subtaskIds.map((id) => orc!.tasks.get(id)!.status).every((s) => s === TASK_STATUS.COMPLETED)).toBe(true);
  });

  // Cenário C — documentação/débito leve (rota mínima).
  it('Scenario C: minimal route (Generic → Code Reviewer) consolidates to REVIEW', async () => {
    dir = mkdtempSync(join(tmpdir(), 'scen-c-'));
    const idx: Record<string, number> = {};
    const scripts: Record<string, string[]> = {
      task_1: [
        waitingDecision([{ waitId: 'g', mode: 'WAIT_ALL', taskIds: ['task_2', 'task_3'] }], 'docs'),
        completedDecision('docs atualizadas'),
      ],
      task_2: [completedDecision('manual atualizado')],
      task_3: [completedDecision('revisao ok')],
    };
    const runner: AgentRunner = {
      async run(config) {
        const taskId = basename(String(config.cwd));
        const i = idx[taskId] ?? 0; idx[taskId] = i + 1;
        return { output: (scripts[taskId] ?? [])[i] ?? completedDecision(), stats: STATS };
      },
    };
    orc = makeOrc(dir, runner, [ag('Manager'), ag('Generic'), ag('Code Reviewer')]);
    const root = orc.createRootTask('Atualizar manuais', 'Manager');
    orc.spawnSubtask(root, 'Generic', 'Docs', 'atualizar');
    orc.spawnSubtask(root, 'Code Reviewer', 'Lint', 'revisar');
    await waitForStatus(orc, root, TASK_STATUS.REVIEW);
    expect(root.status).toBe(TASK_STATUS.REVIEW);
  });
});
