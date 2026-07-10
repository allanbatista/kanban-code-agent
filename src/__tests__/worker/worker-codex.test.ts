import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkerServer, listenWorkerServer, type WorkerServer } from '../../worker/server.js';
import { createWorkerExecutor } from '../../worker/executor.js';
import { WorkerSupervisor } from '../../infrastructure/process/worker-supervisor.js';
import { codexHomePath } from '../../infrastructure/security/codex-home.js';
import { parseDecision } from '../../application/decision-parser.js';
import { buildOrquestrator } from '../_helpers/orquestrator-fixture.js';
import { testAgent } from '../_helpers/mock-agent.js';
import { createPiClient } from '../_helpers/orquestrator-fixture.js';

const FAKE_APP_SERVER = fileURLToPath(new URL('../_helpers/fake-codex-app-server.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
// Path do fake DE DENTRO do container (repo montado ro em /kca/app).
const CONTAINER_FAKE = '/kca/app/src/__tests__/_helpers/fake-codex-app-server.mjs';

// Config serializado minimo (o caminho codex so usa cwd/thinkingLevel/system/prompt).
function serializedConfig(cwd: string) {
  return {
    cwd,
    model: { provider: 'deepseek', modelId: 'deepseek-v4-flash' },
    thinkingLevel: 'off',
    tools: ['read'],
    systemPrompt: 'system',
    prompt: 'faca isso',
    sessionManager: null,
    resourceLoader: null,
  };
}

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

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// F2.3 (a) e (c): protocolo do worker out-of-process com agent:'codex' contra o
// fake app-server (F1.1). Sem docker: exercita executor + POST /run/cancel.
// ---------------------------------------------------------------------------

describe('worker out-of-process com agent codex (fake app-server)', () => {
  const cleanups: Array<() => void> = [];
  const savedEnv = { bin: process.env.SWARM_CODEX_BIN, home: process.env.CODEX_HOME, variant: process.env.FAKE_CODEX_VARIANT };

  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    process.env.SWARM_CODEX_BIN = savedEnv.bin;
    process.env.CODEX_HOME = savedEnv.home;
    process.env.FAKE_CODEX_VARIANT = savedEnv.variant;
    delete process.env.FAKE_CODEX_VARIANT;
  });

  async function startWorker(dir: string): Promise<{ socketPath: string; worker: WorkerServer }> {
    const socketPath = join(dir, 'worker.sock');
    const worker = createWorkerServer(createWorkerExecutor());
    await listenWorkerServer(worker, socketPath);
    cleanups.push(() => {
      worker.server.closeAllConnections?.();
      worker.server.close();
    });
    return { socketPath, worker };
  }

  it('POST /run com agent codex faz o round-trip da decisao estruturada', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kca-wcodex-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    process.env.SWARM_CODEX_BIN = FAKE_APP_SERVER;
    process.env.CODEX_HOME = join(dir, 'codexhome');

    const { socketPath } = await startWorker(dir);
    const response = await unixJson<{ ok: boolean; result?: { output: string }; error?: string }>(socketPath, '/run', {
      runId: 'r1',
      agent: 'codex',
      config: serializedConfig(dir),
    });

    expect(response.ok).toBe(true);
    const decision = parseDecision(response.result!.output);
    expect(decision.status).toBe('completed');
    expect(decision.messages[0].text).toBe('feito pelo codex');
  });

  it('POST /cancel aborta um run codex em andamento (RunCancelledError)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kca-wcodex-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    process.env.SWARM_CODEX_BIN = FAKE_APP_SERVER;
    process.env.CODEX_HOME = join(dir, 'codexhome');
    process.env.FAKE_CODEX_VARIANT = 'interrupt'; // fica pendente ate o turn/interrupt.

    const { socketPath } = await startWorker(dir);
    // /run fica pendente (o fake so completa apos o interrupt); dispara o cancel.
    const runPromise = unixJson<{ ok: boolean; error?: string }>(socketPath, '/run', {
      runId: 'rc',
      agent: 'codex',
      config: serializedConfig(dir),
    });
    setTimeout(() => {
      void unixJson(socketPath, '/cancel', { runId: 'rc' });
    }, 150);

    const response = await runPromise;
    expect(response.ok).toBeFalsy();
    expect(response.error).toMatch(/cancel/i);
  });
});

// ---------------------------------------------------------------------------
// F2.3 (b): smoke REAL em docker. Container node:24-slim com o repo montado roda
// o worker (tsx); agent:'codex' com SWARM_CODEX_BIN = fake app-server montado no
// repo. Valida a cadeia docker -> worker UDS -> config serializado -> fake codex
// -> decisao de volta. SKIP limpo sem docker.
// ---------------------------------------------------------------------------

describe('worker docker real com agent codex', () => {
  (dockerAvailable() ? it : it.skip)(
    'roda um turno codex num container real e devolve a decisao pela UDS montada',
    async () => {
      const piClient = createPiClient([]);
      const { orquestrator, dir, cleanup } = buildOrquestrator({ piClient }, { stopWhenWaiting: true });
      const supervisor = new WorkerSupervisor(piClient, {
        mode: 'docker',
        runTimeoutMs: 60_000,
        dataDir: dir,
        workingDirectory: REPO_ROOT,
        workerImage: 'node:24-slim',
        codexHome: codexHomePath(dir),
        // fake app-server (no repo montado) faz de codex; -e SWARM_CODEX_BIN no container.
        codexBin: CONTAINER_FAKE,
      });
      try {
        const task = orquestrator.createRootTask('rodar', 'agent-tester', { agent: 'codex', model: 'fast', effort: 'off' });

        const result = await supervisor.runAgent(testAgent, task, orquestrator, []);
        const decision = parseDecision(result.output);

        expect(decision.status).toBe('completed');
        expect(decision.messages[0].text).toBe('feito pelo codex');
      } finally {
        orquestrator.shutdown();
        cleanup();
        // Sockets sob /tmp já removidos no finally do run; dir limpo pelo cleanup.
        rmSync(join(dir, '.swarm', 'workers'), { recursive: true, force: true });
      }
    },
    120_000,
  );
});
