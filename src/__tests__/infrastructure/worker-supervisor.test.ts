import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Orquestrator } from '../../application/orquestrator.js';
import type { Task } from '../../domain/task.js';
import { TASK_STATUS } from '../../domain/types.js';
import {
  WorkerSupervisor,
  translateToContainer,
  workerSocketPath,
} from '../../infrastructure/process/worker-supervisor.js';
import { resolveDevcontainerImage } from '../../infrastructure/containers/devcontainer.js';
import { createDeps, createPiClient, createPiClientWithRunner } from '../_helpers/orquestrator-fixture.js';
import { buildOrquestrator } from '../_helpers/orquestrator-fixture.js';
import { completedDecision, testAgent, throwingRunner, waitingDecision } from '../_helpers/mock-agent.js';
import { createWorkerServer, listenWorkerServer, type WorkerServer } from '../../worker/server.js';

function unixJson<T>(socketPath: string, path: string, body: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request(
      {
        socketPath,
        method: 'POST',
        path,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function unixGet(socketPath: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method: 'GET', path }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

function closeWorkers(workers: WorkerServer[]): void {
  for (const worker of workers) {
    worker.server.closeAllConnections?.();
    worker.server.close();
  }
}

function waitForTaskStatus(orquestrator: Orquestrator, task: Task, status: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`status atual: ${task.status}`)), 1000);
    const check = (): void => {
      if (task.status === status) {
        clearTimeout(timeout);
        resolve();
        return;
      }
      orquestrator.once('state:changed', check);
    };
    check();
  });
}

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

