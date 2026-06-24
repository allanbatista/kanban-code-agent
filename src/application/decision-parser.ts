import type { AgentDecision } from '../domain/task.js';

/**
 * Error thrown when agent LLM output cannot be parsed into a valid AgentDecision.
 */
export class AgentOutputInvalidError extends Error {
  public readonly rawOutput: string;

  constructor(message: string, rawOutput: string) {
    super(message);
    this.name = 'AgentOutputInvalidError';
    this.rawOutput = rawOutput.slice(0, 4000);
  }
}

const JSON_BLOCK_RE = /```(?:json)?\s*([\s\S]*?)```/;

/**
 * Extract a JSON substring delimited by the outermost matching pair of `{` and `}`.
 * Returns null when no balanced object is found.
 */
function extractJsonBlock(text: string): string | null {
  // First try to unwrap a markdown fenced code block.
  const blockMatch = text.match(JSON_BLOCK_RE);
  const source = blockMatch ? blockMatch[1] : text;

  const firstBrace = source.indexOf('{');
  if (firstBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = firstBrace; i < source.length; i++) {
    const ch = source[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(firstBrace, i + 1);
      }
    }
  }

  return null;
}

/**
 * Strict parser that extracts a JSON decision object from raw LLM output text.
 *
 * Strategy:
 * 1. Locate the outermost `{...}` block (handles markdown fences, surrounding text).
 * 2. Parse it with `JSON.parse`.
 * 3. Throw `AgentOutputInvalidError` for any failure.
 */
export function parseDecision(rawOutput: string): AgentDecision {
  if (!rawOutput || rawOutput.trim().length === 0) {
    throw new AgentOutputInvalidError('Empty agent output', rawOutput);
  }

  const jsonBlock = extractJsonBlock(rawOutput);
  if (!jsonBlock) {
    // No JSON found — treat raw text as completed task result
    return {
      status: 'completed',
      messages: [{ type: 'text' as const, text: rawOutput }],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AgentOutputInvalidError(`JSON parse failed: ${message}`, rawOutput);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AgentOutputInvalidError('Parsed JSON is not a valid object', rawOutput);
  }

  const obj = parsed as Record<string, unknown>;

  // Status: default to completed if missing
  const status = typeof obj.status === 'string' && ['completed', 'waiting', 'retry'].includes(obj.status)
    ? obj.status
    : 'completed';

  // Messages: default to text from raw output or json text field
  if (!Array.isArray(obj.messages)) {
    obj.messages = [{ type: 'text', text: obj.text || rawOutput }];
  }

  const messages = obj.messages as unknown[];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') {
      throw new AgentOutputInvalidError(
        `messages[${i}] is not a valid object`,
        rawOutput,
      );
    }
    const msgObj = msg as Record<string, unknown>;
    // Normalize: DeepSeek sometimes returns {role, content} instead of {type, text}
    if (msgObj.role && msgObj.content && !msgObj.type) {
      msgObj.type = msgObj.role === 'user' ? 'text' : 'text';
      msgObj.text = msgObj.content;
      delete msgObj.role;
      delete msgObj.content;
    }
    if (typeof msgObj.type !== 'string') {
      // Default to 'text' if type is missing
      msgObj.type = 'text';
    }
    if (!msgObj.text && typeof msgObj.content === 'string') {
      msgObj.text = msgObj.content;
    }
    if (!msgObj.text) {
      msgObj.text = JSON.stringify(msgObj);
    }
  }

  // Wait groups (optional)
  if (obj.waitGroups !== undefined && !Array.isArray(obj.waitGroups)) {
    throw new AgentOutputInvalidError('"waitGroups" must be an array when present', rawOutput);
  }

  // Wait mode (optional)
  if (
    obj.waitMode !== undefined &&
    (typeof obj.waitMode !== 'string' || !['WAIT_ALL', 'ON_DEMAND'].includes(obj.waitMode as string))
  ) {
    throw new AgentOutputInvalidError(
      `Invalid "waitMode" (got: ${JSON.stringify(obj.waitMode)})`,
      rawOutput,
    );
  }

  // Waiting for task IDs (optional)
  if (obj.waitingForTaskIds !== undefined && !Array.isArray(obj.waitingForTaskIds)) {
    throw new AgentOutputInvalidError('"waitingForTaskIds" must be an array when present', rawOutput);
  }

  // Instructions (optional)
  if (obj.instructions !== undefined && typeof obj.instructions !== 'string') {
    throw new AgentOutputInvalidError('"instructions" must be a string when present', rawOutput);
  }

  // Model (optional)
  if (
    obj.model !== undefined &&
    (typeof obj.model !== 'string' || !['fast', 'balanced', 'deep'].includes(obj.model as string))
  ) {
    throw new AgentOutputInvalidError(
      `Invalid "model" (got: ${JSON.stringify(obj.model)})`,
      rawOutput,
    );
  }

  // Effort (optional)
  if (obj.effort !== undefined && typeof obj.effort !== 'string') {
    throw new AgentOutputInvalidError('"effort" must be a string when present', rawOutput);
  }

  return { ...obj, status, messages: obj.messages } as unknown as AgentDecision;
}
