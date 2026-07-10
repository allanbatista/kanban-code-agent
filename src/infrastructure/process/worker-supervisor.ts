import { execFileSync } from 'node:child_process';
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Agent } from '../../domain/agent.js';
import type { Task } from '../../domain/task.js';
import type { SwarmEvent } from '../../domain/events.js';
import type { Orquestrator } from '../../application/orquestrator.js';
import { RunCancelledError, type AgentRunConfig, type AgentRunResult, type CustomToolSpec } from '../../application/pi-client.js';
import type { AgentClient } from '../../application/agent-client.js';
import type {
  ScopeSpecItem,
  ProgressLogEntry,
  EnvResume,
} from '../persistence/task-file-store.js';

export type IsolationMode = 'inproc' | 'systemd';

export interface WorkerSupervisorOptions {
  mode?: IsolationMode;
  runTimeoutMs: number;
  workerHoldMs?: number;
  dataDir?: string;
  systemdRunBin?: string;
  nodeBin?: string;
  workerEntry?: string;
  workingDirectory?: string;
  readWritePaths?: string[];
  encryptedCredential?: string;
  memoryMax?: string;
  cpuQuota?: string;
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
  private readonly systemdRunBin: string;
  private readonly nodeBin: string;
  private readonly workerEntry: string;
  private readonly workingDirectory: string;
  private readonly readWritePaths: string[];
  private readonly memoryMax?: string;
  private readonly cpuQuota?: string;
  private readonly workerHoldMs: number;
  private readonly execFile: typeof execFileSync;
  private readonly startWorkerImpl: (socketPath: string, unitName: string) => void | Promise<void>;
  private readonly stopWorkerImpl?: (unitName: string) => void | Promise<void>;

  constructor(
    private readonly piClient: AgentClient,
    private readonly options: WorkerSupervisorOptions,
  ) {
    this.mode = options.mode ?? 'inproc';
    this.systemdRunBin = options.systemdRunBin ?? 'systemd-run';
    this.nodeBin = options.nodeBin ?? process.execPath;
    this.workerEntry = options.workerEntry ?? resolve('src/worker/main.ts');
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    this.readWritePaths = options.readWritePaths ?? (options.dataDir ? [options.dataDir] : []);
    this.memoryMax = options.memoryMax ?? process.env.SWARM_WORKER_MEMORY_MAX;
    this.cpuQuota = options.cpuQuota ?? process.env.SWARM_WORKER_CPU_QUOTA;
    this.workerHoldMs = options.workerHoldMs ?? readPositiveInt(process.env.SWARM_WORKER_HOLD_MS);
    this.execFile = options.execFile ?? execFileSync;
    this.startWorkerImpl = options.startWorker ?? ((socketPath, unitName) => this.startSystemdWorker(socketPath, unitName));
    this.stopWorkerImpl = options.stopWorker ?? (options.startWorker ? undefined : (unitName) => this.stopSystemdWorker(unitName));
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
    return this.runInSystemd(task.taskId, task.activeRunId ?? 'run', config, signal);
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
    return this.runInSystemd(task.taskId, task.activeRunId ?? 'repair', config, signal);
  }

  buildSystemdRunArgs(socketPath: string, unitName = 'kca-worker'): string[] {
    const args = [
      '--user',
      '--collect',
      `--unit=${unitName}`,
      `--property=RuntimeMaxSec=${Math.max(1, Math.ceil(this.options.runTimeoutMs / 1000))}`,
      `--property=WorkingDirectory=${this.workingDirectory}`,
      '--property=NoNewPrivileges=yes',
      '--property=PrivateTmp=yes',
      '--property=ProtectSystem=strict',
    ];

    for (const path of this.readWritePaths) {
      args.push(`--property=ReadWritePaths=${path}`);
    }
    if (this.memoryMax) {
      args.push(`--property=MemoryMax=${this.memoryMax}`);
    }
    if (this.cpuQuota) {
      args.push(`--property=CPUQuota=${this.cpuQuota}`);
    }
    if (this.options.encryptedCredential) {
      args.push(`--property=LoadCredentialEncrypted=git-token:${this.options.encryptedCredential}`);
    }

    args.push(this.nodeBin, '--import', 'tsx', this.workerEntry);
    args.push('--socket', socketPath);
    return args;
  }

  canStartSystemd(): boolean {
    try {
      this.execFile(this.systemdRunBin, ['--user', '--wait', '--collect', 'true'], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      return true;
    } catch {
      return false;
    }
  }

  startSystemdWorker(socketPath: string, unitName: string): void {
    this.execFile(this.systemdRunBin, this.buildSystemdRunArgs(socketPath, unitName), {
      env: { ...process.env, SWARM_WORKER_SOCKET: socketPath },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  }

  stopSystemdWorker(unitName: string): void {
    this.execFile('systemctl', ['--user', 'stop', `${unitName}.service`], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  }

  private async runInSystemd(
    taskId: string,
    runId: string,
    config: AgentRunConfig,
    signal?: AbortSignal,
  ): Promise<AgentRunResult> {
    if (signal?.aborted) throw new RunCancelledError();
    const dataDir = this.options.dataDir ?? process.cwd();
    const unitName = systemdUnitName(taskId, runId);
    const socketPath = workerSocketPath(dataDir, taskId, runId);
    const callbackSocketPath = workerSocketPath(dataDir, taskId, `${runId}-tools`);
    mkdirSync(dirname(socketPath), { recursive: true });

    const toolServer = await listenToolServer(callbackSocketPath, config.customTools ?? []);
    const serializableConfig = serializeRunConfig(config);
    const cancel = () => {
      void unixJson(socketPath, 'POST', '/cancel', { runId }).catch(() => undefined);
    };
    signal?.addEventListener('abort', cancel);

    try {
      await this.startWorkerImpl(socketPath, unitName);
      await waitForWorker(socketPath);
      const response = await unixJson<{ ok: boolean; result?: AgentRunResult; error?: string }>(socketPath, 'POST', '/run', {
        runId,
        config: serializableConfig,
        callbackSocketPath,
      });
      if (!response.ok || !response.result) throw new Error(response.error ?? 'Worker systemd falhou');
      if (signal?.aborted) throw new RunCancelledError();
      return response.result;
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (this.workerHoldMs > 0) await delay(this.workerHoldMs);
      await Promise.resolve(this.stopWorkerImpl?.(unitName)).catch(() => undefined);
      await closeServer(toolServer).catch(() => undefined);
      rmSync(socketPath, { force: true });
      rmSync(callbackSocketPath, { force: true });
    }
  }
}

export function workerSocketPath(dataDir: string, taskId: string, runId: string): string {
  return join(dataDir, '.swarm', 'workers', `${taskId}-${runId}.sock`);
}

function systemdUnitName(taskId: string, runId: string): string {
  return `kca-${taskId}-${runId}`.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 80);
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
  return retry(async () => {
    const health = await unixJson<{ ok?: boolean }>(socketPath, 'GET', '/health');
    if (!health.ok) throw new Error('worker not ready');
  }, 50, 40);
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
