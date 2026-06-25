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

// Natural-language fields a model commonly uses to address the human, in order
// of preference. Used to recover a clean markdown message when the model
// returns a non-contract JSON shape (so the raw envelope never reaches the chat).
const HUMAN_TEXT_KEYS = [
  'message', 'mensagem', 'text', 'texto', 'response', 'resposta',
  'answer', 'reply', 'result', 'resultado', 'conclusion', 'conclusao',
  'summary', 'resumo', 'content', 'output',
];

/** Recursively pull the first non-empty human-facing string from a parsed object. */
function extractHumanText(value: unknown, depth = 0): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (depth > 3 || !value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  for (const key of HUMAN_TEXT_KEYS) {
    const found = extractHumanText(obj[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

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

  // Messages: the human-facing channel is markdown text. When the model skips
  // the `messages` array (returns a custom JSON shape), recover a clean
  // natural-language message from its fields — NEVER fall back to the raw JSON
  // envelope, which would dump the contract into the user's chat.
  if (!Array.isArray(obj.messages)) {
    obj.messages = [{ type: 'text', text: extractHumanText(obj) ?? 'Tarefa concluída.' }];
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
      // Recover prose from the message object rather than dumping its JSON.
      msgObj.text = extractHumanText(msgObj) ?? 'Tarefa concluída.';
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

  // Evaluation verdict (optional — QA / Code Reviewer contract).
  if (
    obj.verdict !== undefined &&
    (typeof obj.verdict !== 'string' || !['approved', 'rejected'].includes(obj.verdict as string))
  ) {
    throw new AgentOutputInvalidError(
      `Invalid "verdict" (got: ${JSON.stringify(obj.verdict)})`,
      rawOutput,
    );
  }
  if (obj.criteria !== undefined && !Array.isArray(obj.criteria)) {
    throw new AgentOutputInvalidError('"criteria" must be an array when present', rawOutput);
  }
  if (obj.feedback !== undefined && typeof obj.feedback !== 'string') {
    throw new AgentOutputInvalidError('"feedback" must be a string when present', rawOutput);
  }

  return { ...obj, status, messages: obj.messages } as unknown as AgentDecision;
}
