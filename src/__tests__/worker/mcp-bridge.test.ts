import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { listenToolServer, closeServer } from '../../infrastructure/process/worker-supervisor.js';
import type { CustomToolSpec } from '../../application/pi-client.js';

// Drive o mcp-bridge.ts real como processo filho (como o codex app-server faria),
// falando MCP JSON-RPC/stdio; o tool-callback UDS e o listenToolServer real.
const BRIDGE = fileURLToPath(new URL('../../worker/mcp-bridge.ts', import.meta.url));

interface RpcResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface BridgeClient {
  request(method: string, params?: Record<string, unknown>): Promise<RpcResponse>;
  notify(method: string, params?: Record<string, unknown>): void;
}

function createClient(child: ChildProcess): BridgeClient {
  const pending = new Map<number, (r: RpcResponse) => void>();
  const rl = createInterface({ input: child.stdout! });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const message = JSON.parse(trimmed) as RpcResponse;
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  });
  let nextId = 1;
  return {
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    },
    notify(method, params = {}) {
      child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    },
  };
}

describe('mcp-bridge (processo filho real)', () => {
  const dirs: string[] = [];
  let child: ChildProcess | undefined;
  let server: Server | undefined;

  afterEach(async () => {
    child?.kill('SIGKILL');
    child = undefined;
    if (server) await closeServer(server).catch(() => undefined);
    server = undefined;
    while (dirs.length) {
      try {
        rmSync(dirs.pop()!, { recursive: true, force: true });
      } catch {
        /* noop */
      }
    }
  });

  it('faz handshake, lista e chama tools via UDS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-bridge-'));
    dirs.push(dir);
    const socket = join(dir, 'tools.sock');

    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
    const tools: CustomToolSpec[] = [
      {
        name: 'post_message',
        description: 'Posta uma mensagem no chat',
        parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        execute: async (params) => {
          calls.push({ name: 'post_message', params });
          return `posted: ${String(params.text)}`;
        },
      },
    ];
    server = await listenToolServer(socket, tools);

    child = spawn(process.execPath, ['--import', 'tsx', BRIDGE], {
      env: { ...process.env, KCA_TOOLS_SOCKET: socket },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const client = createClient(child);

    // Handshake
    const init = await client.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0.0.0' },
    });
    expect(init.result?.protocolVersion).toBe('2025-06-18');
    expect((init.result?.serverInfo as { name?: string })?.name).toBe('kca-tools');
    expect((init.result?.capabilities as { tools?: unknown })?.tools).toBeDefined();
    client.notify('notifications/initialized');

    // tools/list -> GET /tools; parameters vira inputSchema.
    const list = await client.request('tools/list');
    const listed = list.result?.tools as Array<{ name: string; description: string; inputSchema: unknown }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: 'post_message', description: 'Posta uma mensagem no chat' });
    expect(listed[0].inputSchema).toEqual(tools[0].parameters);

    // tools/call -> POST /tool; result round-trip como content text.
    const call = await client.request('tools/call', { name: 'post_message', arguments: { text: 'ola' } });
    expect(call.result?.isError).toBe(false);
    expect(call.result?.content).toEqual([{ type: 'text', text: 'posted: ola' }]);
    expect(calls).toEqual([{ name: 'post_message', params: { text: 'ola' } }]);

    // tool inexistente -> isError (nao erro de protocolo).
    const missing = await client.request('tools/call', { name: 'nope', arguments: {} });
    expect(missing.result?.isError).toBe(true);
    expect((missing.result?.content as Array<{ text: string }>)[0].text).toContain('tool_not_found');

    // metodo desconhecido -> erro JSON-RPC -32601.
    const unknown = await client.request('metodo/inexistente');
    expect(unknown.error?.code).toBe(-32601);
  });
});
