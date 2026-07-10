import { execFileSync } from 'node:child_process';
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Agent } from '../../domain/agent.js';
import type { Task } from '../../domain/task.js';
import type { AgentName } from '../../domain/types.js';
import type { SwarmEvent } from '../../domain/events.js';
import type { Orquestrator } from '../../application/orquestrator.js';
import { RunCancelledError, type AgentRunConfig, type AgentRunResult, type CustomToolSpec } from '../../application/pi-client.js';
import type { AgentClient } from '../../application/agent-client.js';
import type {
  ScopeSpecItem,
  ProgressLogEntry,
  EnvResume,
} from '../persistence/task-file-store.js';

export type IsolationMode = 'inproc' | 'docker';

// Container-side layout: o host dataDir vira /kca/data (rw — cobre sockets UDS,
// workspaces das tasks e o CODEX_HOME sob .swarm/auth) e o repo vira /kca/app
// (ro — de onde o worker é executado). Só esses dois prefixos existem no payload.
export const CONTAINER_DATA_DIR = '/kca/data';
export const CONTAINER_APP_DIR = '/kca/app';
const CONTAINER_WORKER_ENTRY = `${CONTAINER_APP_DIR}/src/worker/main.ts`;
// Bundle F2.2 montado ro em /kca/bin: node + codex + worker.mjs single-file.
export const CONTAINER_BUNDLE_DIR = '/kca/bin';
const CONTAINER_BUNDLE_NODE = `${CONTAINER_BUNDLE_DIR}/bin/node`;
const CONTAINER_BUNDLE_WORKER = `${CONTAINER_BUNDLE_DIR}/worker.mjs`;
const CONTAINER_BUNDLE_CODEX = `${CONTAINER_BUNDLE_DIR}/bin/codex`;
// ponytail: grace curta do SIGTERM->SIGKILL no `docker stop`; o worker fecha o
// server no SIGTERM. O timeout de run em si é aplicado pelo Master (WorkerPool).
const DOCKER_STOP_TIMEOUT_SEC = 5;
const DEFAULT_WORKER_IMAGE = 'node:24-slim';

export interface WorkerSupervisorOptions {
  mode?: IsolationMode;
  runTimeoutMs: number;
  workerHoldMs?: number;
  dataDir?: string;
  dockerBin?: string;
  /** Repo montado ro em /kca/app; o worker roda daqui (default process.cwd()). */
  workingDirectory?: string;
  /** Imagem do worker (default node:24-slim / SWARM_WORKER_IMAGE). */
  workerImage?: string;
  /** CODEX_HOME no host (sob dataDir); traduzido p/ o env do container. */
  codexHome?: string;
  /** Binario do codex visto DE DENTRO do container (-e SWARM_CODEX_BIN). Default
   *  /kca/bin/bin/codex quando workerBundleDir esta setado. */
  codexBin?: string;
  /** Dir do bundle F2.2 no host; montado ro em /kca/bin. Quando setado, o worker
   *  roda do bundle single-file (node+worker.mjs) em vez do repo via tsx. */
  workerBundleDir?: string;
  memoryMax?: string;
  cpuQuota?: string;
  /** Env extra do worker (keys de provider resolvidas); vai via --env-file 0600. */
  workerEnv?: Record<string, string>;
  // ponytail: override do comando do worker; F2.3 troca o entry tsx pelo bundle
  // single-file. Recebe o prefixo do comando; `--socket <path>` é anexado.
  workerCmd?: string[];
  execFile?: typeof execFileSync;
  startWorker?: (socketPath: string, unitName: string) => void | Promise<void>;
  stopWorker?: (unitName: string) => void | Promise<void>;
}

type SerializableToolSpec = Omit<CustomToolSpec, 'execute'>;
type SerializableRunConfig = Omit<AgentRunConfig, 'customTools' | 'signal'> & {
  customTools?: SerializableToolSpec[];
};

