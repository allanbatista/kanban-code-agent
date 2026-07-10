#!/usr/bin/env node
// Fake `codex app-server`: fala JSON-RPC 2.0 newline-delimited real no stdio.
// Variante: success | deltasonly | fail | interrupt.
// Usado para exercitar o CodexRunner/CodexAgentClient ponta a ponta sem o binario
// real. Standalone-runnavel (shebang + exec bit): pode ser o proprio
// SWARM_CODEX_BIN, invocado como `<fake> app-server` (worker docker/inproc). Ai
// a variante vem do env FAKE_CODEX_VARIANT; quando invocado direto com a variante
// em argv[2] (testes do runner), argv[2] vence.

const VARIANTS = new Set(['success', 'deltasonly', 'fail', 'interrupt']);
const argVariant = process.argv[2];
const variant = VARIANTS.has(argVariant) ? argVariant : process.env.FAKE_CODEX_VARIANT ?? 'success';

const DECISION = JSON.stringify({
  status: 'completed',
  messages: [{ type: 'text', text: 'feito pelo codex' }],
});
const PARTIAL = JSON.stringify({
  status: 'completed',
  messages: [{ type: 'text', text: 'parcial (deve ser ignorado)' }],
});
const USAGE = { inputTokens: 12, outputTokens: 7, totalTokens: 19 };

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

function completed(status, extra = {}) {
  emit({ jsonrpc: '2.0', method: 'turn/completed', params: { turn: { id: 'turn_fake', status, ...extra } } });
}

function runTurn() {
  if (variant === 'fail') {
    completed('failed', { error: { message: 'boom' } });
    return;
  }
  if (variant === 'interrupt') {
    // Espera o turn/interrupt do cliente; nada a emitir agora.
    return;
  }
  if (variant === 'deltasonly') {
    for (const chunk of chunkString(DECISION, 5)) {
      emit({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { itemId: 'item_1', textDelta: chunk } });
    }
    completed('completed', { usage: USAGE });
    return;
  }
  // success: deltas parciais + item/completed com o JSON real (deve vencer os deltas).
  for (const chunk of chunkString(PARTIAL, 5)) {
    emit({ jsonrpc: '2.0', method: 'item/agentMessage/delta', params: { itemId: 'item_1', textDelta: chunk } });
  }
  emit({ jsonrpc: '2.0', method: 'item/completed', params: { item: { id: 'item_1', type: 'agentMessage', status: 'completed', text: DECISION } } });
  completed('completed', { usage: USAGE });
}

function chunkString(text, size) {
  const parts = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts;
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
        completed('failed', { error: { message: `400 invalid_json_schema: ${schemaError}` } });
        break;
      }
      runTurn();
      break;
    }
    case 'turn/interrupt':
      respond(message.id, null);
      completed('interrupted');
      break;
    default:
      if (message.id !== undefined && message.id !== null) {
        emit({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'metodo nao suportado' } });
      }
  }
}
