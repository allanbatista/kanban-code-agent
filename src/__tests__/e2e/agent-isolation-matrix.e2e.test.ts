import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn as realSpawn, execFileSync, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Orquestrator, type OrquestratorDeps } from '../../application/orquestrator.js';
import { PiAgentClient, RunCancelledError } from '../../application/pi-client.js';
import type { AgentRunConfig, AgentRunResult, AgentRunner } from '../../application/pi-client.js';
import { CodexAgentClient } from '../../application/codex-client.js';
import { RoutingAgentClient } from '../../cli/orquestrator-factory.js';
import type { AgentClient } from '../../application/agent-client.js';
import {
  WorkerSupervisor,
  translateToContainer,
  CONTAINER_DATA_DIR,
} from '../../infrastructure/process/worker-supervisor.js';
import { resolveDevcontainerImage } from '../../infrastructure/containers/devcontainer.js';
import { SettingsStore } from '../../infrastructure/persistence/settings-store.js';
import { EventStore } from '../../infrastructure/persistence/event-store.js';
import { SnapshotStore } from '../../infrastructure/persistence/snapshot-store.js';
import { TaskFileStore } from '../../infrastructure/persistence/task-file-store.js';
import { PathSandbox } from '../../infrastructure/filesystem/sandbox.js';
import { createWorkerServer, listenWorkerServer, type WorkerServer } from '../../worker/server.js';
import { TASK_STATUS, SWARM_EVENT_TYPE, type AgentName } from '../../domain/types.js';
import type { Agent } from '../../domain/agent.js';
import type { Task } from '../../domain/task.js';
import type { SwarmEvent } from '../../domain/events.js';
import { completedDecision } from '../_helpers/mock-agent.js';

// ---------------------------------------------------------------------------
// F4.1 — matriz agent × isolation ponta a ponta, deterministica (sem rede, sem
// docker real). Prova a COMPOSICAO do contrato de produto: projeto (com/sem
// devcontainerPath) -> task por agent (pi/codex) -> run (runners fake) -> decisao
// -> worktree/merge -> gate REVIEW -> aprovacao -> COMPLETED. Combos ja cobertos
// por testes focados (buildDockerRunArgs, mcp-bridge, codex-client, worker-codex,
// git-worktree) NAO sao reexecutados; aqui o valor e a composicao completa e a
// selecao de agent/isolamento pelo Orquestrator real + RoutingAgentClient.
// ---------------------------------------------------------------------------

const FAKE_APP_SERVER = fileURLToPath(new URL('./fixtures/fake-codex-app-server.mjs', import.meta.url));

const TEST_MODELS = {
  fast: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'simples' },
  balanced: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'geral' },
  deep: { provider: 'deepseek', modelId: 'deepseek-v4-pro', description: 'critico' },
};
const AGENT_TOOLS = ['read', 'write'];

function ag(name: string): Agent {
  return { name, role: `Voce e ${name}.`, runtimeConfig: { model: 'fast', effort: 'off' }, tools: ['read', 'write'] };
}

// Cria um origin git real com um commit base; opcionalmente com devcontainer.json.
function initGitOrigin(root: string, opts: { devcontainer?: boolean } = {}): string {
  const origin = join(root, 'origin');
  const git = (args: string[]): void => void execFileSync('git', args, { cwd: origin, stdio: 'ignore' });
  mkdirSync(origin, { recursive: true });
  execFileSync('git', ['init', '--initial-branch=main', origin], { stdio: 'ignore' });
  git(['config', 'user.name', 'Test']);
  git(['config', 'user.email', 'test@example.invalid']);
  writeFileSync(join(origin, 'README.md'), 'base\n');
  if (opts.devcontainer) {
    mkdirSync(join(origin, '.devcontainer'), { recursive: true });
    writeFileSync(join(origin, '.devcontainer', 'devcontainer.json'), JSON.stringify({ image: 'debian:bookworm-slim' }));
  }
  git(['add', '-A']);
  git(['commit', '-m', 'base']);
  return origin;
}

