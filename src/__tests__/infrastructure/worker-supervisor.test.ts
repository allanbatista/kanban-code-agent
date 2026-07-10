import { describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { basename, dirname } from 'node:path';
import { Orquestrator } from '../../application/orquestrator.js';
import type { Task } from '../../domain/task.js';
import { TASK_STATUS } from '../../domain/types.js';
import { WorkerSupervisor } from '../../infrastructure/process/worker-supervisor.js';
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

  it('monta comando systemd-run com limites e credencial encrypted', () => {
    const supervisor = new WorkerSupervisor(createPiClient([]), {
      mode: 'systemd',
      runTimeoutMs: 1500,
      readWritePaths: ['/tmp/kca'],
      encryptedCredential: '/tmp/git-token.cred',
      workerEntry: '/repo/src/worker/main.ts',
      workingDirectory: '/repo',
      nodeBin: '/usr/bin/node',
      memoryMax: '512M',
      cpuQuota: '50%',
    });

    const args = supervisor.buildSystemdRunArgs('/tmp/worker.sock', 'kca-test');

    expect(args).toContain('--unit=kca-test');
    expect(args).toContain('--property=RuntimeMaxSec=2');
    expect(args).toContain('--property=WorkingDirectory=/repo');
    expect(args).toContain('--property=ReadWritePaths=/tmp/kca');
    expect(args).toContain('--property=MemoryMax=512M');
    expect(args).toContain('--property=CPUQuota=50%');
    expect(args).toContain('--property=LoadCredentialEncrypted=git-token:/tmp/git-token.cred');
    expect(args).toContain('/usr/bin/node');
    expect(args).toContain('/repo/src/worker/main.ts');
    expect(args).toContain('/tmp/worker.sock');
  });

  it('executa modo systemd via worker UDS e RPC minimo de tools', async () => {
    const workers: WorkerServer[] = [];
    const stopped: string[] = [];
    const piClient = createPiClient([]);
    const { orquestrator, dir, cleanup } = buildOrquestrator({ piClient }, { stopWhenWaiting: true });
    try {
      const task = orquestrator.createRootTask('rodar', 'agent-tester');
      const supervisor = new WorkerSupervisor(piClient, {
        mode: 'systemd',
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
        stopWorker: (unitName) => {
          stopped.push(unitName);
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

  it('roteia task pai e subtasks pelo supervisor em modo systemd', async () => {
    const workers: WorkerServer[] = [];
    const startedUnits: string[] = [];
    const stoppedUnits: string[] = [];
    const calls: Record<string, number> = {};
    const stats = { tokens: { input: 1, output: 1, total: 2 }, cost: 0 };
    const piClient = createPiClientWithRunner(throwingRunner(new Error('inproc runner usado indevidamente')));
    const { orquestrator: unusedOrquestrator, dir, cleanup } = buildOrquestrator({ piClient }, { stopWhenWaiting: true });
    unusedOrquestrator.shutdown();
    const supervisor = new WorkerSupervisor(piClient, {
      mode: 'systemd',
      runTimeoutMs: 1000,
      dataDir: dir,
      startWorker: async (socketPath, unitName) => {
        startedUnits.push(unitName);
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
      stopWorker: (unitName) => {
        stoppedUnits.push(unitName);
      },
    });
    const orquestrator = new Orquestrator(
      { ...createDeps(dir, piClient), workerSupervisor: supervisor },
      { isolation: 'systemd' },
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
});
