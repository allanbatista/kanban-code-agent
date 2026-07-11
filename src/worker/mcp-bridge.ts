#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { request } from 'node:http';

// ---------------------------------------------------------------------------
// MCP bridge: servidor MCP stdio (JSON-RPC 2.0 newline-delimited) que expoe as
// custom tools do Master (post_message, create_subtask, ask_human, ...) ao
// Codex. O Codex so aceita tools via MCP; este processo e spawnado pelo
// `codex app-server` (registrado no config.toml do CODEX_HOME) e encaminha:
//   initialize            -> handshake local (nao toca o UDS)
//   tools/list            -> GET  /tools no UDS do tool-callback (KCA_TOOLS_SOCKET)
//   tools/call {name,args} -> POST /tool {name, params} -> {ok, result}
// Sem SDK: o subset do protocolo MCP cabe em ~120 linhas.
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'kca-tools', title: 'Kanban Code Agent Tools', version: '0.1.0' };

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export interface McpBridgeIO {
  socket: string;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

export function startMcpBridge(io: McpBridgeIO): void {
  const rl = createInterface({ input: io.input });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      return; // linha invalida e sem id: nada a reportar.
    }
    void handleMessage(io, message);
  });
}

async function handleMessage(io: McpBridgeIO, message: JsonRpcMessage): Promise<void> {
  const hasId = message.id !== undefined && message.id !== null;
  // Notificacoes (sem id): notifications/initialized etc. — nada a responder.
  if (!hasId) return;
  const id = message.id as number | string;
  try {
    const result = await route(io.socket, message.method ?? '', message.params ?? {});
    write(io.output, { jsonrpc: '2.0', id, result });
  } catch (error) {
    const code = error instanceof RpcError ? error.code : -32603;
    write(io.output, { jsonrpc: '2.0', id, error: { code, message: errMessage(error) } });
  }
}

async function route(socket: string, method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case 'initialize':
      return { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO };
    case 'ping':
      return {};
    case 'tools/list': {
      const listed = (await unixRequest(socket, 'GET', '/tools')) as {
        tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
      };
      // parameters (JSON Schema do tool) vira inputSchema no vocabulario MCP.
      const tools = (listed.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters,
      }));
      return { tools };
    }
    case 'tools/call': {
      const name = String(params.name ?? '');
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        const res = (await unixRequest(socket, 'POST', '/tool', { name, params: args })) as {
          ok?: boolean;
          result?: string;
          error?: string;
        };
        if (!res.ok) {
          return { content: [{ type: 'text', text: res.error ?? `tool ${name} falhou` }], isError: true };
        }
        return { content: [{ type: 'text', text: res.result ?? '' }], isError: false };
      } catch (error) {
        // Falha de transporte tambem volta como tool error (nao como erro de protocolo)
        // para o modelo ver e reagir, nao abortar o turno.
        return { content: [{ type: 'text', text: errMessage(error) }], isError: true };
      }
    }
    default:
      throw new RpcError(-32601, `metodo nao suportado: ${method}`);
  }
}

function unixRequest(socketPath: string, method: string, path: string, body?: unknown): Promise<unknown> {
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
            resolve(raw ? JSON.parse(raw) : {});
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

function write(output: NodeJS.WritableStream, message: Record<string, unknown>): void {
  output.write(JSON.stringify(message) + '\n');
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Entrypoint: espelha worker/main.ts (roda no topo, sem main-guard). O socket
// por-run chega via env KCA_TOOLS_SOCKET, injetado pelo app-server a partir da
// tabela [mcp_servers.kca_tools.env] do config.toml (codex 0.144.1 nao tem
// `env_vars`). ponytail: em dev roda sob tsx; F2 troca pelo bundle esbuild.
const socket = process.env.KCA_TOOLS_SOCKET;
if (!socket) {
  process.stderr.write('KCA_TOOLS_SOCKET obrigatorio\n');
  process.exit(1);
}
startMcpBridge({ socket, input: process.stdin, output: process.stdout });