describe('WorkerSupervisor', () => {
  it('executa em modo inproc usando o PiAgentClient existente', async () => {
    const piClient = createPiClient([completedDecision('ok')]);
    const { orquestrator, cleanup } = buildOrquestrator({ piClient }, { stopWhenWaiting: true });
    try {
      const task = orquestrator.createRootTask('rodar', 'agent-tester');
      const supervisor = new WorkerSupervisor(piClient, { mode: 'inproc', runTimeoutMs: 1000 });

      const result = await supervisor.runAgent(testAgent, task, orquestrator, []);

      expect(result.output).toContain('"completed"');
    } finally {
      orquestrator.shutdown();
      cleanup();
    }
  });

  it('monta args do docker run com mounts, limites, --rm, nome e env-file (sem segredos no argv)', () => {
    const supervisor = new WorkerSupervisor(createPiClient([]), {
      mode: 'docker',
      runTimeoutMs: 1500,
      dataDir: '/host/data',
      workingDirectory: '/repo',
      workerImage: 'node:24-slim',
      codexHome: '/host/data/.swarm/auth/codex',
      memoryMax: '512m',
      cpuQuota: '50%',
      workerEnv: { DEEPSEEK_API_KEY: 'sk-secret-xyz' },
    });

    const args = supervisor.buildDockerRunArgs(
      '/host/data/.swarm/workers/task_1-run.sock',
      'kca-test',
      '/host/data/.swarm/workers/task_1-run.env',
    );

    expect(args.slice(0, 4)).toEqual(['run', '-d', '--rm', '--init']);
    expect(args).toContain('--name');
    expect(args).toContain('kca-test');
    expect(args).toContain('--stop-timeout');
    // Mounts: dataDir rw em /kca/data, repo ro em /kca/app.
    expect(args).toContain('/host/data:/kca/data');
    expect(args).toContain('/repo:/kca/app:ro');
    // Limites mapeados para docker: -m e --cpus (50% -> 0.5).
    expect(args).toContain('-m');
    expect(args).toContain('512m');
    expect(args).toContain('--cpus');
    expect(args).toContain('0.5');
    // Segredos vão no --env-file, nunca no argv.
    expect(args).toContain('--env-file');
    expect(args).toContain('/host/data/.swarm/workers/task_1-run.env');
    expect(args.join(' ')).not.toContain('sk-secret-xyz');
    // Env não-secreto com paths já traduzidos p/ o container.
    expect(args).toContain('SWARM_WORKER_SOCKET=/kca/data/.swarm/workers/task_1-run.sock');
    expect(args).toContain('CODEX_HOME=/kca/data/.swarm/auth/codex');
    // Imagem + comando do worker a partir do repo montado, --socket com path do container.
    expect(args).toContain('node:24-slim');
    expect(args).toContain('/kca/app/src/worker/main.ts');
    expect(args).toContain('--socket');
    expect(args).toContain('/kca/data/.swarm/workers/task_1-run.sock');
  });

  it('em modo bundle monta /kca/bin, roda o worker do bundle e seta SWARM_CODEX_BIN', () => {
    const supervisor = new WorkerSupervisor(createPiClient([]), {
      mode: 'docker',
      runTimeoutMs: 1500,
      dataDir: '/host/data',
      workingDirectory: '/repo',
      workerImage: 'debian:bookworm-slim',
      codexHome: '/host/data/.swarm/auth/codex',
      workerBundleDir: '/host/bundle',
    });

    const args = supervisor.buildDockerRunArgs('/host/data/.swarm/workers/task_1-run.sock', 'kca-bundle');

    // Bundle montado ro em /kca/bin; worker roda do node+worker.mjs do bundle.
    expect(args).toContain('/host/bundle:/kca/bin:ro');
    expect(args).toContain('/kca/bin/bin/node');
    expect(args).toContain('/kca/bin/worker.mjs');
    // codex do bundle exposto via -e (path do container, sem binário no argv).
    expect(args).toContain('SWARM_CODEX_BIN=/kca/bin/bin/codex');
    // Não roda mais via tsx a partir do repo.
    expect(args).not.toContain('/kca/app/src/worker/main.ts');
  });

  it('traduz paths do host para a visão do container (prefixo mais específico vence)', () => {
    expect(translateToContainer('/host/data/.swarm/workers/x.sock', '/host/data', '/repo')).toBe(
      '/kca/data/.swarm/workers/x.sock',
    );
    expect(translateToContainer('/repo/src/worker/main.ts', '/host/data', '/repo')).toBe(
      '/kca/app/src/worker/main.ts',
    );
    expect(translateToContainer('/host/data', '/host/data', '/repo')).toBe('/kca/data');
    expect(translateToContainer('/elsewhere/x', '/host/data', '/repo')).toBe('/elsewhere/x');
    // dataDir aninhado no repo: o prefixo mais longo (dataDir) precisa vencer.
    expect(translateToContainer('/repo/data/.swarm/x', '/repo/data', '/repo')).toBe('/kca/data/.swarm/x');
  });

  it('cancela via docker stop + rm defensivo e detecta daemon via docker info', () => {
    const calls: string[][] = [];
    const supervisor = new WorkerSupervisor(createPiClient([]), {
      mode: 'docker',
      runTimeoutMs: 1000,
      dockerBin: 'docker',
      execFile: ((bin: string, args: readonly string[]) => {
        calls.push([bin, ...args]);
        return Buffer.from('');
      }) as unknown as typeof execFileSync,
    });

    supervisor.stopDockerWorker('kca-abc');
    expect(calls).toContainEqual(['docker', 'stop', 'kca-abc']);
    expect(calls).toContainEqual(['docker', 'rm', '-f', 'kca-abc']);
    expect(supervisor.canStartDocker()).toBe(true);
  });

  it('canStartDocker retorna false quando docker info falha', () => {
    const supervisor = new WorkerSupervisor(createPiClient([]), {
      mode: 'docker',
      runTimeoutMs: 1000,
      execFile: (() => {
        throw new Error('docker daemon indisponível');
      }) as unknown as typeof execFileSync,
    });
    expect(supervisor.canStartDocker()).toBe(false);
  });

  it('executa modo docker via worker UDS e RPC minimo de tools', async () => {
    const workers: WorkerServer[] = [];
    const stopped: string[] = [];
    const piClient = createPiClient([]);
    const { orquestrator, dir, cleanup } = buildOrquestrator({ piClient }, { stopWhenWaiting: true });
    try {
      const task = orquestrator.createRootTask('rodar', 'agent-tester');
      const supervisor = new WorkerSupervisor(piClient, {
        mode: 'docker',
        runTimeoutMs: 1000,
        dataDir: dir,
        startWorker: async (socketPath) => {
          const worker = createWorkerServer({
            async run(input) {
              const body = input as { callbackSocketPath: string };
              await unixJson(body.callbackSocketPath, '/tool', {
                name: 'post_message',
                params: { text: 'worker externo rodando' },
              });
              return { output: completedDecision('ok'), stats: { tokens: { total: 1 }, cost: 0 } };
            },
          });
          workers.push(worker);
          await listenWorkerServer(worker, socketPath);
        },
        stopWorker: (containerName) => {
          stopped.push(containerName);
        },
      });

      const result = await supervisor.runAgent(testAgent, task, orquestrator, []);

      expect(result.output).toContain('"completed"');
      expect(task.chat.some((message) => message.text === 'worker externo rodando')).toBe(true);
      expect(stopped[0]).toMatch(/^kca-task_1-run(_1)?$/);
    } finally {
      closeWorkers(workers);
      orquestrator.shutdown();
      cleanup();
    }
  });

  it('roteia task pai e subtasks pelo supervisor em modo docker', async () => {
    const workers: WorkerServer[] = [];
    const startedUnits: string[] = [];
    const stoppedUnits: string[] = [];
    const calls: Record<string, number> = {};
    const stats = { tokens: { input: 1, output: 1, total: 2 }, cost: 0 };
    const piClient = createPiClientWithRunner(throwingRunner(new Error('inproc runner usado indevidamente')));
    const { orquestrator: unusedOrquestrator, dir, cleanup } = buildOrquestrator({ piClient }, { stopWhenWaiting: true });
    unusedOrquestrator.shutdown();
    const supervisor = new WorkerSupervisor(piClient, {
      mode: 'docker',
      runTimeoutMs: 1000,
      dataDir: dir,
      startWorker: async (socketPath, containerName) => {
        startedUnits.push(containerName);
        const worker = createWorkerServer({
          async run(input) {
            const body = input as {
              callbackSocketPath: string;
              config: { cwd: string };
            };
            const taskId = basename(dirname(body.config.cwd));
            const call = (calls[taskId] = (calls[taskId] ?? 0) + 1);

            if (taskId === 'task_1' && call === 1) {
              const ids: string[] = [];
              for (const title of ['sub A', 'sub B']) {
                const response = await unixJson<{ ok: boolean; result: string }>(body.callbackSocketPath, '/tool', {
                  name: 'create_subtask',
                  params: { assignedTo: 'agent-tester', title, message: `execute ${title}` },
                });
                ids.push((JSON.parse(response.result) as { taskId: string }).taskId);
              }
              return { output: waitingDecision([{ waitId: 'g', mode: 'WAIT_ALL', taskIds: ids }]), stats };
            }

            return {
              output: completedDecision(taskId === 'task_1' ? 'consolidado' : `resultado ${taskId}`),
              stats,
            };
          },
        });
        workers.push(worker);
        await listenWorkerServer(worker, socketPath);
      },
      stopWorker: (containerName) => {
        stoppedUnits.push(containerName);
      },
    });
    const orquestrator = new Orquestrator(
      { ...createDeps(dir, piClient), workerSupervisor: supervisor },
      { isolation: 'docker' },
    );

    try {
      const root = orquestrator.createRootTask('raiz', 'agent-tester');

      await waitForTaskStatus(orquestrator, root, TASK_STATUS.COMPLETED);

      const subtaskIds = orquestrator.getSubtasks(root).map((task) => task.taskId);
      expect(subtaskIds).toEqual(['task_2', 'task_3']);
      expect(startedUnits.filter((unit) => unit.startsWith('kca-task_1-'))).toHaveLength(2);
      expect(startedUnits.some((unit) => unit.startsWith('kca-task_2-'))).toBe(true);
      expect(startedUnits.some((unit) => unit.startsWith('kca-task_3-'))).toBe(true);
      expect(stoppedUnits).toEqual(startedUnits);
    } finally {
      closeWorkers(workers);
      orquestrator.shutdown();
      cleanup();
    }
  });

  // Smoke real: sobe o worker main.ts num container node:24-slim com a workers dir
  // + repo montados, responde /health pela UDS montada no host, e para o container.
  // SKIP limpo quando docker não está disponível (mesmo padrão do skip de infra externa).
  (dockerAvailable() ? it : it.skip)(
    'sobe o worker num container docker real e responde /health pela UDS montada',
    async () => {
      // dataDir curto em /tmp: caminho de socket UDS tem limite de ~108 chars.
      const dataDir = mkdtempSync(join(tmpdir(), 'kca-docker-'));
      const socketPath = workerSocketPath(dataDir, 'task_s', 'run');
      const containerName = `kca-smoke-${process.pid}`;
      mkdirSync(dirname(socketPath), { recursive: true });
      const supervisor = new WorkerSupervisor(createPiClient([]), {
        mode: 'docker',
        runTimeoutMs: 5000,
        dataDir,
        workerImage: 'node:24-slim',
      });
      try {
        supervisor.startDockerWorker(socketPath, containerName);
        let health: { status: number; body: string } | undefined;
        for (let i = 0; i < 40; i++) {
          try {
            const res = await unixGet(socketPath, '/health');
            if (res.body) {
              health = res;
              break;
            }
          } catch {
            // socket ainda não pronto — tenta de novo.
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        expect(health?.status).toBe(200);
        expect(JSON.parse(health?.body ?? '{}')).toEqual({ ok: true });
      } finally {
        supervisor.stopDockerWorker(containerName);
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
    60_000,
  );

  // Smoke real F3.2: constrói uma imagem de devcontainer via CLI real e confirma
  // que o `docker run` do supervisor a usa (tag capturada pelo execFile injetado,
  // enquanto a imagem é construída de verdade). SKIP limpo sem docker.
  (dockerAvailable() ? it : it.skip)(
    'constrói a imagem do devcontainer via CLI real e o docker run do supervisor a usa',
    async () => {
      const projectDir = mkdtempSync(join(tmpdir(), 'kca-devc-int-'));
      const configPath = join(projectDir, 'devcontainer.json');
      writeFileSync(configPath, JSON.stringify({ image: 'debian:bookworm-slim' }));
      let image: string | undefined;
      try {
        image = resolveDevcontainerImage({ workspaceFolder: projectDir, configPath, slug: 'smoke' });
        expect(image).toMatch(/^kca-devc-smoke-[0-9a-f]{12}$/);
        // A imagem existe de fato no docker.
        expect(() => execFileSync('docker', ['image', 'inspect', image!], { stdio: 'ignore' })).not.toThrow();
        // 2a resolução = cache hit, mesma tag.
        expect(resolveDevcontainerImage({ workspaceFolder: projectDir, configPath, slug: 'smoke' })).toBe(image);

        // docker-mode run usa a tag: captura o argv do `docker run` via execFile injetado.
        const calls: string[][] = [];
        const supervisor = new WorkerSupervisor(createPiClient([]), {
          mode: 'docker',
          runTimeoutMs: 1000,
          dataDir: '/host/data',
          workingDirectory: '/repo',
          execFile: ((bin: string, args: readonly string[]) => {
            calls.push([bin, ...args]);
            return Buffer.from('');
          }) as unknown as typeof execFileSync,
        });
        supervisor.startDockerWorker('/host/data/.swarm/workers/task_1-run.sock', 'kca-devc-smoke', image);
        const run = calls.find((call) => call[1] === 'run');
        expect(run).toBeDefined();
        expect(run).toContain(image);
      } finally {
        if (image) {
          try {
            execFileSync('docker', ['image', 'rm', '-f', image], { stdio: 'ignore' });
          } catch {
            // imagem pode já não existir — ok.
          }
        }
        rmSync(projectDir, { recursive: true, force: true });
      }
    },
    300_000,
  );
});