export class WorkerSupervisor {
  private readonly mode: IsolationMode;
  private readonly dockerBin: string;
  private readonly workingDirectory: string;
  private readonly workerImage: string;
  private readonly codexHome?: string;
  private readonly codexBin?: string;
  private readonly workerBundleDir?: string;
  private readonly workerEnv: Record<string, string>;
  private readonly workerCmdOverride?: string[];
  private readonly memoryMax?: string;
  private readonly cpuQuota?: string;
  private readonly workerHoldMs: number;
  private readonly execFile: typeof execFileSync;
  // Só remapeia paths host->container quando o supervisor lança o container ele
  // mesmo. Com startWorker injetado (testes/extensão), o worker vive no espaço
  // de paths do host, então o payload segue com paths do host.
  private readonly ownsLaunch: boolean;
  private readonly startWorkerImpl: (socketPath: string, unitName: string) => void | Promise<void>;
  private readonly stopWorkerImpl?: (unitName: string) => void | Promise<void>;

  constructor(
    private readonly piClient: AgentClient,
    private readonly options: WorkerSupervisorOptions,
  ) {
    this.mode = options.mode ?? 'inproc';
    this.dockerBin = options.dockerBin ?? 'docker';
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.workerImage = options.workerImage ?? process.env.SWARM_WORKER_IMAGE ?? DEFAULT_WORKER_IMAGE;
    this.codexHome = options.codexHome;
    this.workerBundleDir = options.workerBundleDir ?? process.env.SWARM_WORKER_BUNDLE_DIR;
    // codexBin: opcao explicita vence; senao o codex do bundle quando montado.
    this.codexBin = options.codexBin ?? (this.workerBundleDir ? CONTAINER_BUNDLE_CODEX : undefined);
    this.workerEnv = options.workerEnv ?? {};
    this.workerCmdOverride = options.workerCmd;
    this.memoryMax = options.memoryMax ?? process.env.SWARM_WORKER_MEMORY_MAX;
    this.cpuQuota = options.cpuQuota ?? process.env.SWARM_WORKER_CPU_QUOTA;
    this.workerHoldMs = options.workerHoldMs ?? readPositiveInt(process.env.SWARM_WORKER_HOLD_MS);
    this.execFile = options.execFile ?? execFileSync;
    this.ownsLaunch = !options.startWorker;
    this.startWorkerImpl = options.startWorker ?? ((socketPath, unitName) => this.startDockerWorker(socketPath, unitName));
    this.stopWorkerImpl = options.stopWorker ?? (options.startWorker ? undefined : (unitName) => this.stopDockerWorker(unitName));
  }

  get isolationMode(): IsolationMode {
    return this.mode;
  }

  async runAgent(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    triggerEvents: SwarmEvent[],
    signal?: AbortSignal,
    continuity?: {
      scopeSpec?: ScopeSpecItem[];
      progressLog?: ProgressLogEntry[];
      envResume?: EnvResume | null;
    },
  ): Promise<AgentRunResult> {
    if (this.mode === 'inproc') {
      return this.piClient.run(agent, task, orquestrator, triggerEvents, signal, continuity);
    }
    const config = this.piClient.buildRunConfig(agent, task, orquestrator, triggerEvents, undefined, continuity);
    const agentName = orquestrator.resolveRuntimeConfig(task, agent).agent;
    return this.runInDocker(task.taskId, task.activeRunId ?? 'run', config, agentName, signal);
  }

  async repairInvalidOutput(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    errorMessage: string,
    invalidOutput: string,
    signal?: AbortSignal,
  ): Promise<AgentRunResult> {
    if (this.mode === 'inproc') {
      return this.piClient.repairInvalidOutput(agent, task, orquestrator, errorMessage, invalidOutput, signal);
    }
    const config = this.piClient.buildRepairRunConfig(agent, task, orquestrator, errorMessage, invalidOutput);
    const agentName = orquestrator.resolveRuntimeConfig(task, agent).agent;
    return this.runInDocker(task.taskId, task.activeRunId ?? 'repair', config, agentName, signal);
  }