// spawn injetado: ignora bin/args e sobe o fake app-server (F4.1) via node,
// preservando env (CODEX_HOME/KCA_TOOLS_SOCKET) e stdio. Registra os filhos p/
// asserts de cancelamento.
function makeCodexSpawn(variant: string, children: ChildProcess[]): typeof realSpawn {
  return ((_bin: string, _args: readonly string[], options: Record<string, unknown>) => {
    const child = realSpawn(process.execPath, [FAKE_APP_SERVER, variant], options as never);
    children.push(child);
    return child;
  }) as unknown as typeof realSpawn;
}

interface HarnessOptions {
  dir: string;
  isolation: 'inproc' | 'docker';
  defaultAgent?: AgentName;
  piRunner?: AgentRunner;
  codexVariant?: string;
  codexChildren?: ChildProcess[];
  workerSupervisor?: WorkerSupervisor;
  agents?: Agent[];
}

// Monta o RoutingAgentClient igual a factory de producao: pi = PiAgentClient com
// runner fake; codex = CodexAgentClient com spawn injetado -> fake app-server.
// Cada client nasce sob demanda (o codex so spawna num run codex real).
function buildRouting(opts: HarnessOptions): { routing: RoutingAgentClient; piCalls: string[] } {
  const piCalls: string[] = [];
  const piRunner: AgentRunner = opts.piRunner ?? {
    async run(config: AgentRunConfig): Promise<AgentRunResult> {
      piCalls.push(basename(dirname(String(config.cwd))));
      return { output: completedDecision('feito pelo pi'), stats: { tokens: { input: 1, output: 1, total: 2 }, cost: 0 } };
    },
  };
  const routing = new RoutingAgentClient(
    () => new PiAgentClient(piRunner, '', AGENT_TOOLS, TEST_MODELS, 60),
    () =>
      new CodexAgentClient('', AGENT_TOOLS, TEST_MODELS, 60, {
        codexHome: join(opts.dir, 'codexhome'),
        dataDir: opts.dir,
        spawn: makeCodexSpawn(opts.codexVariant ?? 'success', opts.codexChildren ?? []),
      }) as unknown as AgentClient,
    () => opts.defaultAgent ?? 'pi',
  );
  return { routing, piCalls };
}

function buildOrc(opts: HarnessOptions): { orc: Orquestrator; piCalls: string[] } {
  const sandbox = new PathSandbox(opts.dir);
  const { routing, piCalls } = buildRouting(opts);
  const deps: OrquestratorDeps = {
    eventStore: new EventStore(sandbox),
    snapshotStore: new SnapshotStore(sandbox),
    taskFileStore: new TaskFileStore(sandbox),
    sandbox,
    agents: opts.agents ?? [ag('Manager'), ag('Engineer')],
    piClient: routing,
    workerSupervisor: opts.workerSupervisor,
    models: TEST_MODELS,
  };
  const orc = new Orquestrator(deps, { isolation: opts.isolation, defaultAgent: opts.defaultAgent, runTimeoutMs: 5000 });
  return { orc, piCalls };
}

function events(orc: Orquestrator): SwarmEvent[] {
  return (orc as unknown as { events: SwarmEvent[] }).events;
}

function hasEvent(orc: Orquestrator, type: string, taskId: string): boolean {
  return events(orc).some((e) => e.type === type && e.taskId === taskId);
}

function waitFor(fn: () => void, timeout = 4000): Promise<void> {
  return vi.waitFor(fn, { timeout, interval: 20 });
}

// Payload capturado pelo worker docker injetado (POST /run do supervisor).
interface DockerRun {
  images: (string | undefined)[];
  payloads: Array<{ agent: string; config: { cwd: string }; callbackSocketPath: string }>;
  stopped: string[];
}

