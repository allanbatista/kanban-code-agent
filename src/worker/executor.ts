import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { AgentRunConfig, AgentRunResult, CustomToolSpec } from '../application/pi-client.js';
import type { AgentName } from '../domain/types.js';
import { PiSdkAgentRunner } from '../cli/pi-runner.js';
import { CodexRunner, DEFAULT_CODEX_MODEL, runCodexTurn } from '../cli/codex-runner.js';
import { ensureCodexHomeAt } from '../infrastructure/security/codex-home.js';
import type { WorkerExecutor } from './server.js';

// ---------------------------------------------------------------------------
// Executor do worker out-of-process: escolhe o runner (Pi ou Codex) pelo campo
// `agent` do payload POST /run e roda a partir do config serializado apenas —
// sem Orquestrator. As custom tools chegam como proxies via callbackSocketPath:
//   pi    -> viram Pi SDK tools (withRemoteTools).
//   codex -> o MCP bridge (spawnado pelo app-server) fala com o mesmo UDS; o
//            worker so repassa o socket via KCA_TOOLS_SOCKET (toolsSocket).
// ---------------------------------------------------------------------------

interface RunRequest {
  config?: AgentRunConfig;
  callbackSocketPath?: string;
  agent?: AgentName;
}

export function createWorkerExecutor(): WorkerExecutor {
  const piRunner = new PiSdkAgentRunner();
  return {
    async run(input, signal) {
      const req = input as RunRequest;
      if (!req.config) throw new Error('config obrigatorio');
      if (req.agent === 'codex') return runCodexInWorker(req.config, req.callbackSocketPath, signal);
      return piRunner.run(withRemoteTools(req.config, req.callbackSocketPath, signal));
    },
  };
}

async function runCodexInWorker(
  config: AgentRunConfig,
  callbackSocketPath: string | undefined,
  signal: AbortSignal,
): Promise<AgentRunResult> {
  const codexHome = process.env.CODEX_HOME;
  if (!codexHome) throw new Error('CODEX_HOME obrigatorio para agent codex');
  // Regrava o config.toml do MCP bridge com paths do CONTAINER. O CODEX_HOME e
  // montado compartilhado; em docker so o worker o escreve (o client inproc nunca
  // roda aqui), entao nao ha conflito de paths host<->container. Bundle (.mjs)
  // roda o bridge direto; source (.ts, dev/tsx) roda sob tsx como o worker.
  const bundle = import.meta.url.endsWith('.mjs');
  const bridgeEntry = fileURLToPath(new URL(bundle ? './mcp-bridge.mjs' : './mcp-bridge.ts', import.meta.url));
  ensureCodexHomeAt(codexHome, { nodeBin: process.execPath, bridgeEntry, useTsx: !bundle });

  // SWARM_CODEX_BIN (bin montado /kca/bin/bin/codex) e CODEX_HOME vem do env do
  // container; o socket do tool-callback vira KCA_TOOLS_SOCKET no app-server.
  const runner = new CodexRunner({ codexHome });
  return runCodexTurn(runner, config, {
    model: process.env.SWARM_CODEX_MODEL ?? DEFAULT_CODEX_MODEL,
    sandboxPolicy: 'externalSandbox', // o container e o sandbox
    toolsSocket: callbackSocketPath,
    signal,
  });
}

export function withRemoteTools(
  config: AgentRunConfig,
  callbackSocketPath: string | undefined,
  signal: AbortSignal,
): AgentRunConfig {
  const specs = config.customTools ?? [];
  if (specs.length > 0 && !callbackSocketPath) throw new Error('callbackSocketPath obrigatorio para customTools');
  const customTools = specs.map((tool) => ({
    ...tool,
    execute: (params: Record<string, unknown>) => callTool(callbackSocketPath!, tool.name, params),
  })) as CustomToolSpec[];
  return { ...config, customTools, signal };
}

async function callTool(socketPath: string, name: string, params: Record<string, unknown>): Promise<string> {
  const response = await unixJson<{ ok: boolean; result?: string; error?: string }>(socketPath, '/tool', { name, params });
  if (!response.ok) throw new Error(response.error ?? `tool ${name} falhou`);
  return response.result ?? '';
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
          const raw = Buffer.concat(chunks).toString('utf-8');
          try {
            resolve((raw ? JSON.parse(raw) : {}) as T);
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
