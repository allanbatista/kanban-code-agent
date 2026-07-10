import { describe, expect, it } from 'vitest';
import { DECISION_OUTPUT_SCHEMA, stripNullFields } from '../../cli/codex-runner.js';

// ---------------------------------------------------------------------------
// stripNullFields: com o outputSchema strict o modelo emite null para campos
// opcionais ausentes; este helper remove essas chaves antes do parseDecision.
// ---------------------------------------------------------------------------
describe('stripNullFields', () => {
  it('remove chaves null-valued no topo e mantem o resto', () => {
    const input = JSON.stringify({
      status: 'completed',
      messages: [{ type: 'text', text: 'ok' }],
      waitGroups: null,
      waitMode: null,
      instructions: null,
      feedback: null,
    });
    const parsed = JSON.parse(stripNullFields(input));
    expect(parsed).toEqual({ status: 'completed', messages: [{ type: 'text', text: 'ok' }] });
    expect('waitGroups' in parsed).toBe(false);
  });

  it('remove nulls aninhados dentro de arrays de objetos', () => {
    const input = JSON.stringify({
      status: 'completed',
      messages: [{ type: 'text', text: 'ok' }],
      criteria: [{ name: 'c1', passed: true, note: null }],
    });
    const parsed = JSON.parse(stripNullFields(input));
    expect(parsed.criteria).toEqual([{ name: 'c1', passed: true }]);
  });

  it('preserva false, 0 e string vazia (so remove null)', () => {
    const input = JSON.stringify({ passed: false, count: 0, text: '', gone: null });
    const parsed = JSON.parse(stripNullFields(input));
    expect(parsed).toEqual({ passed: false, count: 0, text: '' });
  });

  it('devolve texto nao-JSON intacto (caminho de fallback)', () => {
    const text = 'Tarefa concluída. Sem JSON aqui.';
    expect(stripNullFields(text)).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// Guarda de regressao: o DECISION_OUTPUT_SCHEMA precisa ser strict-compliant
// (mesma regra que o backend real aplicou: toda chave de properties em required,
// recursivamente, e additionalProperties false). Sem isso o 400 invalid_json_schema
// volta em producao.
// ---------------------------------------------------------------------------
function findStrictViolation(schema: unknown, path: string[] = []): string | null {
  if (!schema || typeof schema !== 'object') return null;
  const s = schema as Record<string, unknown>;
  const props = s.properties as Record<string, unknown> | undefined;
  if (props && typeof props === 'object') {
    const keys = Object.keys(props);
    if (keys.length > 0) {
      if (s.additionalProperties !== false) {
        return `${path.join('.')}: additionalProperties must be false`;
      }
      const required = Array.isArray(s.required) ? (s.required as string[]) : [];
      for (const key of keys) {
        if (!required.includes(key)) return `${path.join('.')}: '${key}' missing from required`;
      }
    }
    for (const key of keys) {
      const err = findStrictViolation(props[key], [...path, 'properties', key]);
      if (err) return err;
    }
  }
  if (s.items) {
    const err = findStrictViolation(s.items, [...path, 'items']);
    if (err) return err;
  }
  return null;
}

describe('DECISION_OUTPUT_SCHEMA (strict mode)', () => {
  it('lista toda chave de properties em required, recursivamente, com additionalProperties false', () => {
    expect(findStrictViolation(DECISION_OUTPUT_SCHEMA, ['root'])).toBeNull();
  });

  it('expressa campos opcionais como tipos nullable (nao por ausencia em required)', () => {
    const props = DECISION_OUTPUT_SCHEMA.properties as Record<string, { type: unknown; enum?: unknown }>;
    // Enum nullable: null no array de tipos, valores do enum sem null.
    expect(props.waitMode.type).toEqual(['string', 'null']);
    expect(props.waitMode.enum).toEqual(['WAIT_ALL', 'ON_DEMAND']);
    expect(props.feedback.type).toEqual(['string', 'null']);
    expect(props.waitGroups.type).toEqual(['array', 'null']);
    // Campos obrigatorios continuam nao-nullable.
    expect(props.status.type).toBe('string');
  });
});
