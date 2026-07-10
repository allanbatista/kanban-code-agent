#!/usr/bin/env node
// Fake `codex app-server` dos E2E de matriz (F4.1). Fala JSON-RPC 2.0
// newline-delimited real no stdio, como o binario real. Duas diferencas em
// relacao ao fake de _helpers/ (que fica no escopo dos outros agentes):
//   1. A decisao vem NATIVA via outputSchema — emitida em `turn.output` no
//      turn/completed (caminho extractStructured do codex-runner), nao por
//      item/completed. Prova o contrato "decisao via outputSchema".
//   2. O turno faz um round-trip real de `post_message` pelo tool-callback UDS
//      (KCA_TOOLS_SOCKET) antes de completar — exercita o caminho
//      MCP-independent (POST /tool no listenToolServer do supervisor).
// Variante em argv[2] (ou FAKE_CODEX_VARIANT): success (default) | interrupt.
import { request } from 'node:http';

const VARIANTS = new Set(['success', 'interrupt']);
const argVariant = process.argv[2];
const variant = VARIANTS.has(argVariant) ? argVariant : process.env.FAKE_CODEX_VARIANT ?? 'success';

const DECISION = { status: 'completed', messages: [{ type: 'text', text: 'feito pelo codex (e2e)' }] };
const POST_TEXT = 'codex progrediu via UDS';
const USAGE = { inputTokens: 11, outputTokens: 5, totalTokens: 16 };

// Valida o outputSchema recebido contra as regras strict da OpenAI que quebraram
// em producao: em TODO objeto com `properties`, `additionalProperties` deve ser
// false e `required` deve conter todas as chaves de `properties` (recursivo).
// Devolve a mensagem de erro 400-style na primeira violacao, ou null se valido.
function validateStrictSchema(schema, path = []) {
  if (!schema || typeof schema !== 'object') return null;
  const ctx = () => `(${path.map((p) => `'${p}'`).join(',')})`;
  const props = schema.properties;
  if (props && typeof props === 'object') {
    const keys = Object.keys(props);
    if (keys.length > 0) {
      if (schema.additionalProperties !== false) {
        return `In context=${ctx()}, 'additionalProperties' is required to be supplied and to be false.`;
      }
      const required = Array.isArray(schema.required) ? schema.required : [];
      for (const key of keys) {
        if (!required.includes(key)) {
          return `In context=${ctx()}, 'required' is required to be supplied and to be an array including every key in properties. Missing '${key}'.`;
        }
      }
    }
    for (const key of keys) {
      const err = validateStrictSchema(props[key], [...path, 'properties', key]);
      if (err) return err;
    }
  }
  if (schema.items) {
    const err = validateStrictSchema(schema.items, [...path, 'items']);
    if (err) return err;
  }
  return null;
}

function emit(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function respond(id, result) {
  emit({ jsonrpc: '2.0', id, result });
}

// POST {name, params} no tool-callback UDS e resolve quando a resposta termina.
// Best-effort: se o socket sumiu, nao trava o turno.
function callTool(socketPath, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = request(
      {
        socketPath,
        method: 'POST',
        path: '/tool',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', resolve);
      },
    );
    req.on('error', () => resolve());
    req.write(payload);
    req.end();
  });
}

async function runTurn() {
  if (variant === 'interrupt') return; // pendura ate o turn/interrupt do cliente.
  const socket = process.env.KCA_TOOLS_SOCKET;
  // Round-trip da tool ANTES do completed: o cliente derruba o tool-server assim
  // que o turno completa, entao aguardamos a resposta para nao perder o POST.
  if (socket) await callTool(socket, { name: 'post_message', params: { text: POST_TEXT } });
  emit({
    jsonrpc: '2.0',
    method: 'turn/completed',
    params: { turn: { id: 'turn_fake', status: 'completed', output: DECISION, usage: USAGE } },
  });
}

let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    handle(message);
  }
});

function handle(message) {
  switch (message.method) {
    case 'initialize':
      respond(message.id, {});
      break;
    case 'initialized':
      break;
    case 'thread/start':
      respond(message.id, { thread: { id: 'thr_fake', sessionId: 'thr_fake' } });
      break;
    case 'turn/start': {
      respond(message.id, { turn: { id: 'turn_fake', status: 'inProgress', items: [] } });
      // Espelha o backend real: outputSchema que viola strict derruba o turno.
      const schemaError = message.params?.outputSchema
        ? validateStrictSchema(message.params.outputSchema)
        : null;
      if (schemaError) {
        emit({
          jsonrpc: '2.0',
          method: 'turn/completed',
          params: { turn: { id: 'turn_fake', status: 'failed', error: { message: `400 invalid_json_schema: ${schemaError}` } } },
        });
        break;
      }
      void runTurn();
      break;
    }
    case 'turn/interrupt':
      respond(message.id, null);
      emit({ jsonrpc: '2.0', method: 'turn/completed', params: { turn: { id: 'turn_fake', status: 'interrupted' } } });
      break;
    default:
      if (message.id !== undefined && message.id !== null) {
        emit({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'metodo nao suportado' } });
      }
  }
}
