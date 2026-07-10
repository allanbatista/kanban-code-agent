import { describe, expect, it, vi } from 'vitest';
import { spawn as realSpawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CodexAgentClient } from '../../application/codex-client.js';
import { RoutingAgentClient } from '../../cli/orquestrator-factory.js';
import { RunCancelledError } from '../../application/pi-client.js';
import type { AgentClient } from '../../application/agent-client.js';
import type { Agent } from '../../domain/agent.js';
import type { Task } from '../../domain/task.js';
import type { Orquestrator } from '../../application/orquestrator.js';
import { parseDecision } from '../../application/decision-parser.js';
import { buildOrquestrator } from '../_helpers/orquestrator-fixture.js';
import { completedDecision, testAgent } from '../_helpers/mock-agent.js';

const FAKE_APP_SERVER = fileURLToPath(new URL('../_helpers/fake-codex-app-server.mjs', import.meta.url));

const MODELS = {
  fast: { provider: 'deepseek', modelId: 'deepseek-v4-flash' },
  balanced: { provider: 'deepseek', modelId: 'deepseek-v4-flash' },
  deep: { provider: 'deepseek', modelId: 'deepseek-v4-pro' },
};

interface Captured {
  children: ChildProcess[];
  toolSockets: (string | undefined)[];
  socketExistsAtSpawn: boolean[];
}

function newCaptured(): Captured {
  return { children: [], toolSockets: [], socketExistsAtSpawn: [] };
}

// spawn injetado: ignora bin/args reais e sobe o fake app-server via node,
// preservando as options (env com CODEX_HOME/KCA_TOOLS_SOCKET, stdio).
function makeSpawn(variant: string, captured: Captured): typeof realSpawn {
  return ((_bin: string, _args: readonly string[], options: Record<string, unknown>) => {
    const child = realSpawn(process.execPath, [FAKE_APP_SERVER, variant], options as never);
    captured.children.push(child);
    const env = (options?.env ?? {}) as Record<string, string | undefined>;
    const socket = env.KCA_TOOLS_SOCKET;
    captured.toolSockets.push(socket);
    captured.socketExistsAtSpawn.push(typeof socket === 'string' ? existsSync(socket) : false);
    return child;
  }) as unknown as typeof realSpawn;
}

function buildCodexClient(dir: string, variant: string, captured: Captured): CodexAgentClient {
  return new CodexAgentClient('', ['read'], MODELS, 60, {
    codexHome: `${dir}/codexhome`,
    dataDir: dir,
    spawn: makeSpawn(variant, captured),
  });
}

function waitExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', () => resolve());
  });
}