// startWorker injetado: sobe um WorkerServer real no host que captura o payload
// serializado e devolve uma decisao completed (o worker out-of-process real com
// agent codex ja e coberto por worker-codex.test.ts). O 3o arg e a imagem.
function fakeDockerSupervisor(
  routing: AgentClient,
  dir: string,
  capture: DockerRun,
  workers: WorkerServer[],
  onRun?: (payload: DockerRun['payloads'][number]) => void,
): WorkerSupervisor {
  return new WorkerSupervisor(routing, {
    mode: 'docker',
    runTimeoutMs: 5000,
    dataDir: dir,
    startWorker: async (socketPath, _containerName, image) => {
      capture.images.push(image);
      const worker = createWorkerServer({
        async run(input) {
          const payload = input as DockerRun['payloads'][number];
          capture.payloads.push({ agent: payload.agent, config: payload.config, callbackSocketPath: payload.callbackSocketPath });
          onRun?.(payload);
          return { output: completedDecision('feito no container'), stats: { tokens: { input: 1, output: 1, total: 2 }, cost: 0 } };
        },
      });
      workers.push(worker);
      await listenWorkerServer(worker, socketPath);
    },
    stopWorker: (containerName) => {
      capture.stopped.push(containerName);
    },
  });
}

describe('E2E F4.1 — matriz agent × isolation', () => {
  const cleanups: Array<() => void | Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  function scratch(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    cleanups.push(() => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* noop */
      }
    });
    return dir;
  }

  // -------------------------------------------------------------------------
  // 1. agent pi × inproc — fluxo completo com projeto SEM devcontainer.
  // -------------------------------------------------------------------------
  it('pi × inproc: projeto -> Manager(pi) -> REVIEW -> aprovacao -> COMPLETED', async () => {
    const dir = scratch('m-pi-inproc-');
    const origin = initGitOrigin(dir);
    const { orc, piCalls } = buildOrc({ dir, isolation: 'inproc' });
    const codexChildren: ChildProcess[] = [];
    cleanups.push(() => orc.shutdown());

    const project = orc.createProject({ name: 'App', slug: 'app', gitUrl: origin, defaultBranch: 'main' });
    expect(project.devcontainerPath).toBeUndefined();

    const task = orc.createRootTask('Ajustar readme', 'Manager', { agent: 'pi', model: 'fast', effort: 'off' }, [], undefined, [project.slug]);
    expect(orc.resolveRuntimeConfig(task).agent).toBe('pi');

    await waitFor(() => expect(task.status).toBe(TASK_STATUS.REVIEW));
    expect(hasEvent(orc, SWARM_EVENT_TYPE.WORKTREE_CREATED, task.taskId)).toBe(true);
    expect(hasEvent(orc, SWARM_EVENT_TYPE.TASK_REVIEW, task.taskId)).toBe(true);
    expect(piCalls).toContain(task.taskId); // rodou pelo runner do pi.
    expect(codexChildren).toHaveLength(0); // codex nunca foi construido/spawnado.

    orc.completeTaskByUser(task.taskId);
    expect(task.status).toBe(TASK_STATUS.COMPLETED);
    expect(hasEvent(orc, SWARM_EVENT_TYPE.TASK_COMPLETED, task.taskId)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. agent codex × inproc — decisao NATIVA via outputSchema + round-trip de
  //    post_message pelo tool-callback UDS (caminho MCP-independent).
  // -------------------------------------------------------------------------
  it('codex × inproc: decisao via outputSchema + post_message pelo UDS -> REVIEW -> COMPLETED', async () => {
    const dir = scratch('m-codex-inproc-');
    const origin = initGitOrigin(dir);
    const codexChildren: ChildProcess[] = [];
    const { orc, piCalls } = buildOrc({ dir, isolation: 'inproc', codexVariant: 'success', codexChildren });
    cleanups.push(() => orc.shutdown());

    const project = orc.createProject({ name: 'App', slug: 'app', gitUrl: origin, defaultBranch: 'main' });
    const task = orc.createRootTask('Ajustar readme', 'Manager', { agent: 'codex', model: 'fast', effort: 'off' }, [], undefined, [project.slug]);
    expect(orc.resolveRuntimeConfig(task).agent).toBe('codex');

    await waitFor(() => expect(task.status).toBe(TASK_STATUS.REVIEW));
    // Decisao estruturada nativa (turn.output) chegou como mensagem de resultado.
    expect(task.chat.some((m) => m.text === 'feito pelo codex (e2e)')).toBe(true);
    // Round-trip do post_message pelo listenToolServer (UDS) foi aplicado ao chat.
    expect(task.chat.some((m) => m.role === 'assistant' && m.text === 'codex progrediu via UDS')).toBe(true);
    expect(codexChildren.length).toBeGreaterThanOrEqual(1); // spawnou o app-server codex.
    expect(piCalls).toHaveLength(0); // pi nunca rodou.

    orc.completeTaskByUser(task.taskId);
    expect(task.status).toBe(TASK_STATUS.COMPLETED);
  });

  // -------------------------------------------------------------------------
  // 3. agent pi × docker — startWorker injetado; payload serializado carrega o
  //    agent 'pi', a cwd (traduzivel p/ /kca/data) e imagem default (undefined).
  // -------------------------------------------------------------------------
  it('pi × docker: payload serializado (agent, cwd traduzida, imagem default) -> REVIEW -> COMPLETED', async () => {
    const dir = scratch('m-pi-docker-');
    const origin = initGitOrigin(dir);
    const capture: DockerRun = { images: [], payloads: [], stopped: [] };
    const workers: WorkerServer[] = [];
    const { routing } = buildRouting({ dir, isolation: 'docker' });
    const supervisor = fakeDockerSupervisor(routing, dir, capture, workers);
    const { orc } = buildOrc({ dir, isolation: 'docker', workerSupervisor: supervisor });
    cleanups.push(async () => {
      for (const w of workers) await w.close().catch(() => undefined);
      orc.shutdown();
    });

    const project = orc.createProject({ name: 'App', slug: 'app', gitUrl: origin, defaultBranch: 'main' });
    const task = orc.createRootTask('Ajustar readme', 'Manager', { agent: 'pi', model: 'fast', effort: 'off' }, [], undefined, [project.slug]);

    await waitFor(() => expect(task.status).toBe(TASK_STATUS.REVIEW));

    expect(capture.payloads).toHaveLength(1);
    const payload = capture.payloads[0];
    expect(payload.agent).toBe('pi'); // agent field serializado.
    // cwd = workspace da task sob o dataDir -> traduzivel para /kca/data no container.
    expect(translateToContainer(payload.config.cwd, dir, process.cwd()).startsWith(CONTAINER_DATA_DIR)).toBe(true);
    // Sem devcontainer -> imageOverride undefined (supervisor usa a workerImage default).
    expect(capture.images[0]).toBeUndefined();
    expect(capture.stopped).toHaveLength(1); // container parado (cleanup).

    orc.completeTaskByUser(task.taskId);
    expect(task.status).toBe(TASK_STATUS.COMPLETED);
  });

  // -------------------------------------------------------------------------
  // 4. agent codex × docker COM imageOverride de projeto com devcontainerPath.
  //    A tag do devcontainer flui do resolveRunImage -> startWorker e para os
  //    args do docker run. Um `docker` fake no PATH resolve o cache-hit (sem
  //    docker real); um execFile fake exercita explicitamente o caminho de build.
  // -------------------------------------------------------------------------
  it('codex × docker: devcontainerPath -> tag flui para o startWorker e docker args', async () => {
    const dir = scratch('m-codex-docker-');
    const origin = initGitOrigin(dir, { devcontainer: true });
    const capture: DockerRun = { images: [], payloads: [], stopped: [] };
    const workers: WorkerServer[] = [];
    const { routing } = buildRouting({ dir, isolation: 'docker' });
    const supervisor = fakeDockerSupervisor(routing, dir, capture, workers);
    const { orc } = buildOrc({ dir, isolation: 'docker', workerSupervisor: supervisor });

    // `docker` fake no PATH: `image inspect` -> exit 0 (cache-hit), sem build real.
    const fakeBin = join(dir, 'fakebin');
    mkdirSync(fakeBin, { recursive: true });
    const dockerShim = join(fakeBin, 'docker');
    writeFileSync(dockerShim, '#!/bin/sh\nexit 0\n');
    chmodSync(dockerShim, 0o755);
    const savedPath = process.env.PATH;
    process.env.PATH = `${fakeBin}:${savedPath ?? ''}`;
    cleanups.push(async () => {
      process.env.PATH = savedPath;
      for (const w of workers) await w.close().catch(() => undefined);
      orc.shutdown();
    });

    const project = orc.createProject({
      name: 'App',
      slug: 'app',
      gitUrl: origin,
      defaultBranch: 'main',
      devcontainerPath: '.devcontainer/devcontainer.json',
    });
    expect(project.devcontainerPath).toBe('.devcontainer/devcontainer.json');

    const task = orc.createRootTask('Ajustar readme', 'Manager', { agent: 'codex', model: 'fast', effort: 'off' }, [], undefined, [project.slug]);

    await waitFor(() => expect(task.status).toBe(TASK_STATUS.REVIEW));

    expect(capture.payloads).toHaveLength(1);
    expect(capture.payloads[0].agent).toBe('codex'); // codex serializado no payload.
    const tag = capture.images[0];
    expect(tag).toMatch(/^kca-devc-app-[0-9a-f]{12}$/); // tag do devcontainer fluiu p/ o startWorker.

    // A mesma tag entra nos args do `docker run` (imageOverride vence a default).
    const dockerArgs = supervisor.buildDockerRunArgs('/host/data/.swarm/workers/x.sock', 'kca-x', undefined, tag!);
    expect(dockerArgs).toContain(tag);

    orc.completeTaskByUser(task.taskId);
    expect(task.status).toBe(TASK_STATUS.COMPLETED);
  });

  // Caminho de build explicito (execFile fake): cache-miss -> `devcontainer build`
  // -> tag; e a tag flui para os args do docker run. Prova literal do contrato F3.2.
  it('codex × docker: execFile fake do devcontainer build produz a tag que vai p/ os docker args', () => {
    const dir = scratch('m-devc-build-');
    const workspaceFolder = join(dir, 'ws');
    mkdirSync(workspaceFolder, { recursive: true });
    const configPath = join(workspaceFolder, 'devcontainer.json');
    writeFileSync(configPath, JSON.stringify({ image: 'debian:bookworm-slim' }));

    const calls: string[][] = [];
    const tag = resolveDevcontainerImage({
      workspaceFolder,
      configPath,
      slug: 'app',
      execFile: ((bin: string, args: readonly string[]) => {
        calls.push([bin, ...args]);
        // cache-miss forcado: `docker image inspect` lanca -> segue para o build.
        if (args[0] === 'image' && args[1] === 'inspect') throw new Error('cache miss');
        return Buffer.from('');
      }) as unknown as typeof execFileSync,
    });

    expect(tag).toMatch(/^kca-devc-app-[0-9a-f]{12}$/);
    expect(calls.some((c) => c.includes('build'))).toBe(true); // build via CLI foi invocado.

    const supervisor = new WorkerSupervisor(buildRouting({ dir, isolation: 'docker' }).routing, {
      mode: 'docker',
      runTimeoutMs: 1000,
      dataDir: '/host/data',
      workingDirectory: '/repo',
    });
    const args = supervisor.buildDockerRunArgs('/host/data/.swarm/workers/x.sock', 'kca-x', undefined, tag);
    expect(args).toContain(tag);
  });

  // -------------------------------------------------------------------------
  // 5. Settings define o agent default: task SEM agent explicito usa o default
  //    dos settings (SettingsStore seed 'codex') e roteia para o codex.
  // -------------------------------------------------------------------------
  it('settings default agent: SettingsStore=codex -> task sem agent roteia p/ codex', async () => {
    const dir = scratch('m-settings-');
    const origin = initGitOrigin(dir);
    // Persiste settings com agent 'codex' e alimenta o runtime a partir do store.
    const store = new SettingsStore(dir);
    const settings = store.load();
    settings.agent = 'codex';
    store.save(settings);
    expect(store.getAgent()).toBe('codex');

    const codexChildren: ChildProcess[] = [];
    const { orc, piCalls } = buildOrc({ dir, isolation: 'inproc', defaultAgent: store.getAgent(), codexChildren });
    cleanups.push(() => orc.shutdown());

    const project = orc.createProject({ name: 'App', slug: 'app', gitUrl: origin, defaultBranch: 'main' });
    // Sem runtimeConfig.agent — o default vem dos settings.
    const task = orc.createRootTask('Ajustar readme', 'Manager', { model: 'fast', effort: 'off' }, [], undefined, [project.slug]);
    expect(task.options.runtimeConfig?.agent).toBeUndefined();
    expect(orc.resolveRuntimeConfig(task).agent).toBe('codex');

    await waitFor(() => expect(task.status).toBe(TASK_STATUS.REVIEW));
    expect(codexChildren.length).toBeGreaterThanOrEqual(1); // rodou pelo codex (default dos settings).
    expect(piCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 6. Subtask herda o agent do pai (create_subtask sem override explicito).
  // -------------------------------------------------------------------------
  it('subtask herda o agent do pai via create_subtask', async () => {
    const dir = scratch('m-inherit-');
    const { orc } = buildOrc({ dir, isolation: 'inproc' });
    cleanups.push(() => orc.shutdown());

    const parent = orc.createRootTask('Coordenar entrega', 'Manager', { agent: 'codex', model: 'fast', effort: 'off' });
    const tools = orc.buildAgentTools(parent, true);
    const createSubtask = tools.find((t) => t.name === 'create_subtask');
    expect(createSubtask).toBeDefined();

    const meta = JSON.parse(await createSubtask!.execute({ assignedTo: 'Engineer', title: 'Implementar', message: 'implementar item' })) as { taskId: string };
    const subtask = orc.tasks.get(meta.taskId)!;
    expect(subtask.options.runtimeConfig?.agent).toBe('codex'); // herdou.
    expect(orc.resolveRuntimeConfig(subtask).agent).toBe('codex');

    // Override explicito vence a heranca.
    const meta2 = JSON.parse(await createSubtask!.execute({ assignedTo: 'Engineer', title: 'Outro', message: 'outro item', agent: 'pi' })) as { taskId: string };
    expect(orc.tasks.get(meta2.taskId)!.options.runtimeConfig?.agent).toBe('pi');
  });

  // -------------------------------------------------------------------------
  // 7. Cancel mid-run para cada agent -> CANCELLED (family cancel).
  // -------------------------------------------------------------------------
  it('cancel mid-run (pi): runner em voo e abortado -> CANCELLED', async () => {
    const dir = scratch('m-cancel-pi-');
    const hangingRunner: AgentRunner = {
      run(config: AgentRunConfig): Promise<AgentRunResult> {
        return new Promise((_resolve, reject) => {
          config.signal?.addEventListener('abort', () => reject(new RunCancelledError()));
        });
      },
    };
    const { orc } = buildOrc({ dir, isolation: 'inproc', piRunner: hangingRunner });
    cleanups.push(() => orc.shutdown());

    const task = orc.createRootTask('Trabalho longo', 'Manager', { agent: 'pi', model: 'fast', effort: 'off' });
    await waitFor(() => expect(task.status).toBe(TASK_STATUS.RUNNING));

    orc.cancelTask(task.taskId);
    expect(task.status).toBe(TASK_STATUS.CANCELLED);
    expect(hasEvent(orc, SWARM_EVENT_TYPE.TASK_CANCELLED, task.taskId)).toBe(true);
  });

  it('cancel mid-run (codex): app-server em voo e interrompido -> CANCELLED + processo morto', async () => {
    const dir = scratch('m-cancel-codex-');
    const codexChildren: ChildProcess[] = [];
    const { orc } = buildOrc({ dir, isolation: 'inproc', codexVariant: 'interrupt', codexChildren });
    cleanups.push(() => orc.shutdown());

    const task = orc.createRootTask('Trabalho longo', 'Manager', { agent: 'codex', model: 'fast', effort: 'off' });
    await waitFor(() => expect(task.status).toBe(TASK_STATUS.RUNNING));
    await waitFor(() => expect(codexChildren.length).toBeGreaterThanOrEqual(1)); // app-server spawnado.

    orc.cancelTask(task.taskId);
    expect(task.status).toBe(TASK_STATUS.CANCELLED);

    // O processo do app-server e efetivamente encerrado (turn/interrupt + kill).
    await waitFor(() =>
      expect(codexChildren[0].exitCode !== null || codexChildren[0].signalCode !== null).toBe(true),
    );
  });
});
