import { describe, it, expect } from 'vitest';
import { parseDecision, AgentOutputInvalidError } from '../../application/decision-parser.js';

describe('parseDecision', () => {
  describe('valid JSON parsing', () => {
    it('parses completed decision', () => {
      const output = JSON.stringify({
        status: 'completed',
        messages: [{ type: 'text', text: 'Done' }],
      });

      const result = parseDecision(output);
      expect(result.status).toBe('completed');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].type).toBe('text');
      expect(result.messages[0].text).toBe('Done');
    });

    it('parses waiting decision', () => {
      const output = JSON.stringify({
        status: 'waiting',
        messages: [],
        waitGroups: [{ waitId: 'wait_1', mode: 'WAIT_ALL', taskIds: ['task_a', 'task_b'] }],
        waitMode: 'WAIT_ALL',
        waitingForTaskIds: ['task_a', 'task_b'],
      });

      const result = parseDecision(output);
      expect(result.status).toBe('waiting');
      expect(result.waitGroups).toHaveLength(1);
      expect(result.waitGroups![0].mode).toBe('WAIT_ALL');
      expect(result.waitingForTaskIds).toEqual(['task_a', 'task_b']);
    });

    it('parses retry decision', () => {
      const output = JSON.stringify({
        status: 'retry',
        messages: [{ type: 'text', text: 'Retrying' }],
        instructions: 'Fix the error',
        model: 'deep',
        effort: 'high',
      });

      const result = parseDecision(output);
      expect(result.status).toBe('retry');
      expect(result.instructions).toBe('Fix the error');
      expect(result.model).toBe('deep');
      expect(result.effort).toBe('high');
    });
  });

  describe('markdown code block', () => {
    it('parses JSON wrapped in ```json block', () => {
      const output = '```json\n{"status":"completed","messages":[{"type":"text","text":"ok"}]}\n```';
      const result = parseDecision(output);
      expect(result.status).toBe('completed');
      expect(result.messages[0].text).toBe('ok');
    });

    it('parses JSON wrapped in ``` block without language', () => {
      const output = '```\n{"status":"completed","messages":[{"type":"text","text":"ok"}]}\n```';
      const result = parseDecision(output);
      expect(result.status).toBe('completed');
    });
  });

  describe('surrounding text', () => {
    it('extracts JSON from text with prefix', () => {
      const output = 'Here is my decision: {"status":"completed","messages":[{"type":"text","text":"yes"}]}';
      const result = parseDecision(output);
      expect(result.status).toBe('completed');
    });

    it('extracts JSON from text with suffix', () => {
      const output = '{"status":"completed","messages":[{"type":"text","text":"yes"}]} End of response.';
      const result = parseDecision(output);
      expect(result.status).toBe('completed');
    });

    it('extracts JSON from text wrapped both sides', () => {
      const output = 'Some text before {"status":"completed","messages":[{"type":"text","text":"yes"}]} some after';
      const result = parseDecision(output);
      expect(result.status).toBe('completed');
    });
  });

  describe('error handling', () => {
    it('throws AgentOutputInvalidError for empty output', () => {
      expect(() => parseDecision('')).toThrow(AgentOutputInvalidError);
      expect(() => parseDecision('   ')).toThrow(AgentOutputInvalidError);
    });

    it('returns completed decision for output without JSON', () => {
      const result = parseDecision('just some text');
      expect(result.status).toBe('completed');
      expect(result.messages[0].text).toContain('just some text');
    });

    it('throws for invalid JSON', () => {
      expect(() => parseDecision('{ broken }')).toThrow(AgentOutputInvalidError);
    });

    it('returns completed decision for JSON array', () => {
      const result = parseDecision('[1, 2, 3]');
      expect(result.status).toBe('completed');
    });

    it('returns completed decision for JSON null', () => {
      const result = parseDecision('null');
      expect(result.status).toBe('completed');
    });

    it('defaults to completed when status field is missing', () => {
      const output = '{"messages":[{"type":"text","text":"hi"}]}';
      const result = parseDecision(output);
      expect(result.status).toBe('completed');
      expect(result.messages).toHaveLength(1);
    });

    it('defaults unknown status to completed', () => {
      const output = '{"status":"unknown","messages":[{"type":"text","text":"hi"}]}';
      const result = parseDecision(output);
      expect(result.status).toBe('completed');
    });

    it('creates default messages when messages is missing', () => {
      const output = '{"status":"completed"}';
      const result = parseDecision(output);
      expect(result.status).toBe('completed');
      expect(Array.isArray(result.messages)).toBe(true);
    });

    it('replaces non-array messages with default', () => {
      const output = '{"status":"completed","messages":"not array"}';
      const result = parseDecision(output);
      expect(result.status).toBe('completed');
      expect(Array.isArray(result.messages)).toBe(true);
    });

    it('recovers natural-language text from a non-contract JSON (no raw envelope in chat)', () => {
      // Shape a weak model actually returned: custom schema, prose buried in summary.message.
      const output = JSON.stringify({
        step: 'VERIFICAR_E_FINALIZAR',
        status: 'completed',
        scope: { obj: 'dizer hello em 4 idiomas', checklist: ['ok'] },
        summary: { action: '4 subtasks', message: '✅ Todas as 4 subtasks foram concluídas.' },
        next_step: 'Nenhum.',
      });
      const result = parseDecision(output);
      expect(result.status).toBe('completed');
      expect(result.messages[0].text).toBe('✅ Todas as 4 subtasks foram concluídas.');
      // The raw JSON envelope must never leak into the user-facing message.
      expect(result.messages[0].text).not.toContain('"step"');
      expect(result.messages[0].text).not.toContain('checklist');
    });

    it('falls back to a generic message when no human text is present', () => {
      const output = '{"status":"completed","step":"X","data":{"n":1}}';
      const result = parseDecision(output);
      expect(result.messages[0].text).toBe('Tarefa concluída.');
      expect(result.messages[0].text).not.toContain('{');
    });

    it('defaults to text when message lacks type field', () => {
      const output = '{"status":"completed","messages":[{}]}';
      const decision = parseDecision(output);
      expect(decision.messages[0].type).toBe('text');
    });

    it('normalizes {role, content} to {type, text}', () => {
      const output = '{"status":"completed","messages":[{"role":"system","content":"Hello"}]}';
      const decision = parseDecision(output);
      expect(decision.messages[0].type).toBe('text');
      expect(decision.messages[0].text).toBe('Hello');
    });

    it('throws when waitGroups is not an array', () => {
      const output = '{"status":"completed","messages":[],"waitGroups":"bad"}';
      expect(() => parseDecision(output)).toThrow(AgentOutputInvalidError);
    });

    it('throws when waitMode is invalid', () => {
      const output = '{"status":"completed","messages":[],"waitMode":"INVALID_MODE"}';
      expect(() => parseDecision(output)).toThrow(AgentOutputInvalidError);
    });

    it('throws when waitingForTaskIds is not an array', () => {
      const output = '{"status":"completed","messages":[],"waitingForTaskIds":"not array"}';
      expect(() => parseDecision(output)).toThrow(AgentOutputInvalidError);
    });

    it('throws when instructions is not a string', () => {
      const output = '{"status":"completed","messages":[],"instructions":123}';
      expect(() => parseDecision(output)).toThrow(AgentOutputInvalidError);
    });

    it('throws when model is invalid', () => {
      const output = '{"status":"completed","messages":[],"model":"giga"}';
      expect(() => parseDecision(output)).toThrow(AgentOutputInvalidError);
    });

    it('throws when effort is not a string', () => {
      const output = '{"status":"completed","messages":[],"effort":999}';
      expect(() => parseDecision(output)).toThrow(AgentOutputInvalidError);
    });

    it('error includes raw output', () => {
      const raw = 'my bad output';
      try {
        parseDecision(raw);
      } catch (e) {
        expect(e).toBeInstanceOf(AgentOutputInvalidError);
        expect((e as AgentOutputInvalidError).rawOutput).toBe(raw);
      }
    });

    it('raw output is truncated at 4000 chars', () => {
      const long = 'x'.repeat(5000);
      try {
        parseDecision(long);
      } catch (e) {
        expect((e as AgentOutputInvalidError).rawOutput.length).toBeLessThanOrEqual(4000);
      }
    });
  });
});