describe('CodexAgentClient (fake app-server)', () => {
  it('passa a decisao estruturada e mapeia tokens do turn/completed', async () => {
    const { orquestrator, dir, cleanup } = buildOrquestrator({}, { stopWhenWaiting: true });
    const captured = newCaptured();
    try {
      const task = orquestrator.createRootTask('faca isso', 'agent-tester');
      const codex = buildCodexClient(dir, 'success', captured);

      const result = await codex.run(testAgent, task, orquestrator, []);
      const decision = parseDecision(result.output);

      expect(decision.status).toBe('completed');
      expect(decision.messages[0].text).toBe('feito pelo codex');
      expect(result.stats.tokens).toEqual({ input: 12, output: 7, total: 19 });

      await waitExit(captured.children[0]);
      expect(captured.children[0].exitCode !== null || captured.children[0].signalCode !== null).toBe(true);
    } finally {
      orquestrator.shutdown();
      cleanup();
    }
  });

  it('cai para os deltas de agentMessage quando nao ha item/completed', async () => {
    const { orquestrator, dir, cleanup } = buildOrquestrator({}, { stopWhenWaiting: true });
    const captured = newCaptured();
    try {
      const task = orquestrator.createRootTask('faca isso', 'agent-tester');
      const codex = buildCodexClient(dir, 'deltasonly', captured);

      const result = await codex.run(testAgent, task, orquestrator, []);
      const decision = parseDecision(result.output);

      expect(decision.messages[0].text).toBe('feito pelo codex');
    } finally {
      orquestrator.shutdown();
      cleanup();
    }
  });

  it('sobe e limpa o tool-callback UDS por run (KCA_TOOLS_SOCKET)', async () => {
    const { orquestrator, dir, cleanup } = buildOrquestrator({}, { stopWhenWaiting: true });
    const captured = newCaptured();
    try {
      const task = orquestrator.createRootTask('faca isso', 'agent-tester');
      const codex = buildCodexClient(dir, 'success', captured);

      await codex.run(testAgent, task, orquestrator, []);

      const socket = captured.toolSockets[0];
      expect(typeof socket).toBe('string');
      // Existia durante o run (server escutando) e foi removido no fim.
      expect(captured.socketExistsAtSpawn[0]).toBe(true);
      expect(existsSync(socket as string)).toBe(false);
    } finally {
      orquestrator.shutdown();
      cleanup();
    }
  });

  it('rejeita com Error quando o turno falha', async () => {
    const { orquestrator, dir, cleanup } = buildOrquestrator({}, { stopWhenWaiting: true });
    const captured = newCaptured();
    try {
      const task = orquestrator.createRootTask('faca isso', 'agent-tester');
      const codex = buildCodexClient(dir, 'fail', captured);

      await expect(codex.run(testAgent, task, orquestrator, [])).rejects.toThrow(/boom/);
      await waitExit(captured.children[0]);
    } finally {
      orquestrator.shutdown();
      cleanup();
    }
  });

  it('cancela via AbortSignal (RunCancelledError) e mata o processo', async () => {
    const { orquestrator, dir, cleanup } = buildOrquestrator({}, { stopWhenWaiting: true });
    const captured = newCaptured();
    const controller = new AbortController();
    try {
      const task = orquestrator.createRootTask('faca isso', 'agent-tester');
      const codex = buildCodexClient(dir, 'interrupt', captured);

      const runPromise = codex.run(testAgent, task, orquestrator, [], controller.signal);
      setTimeout(() => controller.abort(), 50);

      await expect(runPromise).rejects.toBeInstanceOf(RunCancelledError);

      await waitExit(captured.children[0]);
      expect(captured.children[0].exitCode !== null || captured.children[0].signalCode !== null).toBe(true);
    } finally {
      orquestrator.shutdown();
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Routing: seleciona pi/codex por task; constroi cada client sob demanda.
// ---------------------------------------------------------------------------

interface FakeClient extends AgentClient {
  calls: string[];
}

function recordingClient(tag: string): FakeClient {
  const calls: string[] = [];
  return {
    calls,
    async run(_agent: Agent, task: Task) {
      calls.push(task.taskId);
      return { output: completedDecision(tag), stats: {} };
    },
    buildRunConfig() {
      return {} as never;
    },
    async repairInvalidOutput() {
      return { output: '', stats: {} };
    },
    buildRepairRunConfig() {
      return {} as never;
    },
    async generateTitle() {
      calls.push('title');
      return tag;
    },
  } as FakeClient;
}

function fakeOrquestrator(): Orquestrator {
  return {
    resolveRuntimeConfig: (task: Task) => ({ agent: task.options.runtimeConfig?.agent ?? 'pi' }),
  } as unknown as Orquestrator;
}

function fakeTask(taskId: string, agent?: 'pi' | 'codex'): Task {
  return { taskId, options: { runtimeConfig: agent ? { agent } : undefined } } as unknown as Task;
}

describe('RoutingAgentClient', () => {
  it('roteia task com agent codex para o codex client sem construir o pi', async () => {
    const pi = recordingClient('pi');
    const codex = recordingClient('codex');
    const makePi = vi.fn(() => pi);
    const makeCodex = vi.fn(() => codex);
    const routing = new RoutingAgentClient(makePi, makeCodex, () => 'pi');

    await routing.run(testAgent, fakeTask('t1', 'codex'), fakeOrquestrator(), []);

    expect(codex.calls).toEqual(['t1']);
    expect(makeCodex).toHaveBeenCalledTimes(1);
    expect(makePi).not.toHaveBeenCalled();
  });

  it('roteia task default para o pi client sem construir o codex', async () => {
    const pi = recordingClient('pi');
    const codex = recordingClient('codex');
    const makePi = vi.fn(() => pi);
    const makeCodex = vi.fn(() => codex);
    const routing = new RoutingAgentClient(makePi, makeCodex, () => 'pi');

    await routing.run(testAgent, fakeTask('t2'), fakeOrquestrator(), []);

    expect(pi.calls).toEqual(['t2']);
    expect(makePi).toHaveBeenCalledTimes(1);
    expect(makeCodex).not.toHaveBeenCalled();
  });

  it('generateTitle usa o agent default e nao constroi o outro client', async () => {
    const pi = recordingClient('pi');
    const codex = recordingClient('codex');
    const makePi = vi.fn(() => pi);
    const makeCodex = vi.fn(() => codex);
    const routing = new RoutingAgentClient(makePi, makeCodex, () => 'pi');

    const title = await routing.generateTitle('uma mensagem qualquer');

    expect(title).toBe('pi');
    expect(makeCodex).not.toHaveBeenCalled();
  });
});