  /**
   * Monta os args do `docker run`. `socketPath` é o path no host; o worker
   * recebe o path traduzido para o container (--socket) e os sockets/workspace
   * chegam pelos mounts. Segredos NUNCA entram no argv — vão no --env-file 0600.
   */
  buildDockerRunArgs(socketPath: string, containerName = 'kca-worker', envFilePath?: string): string[] {
    const containerSocketPath = this.toContainer(socketPath);
    const args = [
      'run',
      '-d',
      '--rm',
      '--init',
      '--name',
      containerName,
      '--stop-timeout',
      String(DOCKER_STOP_TIMEOUT_SEC),
    ];

    // uid:gid do host para que sockets criados no bind-mount pertençam ao host
    // (cleanup) e o worker não rode como root no container.
    const user = containerUser();
    if (user) args.push('-u', user);

    args.push('-v', `${this.dataDir}:${CONTAINER_DATA_DIR}`);
    args.push('-v', `${this.workingDirectory}:${CONTAINER_APP_DIR}:ro`);
    // Bundle F2.2 (node+codex+worker.mjs) montado ro em /kca/bin quando configurado.
    if (this.workerBundleDir) args.push('-v', `${this.workerBundleDir}:${CONTAINER_BUNDLE_DIR}:ro`);
    args.push('-w', CONTAINER_APP_DIR);

    if (this.memoryMax) args.push('-m', this.memoryMax);
    const cpus = mapCpuQuota(this.cpuQuota);
    if (cpus) args.push('--cpus', cpus);
    if (envFilePath) args.push('--env-file', envFilePath);

    // Env não-secreto (paths do socket/CODEX_HOME/codex bin) via -e; keys no env-file.
    args.push('-e', `SWARM_WORKER_SOCKET=${containerSocketPath}`);
    if (this.codexHome) args.push('-e', `CODEX_HOME=${this.toContainer(this.codexHome)}`);
    // SWARM_CODEX_BIN: o codex é o do bundle montado (ou o path explícito); só o
    // path do container entra aqui — o binário chega pelo mount, não pelo argv.
    if (this.codexBin) args.push('-e', `SWARM_CODEX_BIN=${this.codexBin}`);

    args.push(this.workerImage);
    args.push(...this.workerCommand(containerSocketPath));
    return args;
  }

  canStartDocker(): boolean {
    try {
      this.execFile(this.dockerBin, ['info'], { stdio: ['ignore', 'ignore', 'ignore'] });
      return true;
    } catch {
      return false;
    }
  }

  startDockerWorker(socketPath: string, containerName: string): void {
    const envFilePath = envFileFor(socketPath);
    const args = this.buildDockerRunArgs(socketPath, containerName, existsSync(envFilePath) ? envFilePath : undefined);
    this.execFile(this.dockerBin, args, { stdio: ['ignore', 'ignore', 'ignore'] });
  }

