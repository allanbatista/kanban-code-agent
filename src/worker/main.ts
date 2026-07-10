#!/usr/bin/env node
import { request } from 'node:http';
import type { AgentRunConfig, CustomToolSpec } from '../application/pi-client.js';
import { PiSdkAgentRunner } from '../cli/pi-runner.js';
import { createWorkerServer, listenWorkerServer } from './server.js';

const socketArgIndex = process.argv.indexOf('--socket');
const socketPath =
  socketArgIndex >= 0 ? process.argv[socketArgIndex + 1] : process.env.SWARM_WORKER_SOCKET;

if (!socketPath) {
  console.error('SWARM_WORKER_SOCKET ou --socket e obrigatorio');
  process.exit(1);
}

const runner = new PiSdkAgentRunner();
const worker = createWorkerServer({
  async run(input, signal) {
    const request = input as { config?: AgentRunConfig; callbackSocketPath?: string };
    if (!request.config) throw new Error('config obrigatorio');
    return runner.run(withRemoteTools(request.config, request.callbackSocketPath, signal));
  },
});

process.on('SIGTERM', () => {
  void worker.close().finally(() => process.exit(0));
});

await listenWorkerServer(worker, socketPath);

function withRemoteTools(
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