  stopDockerWorker(containerName: string): void {
    // `docker stop` dispara SIGTERM (worker fecha o server); `--rm` remove ao sair.
    try {
      this.execFile(this.dockerBin, ['stop', containerName], { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      // container pode já ter saído (--rm); segue para o rm defensivo.
    }
    try {
      this.execFile(this.dockerBin, ['rm', '-f', containerName], { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      // já removido pelo --rm — ok.
    }
  }

  /** Traduz um path do host para a visão do container (/kca/data ou /kca/app). */
  private toContainer(hostPath: string): string {
    return translateToContainer(hostPath, this.dataDir, this.workingDirectory);
  }

  private get dataDir(): string {
    return this.options.dataDir ?? process.cwd();
  }

  private workerCommand(containerSocketPath: string): string[] {
    // workerCmd override vence; senao o bundle single-file (node do bundle +
    // worker.mjs) quando montado, ou o entry via tsx a partir do repo montado.
    const prefix =
      this.workerCmdOverride ??
      (this.workerBundleDir
        ? [CONTAINER_BUNDLE_NODE, CONTAINER_BUNDLE_WORKER]
        : ['node', '--import', 'tsx', CONTAINER_WORKER_ENTRY]);
    return [...prefix, '--socket', containerSocketPath];
  }

  private async runInDocker(
    taskId: string,
    runId: string,
    config: AgentRunConfig,
    agentName: AgentName,
    signal?: AbortSignal,
  ): Promise<AgentRunResult> {
    if (signal?.aborted) throw new RunCancelledError();
    const dataDir = this.dataDir;
    const containerName = dockerContainerName(taskId, runId);
    const socketPath = workerSocketPath(dataDir, taskId, runId);
    const callbackSocketPath = workerSocketPath(dataDir, taskId, `${runId}-tools`);
    const envFilePath = envFileFor(socketPath);
    mkdirSync(dirname(socketPath), { recursive: true });
    writeEnvFile(envFilePath, this.workerEnv);

    const toolServer = await listenToolServer(callbackSocketPath, config.customTools ?? []);
    // Só os paths DENTRO do payload precisam da visão do container: cwd (workspace
    // da task) e o callback socket, que a UDS do supervisor expõe no host.
    const toContainer = this.ownsLaunch ? (p: string) => this.toContainer(p) : (p: string) => p;
    const serializableConfig = translateConfigPaths(serializeRunConfig(config), toContainer);
    const containerCallbackPath = toContainer(callbackSocketPath);
    const cancel = () => {
      void unixJson(socketPath, 'POST', '/cancel', { runId }).catch(() => undefined);
    };
    signal?.addEventListener('abort', cancel);

    try {
      await this.startWorkerImpl(socketPath, containerName);
      await waitForWorker(socketPath);
      const response = await unixJson<{ ok: boolean; result?: AgentRunResult; error?: string }>(socketPath, 'POST', '/run', {
        runId,
        agent: agentName,
        config: serializableConfig,
        callbackSocketPath: containerCallbackPath,
      });
      if (!response.ok || !response.result) throw new Error(response.error ?? 'Worker docker falhou');
      if (signal?.aborted) throw new RunCancelledError();
      return response.result;
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (this.workerHoldMs > 0) await delay(this.workerHoldMs);
      await Promise.resolve(this.stopWorkerImpl?.(containerName)).catch(() => undefined);
      await closeServer(toolServer).catch(() => undefined);
      rmSync(socketPath, { force: true });
      rmSync(callbackSocketPath, { force: true });
      rmSync(envFilePath, { force: true });
    }
  }
}

// Nome do container: kca-<taskId>-<runId>, sanitizado para os chars aceitos pelo
// docker (--name) e limitado em tamanho.
function dockerContainerName(taskId: string, runId: string): string {
  return `kca-${taskId}-${runId}`.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 80);
}

// uid:gid do host (só em plataformas POSIX) para os arquivos criados no bind-mount.
function containerUser(): string | undefined {
  if (typeof process.getuid === 'function' && typeof process.getgid === 'function') {
    return `${process.getuid()}:${process.getgid()}`;
  }
  return undefined;
}

// CPUQuota ('50%') -> docker --cpus ('0.5'). Sem sufixo '%', passa direto.
function mapCpuQuota(quota: string | undefined): string | undefined {
  if (!quota) return undefined;
  const match = quota.match(/^(\d+(?:\.\d+)?)%$/);
  return match ? String(Number(match[1]) / 100) : quota;
}

// env-file do docker: uma key=valor por linha, 0600. Removido no finally do run.
function writeEnvFile(path: string, env: Record<string, string>): void {
  const lines = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  writeFileSync(path, lines.length ? `${lines.join('\n')}\n` : '', { mode: 0o600 });
  chmodSync(path, 0o600);
}

function envFileFor(socketPath: string): string {
  return socketPath.replace(/\.sock$/, '.env');
}

/**
 * Traduz um path do host para a visão do container. Só dois prefixos existem:
 * dataDir -> /kca/data e o repo -> /kca/app. Prefixo mais específico primeiro
 * (caso um esteja aninhado no outro). Fora deles, devolve o path inalterado.
 */
export function translateToContainer(hostPath: string, dataDir: string, repoDir: string): string {
  const mappings: Array<[string, string]> = [
    [dataDir, CONTAINER_DATA_DIR],
    [repoDir, CONTAINER_APP_DIR],
  ].sort((a, b) => b[0].length - a[0].length) as Array<[string, string]>;
  for (const [host, container] of mappings) {
    if (hostPath === host) return container;
    if (hostPath.startsWith(`${host}/`)) return container + hostPath.slice(host.length);
  }
  return hostPath;
}

function translateConfigPaths(
  config: SerializableRunConfig,
  toContainer: (path: string) => string,
): SerializableRunConfig {
  return { ...config, cwd: toContainer(config.cwd) };
}

export function workerSocketPath(dataDir: string, taskId: string, runId: string): string {
  return join(dataDir, '.swarm', 'workers', `${taskId}-${runId}.sock`);
}

function readPositiveInt(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeRunConfig(config: AgentRunConfig): SerializableRunConfig {
  const { signal: _signal, customTools, ...serializable } = config;
  return {
    ...serializable,
    customTools: customTools?.map(({ execute: _execute, ...tool }) => tool),
  };
}

// Exportado para reuso pelo CodexAgentClient (mesmo tool-callback UDS). Alem do
// POST /tool {name, params}, expoe GET /tools com os specs (name/description/
// parameters) para o MCP bridge do Codex montar tools/list. Evita duplicar o
// servidor entre supervisor e client.
export async function listenToolServer(socketPath: string, tools: CustomToolSpec[]): Promise<Server> {
  rmSync(socketPath, { force: true });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/tools') {
        const specs = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
        sendJson(response, 200, { ok: true, tools: specs });
        return;
      }
      if (request.method !== 'POST' || request.url !== '/tool') {
        sendJson(response, 404, { ok: false, error: 'not_found' });
        return;
      }
      const body = await readJson(request) as { name?: unknown; params?: Record<string, unknown> };
      const tool = typeof body.name === 'string' ? byName.get(body.name) : undefined;
      if (!tool) {
        sendJson(response, 404, { ok: false, error: 'tool_not_found' });
        return;
      }
      sendJson(response, 200, { ok: true, result: await tool.execute(body.params ?? {}) });
    } catch (error) {
      sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  await listenUnix(server, socketPath);
  return server;
}

function waitForWorker(socketPath: string): Promise<void> {
  // Janela larga (~20s): cobre o cold start de um container real (boot do node +
  // compile do tsx). Workers injetados (testes) respondem na 1a tentativa, sem
  // custo. O timeout de run em si é do Master (WorkerPool).
  return retry(async () => {
    const health = await unixJson<{ ok?: boolean }>(socketPath, 'GET', '/health');
    if (!health.ok) throw new Error('worker not ready');
  }, 100, 200);
}

async function retry(fn: () => Promise<void>, delayMs: number, attempts: number): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function unixJson<T>(socketPath: string, method: string, path: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        socketPath,
        method,
        path,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          try {
            const parsed = raw ? JSON.parse(raw) : {};
            if ((res.statusCode ?? 500) >= 400) reject(new Error(parsed.error ?? raw));
            else resolve(parsed as T);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function listenUnix(server: Server, socketPath: string): Promise<void> {
  mkdirSync(dirname(socketPath), { recursive: true });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
