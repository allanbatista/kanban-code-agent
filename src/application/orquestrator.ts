import { EventEmitter } from 'node:events';
import { existsSync, lstatSync } from 'node:fs';
import { basename } from 'node:path';
import type { Agent } from '../domain/agent.js';
import type {
  Task,
  TaskMetadata,
  TaskArtifact,
  TaskChatMessage,
  RuntimeConfig,
  AgentDecision,
  AttachmentRef,
  SerializedTask,
  AgentOutputMessage,
} from '../domain/task.js';
import type { TaskRun } from '../domain/run.js';
import type { SwarmEvent } from '../domain/events.js';
import type { AgentWaitGroup, WaitGroup } from '../domain/wait-group.js';
import type { SwarmEventType, ModelAlias, EffortLevel, WaitGroupMode } from '../domain/types.js';
import {
  SWARM_EVENT_TYPE,
  TASK_STATUS,
  WAIT_GROUP_MODE,
  WAIT_GROUP_STATUS,
} from '../domain/types.js';
import { AgentOutputInvalidError, parseDecision } from './decision-parser.js';
import { BudgetTracker, BudgetExceededError, checkCardCeiling } from './budget-tracker.js';
import { checkStagnation, type RunSignal } from './convergence.js';
import { Scheduler } from './scheduler.js';
import { WorkerPool, RunTimeoutError } from './worker-pool.js';
import { RunCancelledError, type PiAgentClient, type CustomToolSpec } from './pi-client.js';
import type { EventStore } from '../infrastructure/persistence/event-store.js';
import type { SnapshotStore } from '../infrastructure/persistence/snapshot-store.js';
import type { TaskFileStore } from '../infrastructure/persistence/task-file-store.js';
import type { PathSandbox } from '../infrastructure/filesystem/sandbox.js';
import type { Task as DomainTaskClass } from '../domain/task.js';
import { Task as TaskImpl } from '../domain/task.js';

// ---------------------------------------------------------------------------
// Constants (matching PoC defaults)
// ---------------------------------------------------------------------------

const DEFAULT_MODEL_ALIAS: ModelAlias = 'fast';
const DEFAULT_EFFORT: EffortLevel = 'off';

const ALLOWED_MODELS: Record<ModelAlias, { provider: string; modelId: string; description: string }> = {
  fast: { provider: 'openrouter', modelId: 'openai/gpt-5.4-nano', description: 'tarefas simples e baixo custo' },
  balanced: { provider: 'openrouter', modelId: 'deepseek/deepseek-v4-flash', description: 'uso geral equilibrado' },
  deep: { provider: 'openrouter', modelId: 'deepseek/deepseek-v4-pro', description: 'tarefas complexas ou criticas' },
};

const ALLOWED_EFFORTS: EffortLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

// Model escalation ladder: fast → balanced → deep
const MODEL_LADDER: ModelAlias[] = ['fast', 'balanced', 'deep'];
const EFFORT_LADDER: EffortLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const DEFAULT_RUNTIME_CONFIG: Required<RuntimeConfig> = { model: DEFAULT_MODEL_ALIAS, effort: DEFAULT_EFFORT };

// Sentinel agent for tasks that sit in the Inbox awaiting user action (never scheduled).
export const INBOX_AGENT = 'inbox';
// Agent that orchestrates user-created tasks once they are sent to execution.
/** Sanitize agent messages: remove raw technical errors before showing to user. */
function sanitizeMessages(messages: import('../domain/task.js').AgentOutputMessage[]): import('../domain/task.js').AgentOutputMessage[] {
  const ERROR_PATTERNS = [
    /ERROR:\s*Cannot read/i,
    /Error:\s*clipboard/i,
    /model does not support/i,
    /__vite_ssr/i,
    /import\.meta\.resolve/i,
    /stack trace/i,
    /at\s+\S+\.\w+:\d+:\d+/i, // stack frames
  ];

  return messages.map((msg) => {
    if (!msg.text) return msg;
    let text = msg.text;

    // Remove lines matching error patterns
    const lines = text.split('\n');
    const filtered = lines.filter((line) => !ERROR_PATTERNS.some((p) => p.test(line)));

    // If everything was filtered, provide a friendly fallback
    if (filtered.length === 0 || filtered.every((l) => l.trim() === '')) {
      return { ...msg, text: 'Tarefa concluída. Verifique os resultados.' };
    }

    // Clean up markdown-wrapped JSON blocks
    text = filtered.join('\n').trim();
    text = text.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '');

    return { ...msg, text };
  });
}

/** Sanitize a technical error message for user display. */
function sanitizeErrorMessage(message: string): string {
  if (/clipboard/i.test(message)) return 'Erro ao processar entrada do modelo.';
  if (/import\.meta|__vite/i.test(message)) return 'Erro interno de configuração do runner.';
  if (/timeout/i.test(message)) return 'A execução excedeu o tempo limite.';
  if (/budget/i.test(message)) return 'O orçamento de tokens foi excedido.';
  if (/model does not support/i.test(message)) return 'O modelo não suporta esta operação.';
  // Generic fallback: keep first 100 chars, remove stack traces
  const clean = message.split('\n')[0]?.slice(0, 100) ?? 'Erro desconhecido';
  return clean;
}

const MANAGER_AGENT = 'Manager';
const MAX_TITLE_LENGTH = 80;

// Provisional title shown until the async title-generation request returns.
function deriveProvisionalTitle(message: string): string {
  const firstLine = message.trim().split('\n')[0]?.trim() ?? '';
  if (firstLine.length <= MAX_TITLE_LENGTH) return firstLine || 'Nova tarefa';
  return firstLine.slice(0, MAX_TITLE_LENGTH - 1).trimEnd() + '…';
}

// Cleans an LLM-generated title: single line, no surrounding quotes, bounded length.
function sanitizeTitle(raw: string): string {
  let oneLine = raw.trim().split('\n')[0]?.trim() ?? '';
  // Strip JSON blocks from title generation
  oneLine = oneLine.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  // If it looks like JSON, try to extract a meaningful title
  if (oneLine.startsWith('{')) {
    try {
      const parsed = JSON.parse(oneLine);
      if (parsed.title) return parsed.title.slice(0, MAX_TITLE_LENGTH);
      if (parsed.messages?.[0]?.text) return parsed.messages[0].text.slice(0, MAX_TITLE_LENGTH);
    } catch { /* not valid JSON, use as-is */ }
    // Strip JSON syntax
    oneLine = oneLine.replace(/[{}"',:[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const unquoted = oneLine.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (unquoted.length <= MAX_TITLE_LENGTH) return unquoted || 'Nova tarefa';
  return unquoted.slice(0, MAX_TITLE_LENGTH - 1).trimEnd() + '…';
}

const MAX_CONCURRENCY = readPositiveIntegerEnv('SWARM_MAX_CONCURRENCY', 3);
const MAX_TASK_DEPTH = readPositiveIntegerEnv('SWARM_MAX_TASK_DEPTH', 5);
const MAX_SUBTASKS_PER_TASK = readPositiveIntegerEnv('SWARM_MAX_SUBTASKS_PER_TASK', 10);
const MAX_TASK_RETRIES = readPositiveIntegerEnv('SWARM_MAX_TASK_RETRIES', 3);
const MAX_TECHNICAL_RETRIES = readPositiveIntegerEnv('SWARM_MAX_TECHNICAL_RETRIES', 2);
const RUN_TIMEOUT_MS = readPositiveIntegerEnv('SWARM_RUN_TIMEOUT_MS', 300000);
const RETRY_BASE_DELAY_MS = readPositiveIntegerEnv('SWARM_RETRY_BASE_DELAY_MS', 2000);
const MAX_TOTAL_TOKENS = readPositiveIntegerEnv('SWARM_MAX_TOTAL_TOKENS', Number.MAX_SAFE_INTEGER);
const MAX_TOTAL_COST = readPositiveNumberEnv('SWARM_MAX_TOTAL_COST', Number.POSITIVE_INFINITY);
const MAX_PROMPT_CHAT_MESSAGES = readPositiveIntegerEnv('SWARM_MAX_PROMPT_CHAT_MESSAGES', 60);

// ---------------------------------------------------------------------------
// Dependency interface
// ---------------------------------------------------------------------------

export interface OrquestratorDeps {
  eventStore: EventStore;
  snapshotStore: SnapshotStore;
  taskFileStore: TaskFileStore;
  sandbox: PathSandbox;
  agents: Agent[];
  piClient: PiAgentClient;
  models?: Record<ModelAlias, { provider: string; modelId: string; description: string }>;
}

export interface OrquestratorOptions {
  resetState?: boolean;
  stopWhenWaiting?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readPositiveIntegerEnv(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readPositiveNumberEnv(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0))];
}

function isTerminalTaskStatus(status: string): boolean {
  return status === TASK_STATUS.COMPLETED || status === TASK_STATUS.FAILED || status === TASK_STATUS.CANCELLED;
}

function isTerminalTaskEvent(type: string): boolean {
  return (
    type === SWARM_EVENT_TYPE.TASK_COMPLETED ||
    type === SWARM_EVENT_TYPE.TASK_FAILED ||
    type === SWARM_EVENT_TYPE.TASK_CANCELLED
  );
}

function terminalEventVerb(type: string): string {
  if (type === SWARM_EVENT_TYPE.TASK_COMPLETED) return 'concluida';
  if (type === SWARM_EVENT_TYPE.TASK_FAILED) return 'falhou';
  if (type === SWARM_EVENT_TYPE.TASK_CANCELLED) return 'cancelada';
  return type.toLowerCase();
}

function isModelAlias(
  value: unknown,
  models: Record<string, unknown> = ALLOWED_MODELS,
): value is ModelAlias {
  return typeof value === 'string' && value in models;
}

function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === 'string' && ALLOWED_EFFORTS.includes(value as EffortLevel);
}

function normalizeRuntimeConfig(
  config?: RuntimeConfig,
  models?: Record<ModelAlias, { provider: string; modelId: string }>,
): RuntimeConfig | undefined {
  if (!config) return undefined;
  const normalized: RuntimeConfig = {};
  if (config.model !== undefined) {
    if (!isModelAlias(config.model, models ?? ALLOWED_MODELS)) throw new Error(`Modelo alias invalido: ${config.model}`);
    normalized.model = config.model;
  }
  if (config.effort !== undefined) {
    if (!isEffortLevel(config.effort)) throw new Error(`Effort invalido: ${config.effort}`);
    normalized.effort = config.effort;
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

function mergeRuntimeConfig(...configs: (RuntimeConfig | undefined)[]): Required<RuntimeConfig> {
  return configs.reduce<Required<RuntimeConfig>>(
    (merged, config) => ({ ...merged, ...normalizeRuntimeConfig(config) }),
    { ...DEFAULT_RUNTIME_CONFIG },
  );
}

/** Auto-escalate model/effort on repeated failures. Returns upgraded config. */
function escalateConfig(current: Required<RuntimeConfig>): RuntimeConfig {
  const modelIdx = MODEL_LADDER.indexOf(current.model);
  const effortIdx = EFFORT_LADDER.indexOf(current.effort);

  // Try escalating effort first (cheaper)
  if (effortIdx < EFFORT_LADDER.length - 1) {
    return { model: current.model, effort: EFFORT_LADDER[effortIdx + 1] };
  }
  // Then escalate model
  if (modelIdx < MODEL_LADDER.length - 1) {
    return { model: MODEL_LADDER[modelIdx + 1], effort: current.effort };
  }
  return current;
}

function mergeWaitGroups(existing: WaitGroup[], next: WaitGroup[]): WaitGroup[] {
  const byWaitId = new Map<string, WaitGroup>();
  for (const group of existing) byWaitId.set(group.waitId, group);
  for (const group of next) {
    const current = byWaitId.get(group.waitId);
    if (!current) {
      byWaitId.set(group.waitId, group);
      continue;
    }
    current.mode = group.mode;
    current.taskIds = uniqueStrings([...current.taskIds, ...group.taskIds]);
    current.status = WAIT_GROUP_STATUS.WAITING as 'WAITING';
  }
  return [...byWaitId.values()];
}

function sanitizeWaitId(waitId: string): string {
  const sanitized = waitId.trim();
  if (!/^[a-zA-Z0-9_.:-]{1,80}$/.test(sanitized)) {
    throw new AgentOutputInvalidError(`waitId invalido: ${waitId}`, waitId);
  }
  return sanitized;
}

function parseAgentWaitGroups(value: unknown, originalOutput: string): AgentWaitGroup[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new AgentOutputInvalidError('waitGroups precisa ser array', originalOutput);
  return value.map((group) => {
    if (!group || typeof group !== 'object') throw new AgentOutputInvalidError('waitGroup invalido', originalOutput);
    const candidate = group as Partial<AgentWaitGroup>;
    if (typeof candidate.waitId !== 'string')
      throw new AgentOutputInvalidError('waitGroup.waitId invalido', originalOutput);
    if (candidate.mode !== 'WAIT_ALL' && candidate.mode !== 'ON_DEMAND')
      throw new AgentOutputInvalidError('waitGroup.mode invalido', originalOutput);
    if (!Array.isArray(candidate.taskIds) || !candidate.taskIds.every((tid) => typeof tid === 'string')) {
      throw new AgentOutputInvalidError('waitGroup.taskIds invalido', originalOutput);
    }
    return { waitId: candidate.waitId, mode: candidate.mode, taskIds: candidate.taskIds };
  });
}

function normalizeAgentMessages(messages: unknown): AgentOutputMessage[] {
  if (!Array.isArray(messages)) return [{ type: 'text', text: '' }];
  const normalized = messages
    .map((message) => {
      if (!message || typeof message !== 'object') return undefined;
      const candidate = message as Partial<AgentOutputMessage>;
      if (candidate.type !== 'text' && candidate.type !== 'artifact' && candidate.type !== 'event') return undefined;
      const output: AgentOutputMessage = { type: candidate.type };
      if (typeof candidate.text === 'string') output.text = candidate.text;
      if (Array.isArray(candidate.artifacts)) output.artifacts = candidate.artifacts;
      return output;
    })
    .filter((message): message is AgentOutputMessage => Boolean(message));
  return normalized.length ? normalized : [{ type: 'text', text: '' }];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatMessages(messages: TaskChatMessage[]): string {
  return messages.map((m) => `${m.role}/${m.type}: ${m.text ?? ''}`).join(' | ');
}

function formatChatMessage(message: TaskChatMessage): string {
  const attachments = message.attachments?.length
    ? ` attachments=${message.attachments.map((a) => a.path).join(',')}`
    : '';
  const artifacts = message.artifacts?.length
    ? ` artifacts=${message.artifacts.map((a) => a.path).join(',')}`
    : '';
  const eventId = message.eventId ? ` eventId=${message.eventId}` : '';
  return `- ${message.ts} ${message.role}/${message.type}: ${message.text ?? ''}${attachments}${artifacts}${eventId}`;
}

function truncateLogValue(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(6)}`;
}

function formatMarkdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function formatSwarmEvent(event: SwarmEvent): string {
  const parts = [`[${event.ts}]`, `#${event.seq}`, event.type, `event=${event.eventId}`];
  if (event.taskId) parts.push(`task=${event.taskId}`);
  if (event.parentId) parts.push(`parent=${event.parentId}`);
  if (event.runId) parts.push(`run=${event.runId}`);
  if (event.waitId) parts.push(`wait=${event.waitId}`);
  if (event.messages?.length) parts.push(`messages="${truncateLogValue(formatMessages(event.messages), 240)}"`);
  if (event.payload && Object.keys(event.payload).length)
    parts.push(`payload=${truncateLogValue(JSON.stringify(event.payload), 600)}`);
  return parts.join(' ');
}

function addSessionStats(
  metrics: Task['metrics'],
  stats: { tokens?: { input?: number; output?: number; cache?: number; total?: number }; cost?: number },
  startedAt: string,
  finishedAt: string,
): Task['metrics'] {
  return {
    startedAt: metrics.startedAt ?? startedAt,
    finishedAt,
    durationMs: metrics.durationMs + new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    tokens: {
      input: metrics.tokens.input + (typeof stats.tokens?.input === 'number' ? stats.tokens.input : 0),
      output: metrics.tokens.output + (typeof stats.tokens?.output === 'number' ? stats.tokens.output : 0),
      cache: metrics.tokens.cache + (typeof stats.tokens?.cache === 'number' ? stats.tokens.cache : 0),
      total: metrics.tokens.total + (typeof stats.tokens?.total === 'number' ? stats.tokens.total : 0),
    },
    cost: metrics.cost + (typeof stats.cost === 'number' ? stats.cost : 0),
  };
}

// ---------------------------------------------------------------------------
// Orquestrator
// ---------------------------------------------------------------------------

export class Orquestrator extends EventEmitter {
  readonly agents = new Map<string, Agent>();
  readonly tasks = new Map<string, Task>();
  events: SwarmEvent[] = [];
  rootTaskIds: string[] = [];

  private nextSeq = 1;
  // Sequential id counters (task_1, run_1, evt_1...). Derived from persisted
  // state on load, so they survive restarts without a separate persisted field.
  private idCounters: { task: number; run: number; evt: number } = { task: 0, run: 0, evt: 0 };
  private runningTaskIds = new Set<string>();
  // Abort controllers for in-flight Pi runs, keyed by taskId. Aborting stops
  // the agent session promptly so pause/move/cancel actually halt work.
  private runAbortControllers = new Map<string, AbortController>();
  private queuedTaskIds = new Set<string>();
  private taskQueue: string[] = [];
  private pendingTriggerEvents = new Map<string, Map<string, SwarmEvent>>();
  private dirtyTaskIds = new Set<string>();
  private shuttingDown = false;

  private readonly scheduler = new Scheduler();
  private readonly workerPool = new WorkerPool(MAX_CONCURRENCY, RUN_TIMEOUT_MS);
  private readonly budget = new BudgetTracker(MAX_TOTAL_TOKENS, MAX_TOTAL_COST);

  private readonly eventStore: EventStore;
  private readonly snapshotStore: SnapshotStore;
  readonly taskFileStore: TaskFileStore;
  readonly sandbox: PathSandbox;
  readonly piClient: PiAgentClient;
  private readonly allowedModels: Record<ModelAlias, { provider: string; modelId: string; description: string }>;

  private options: OrquestratorOptions;

  constructor(deps: OrquestratorDeps, options: OrquestratorOptions = {}) {
    super();
    this.options = options;
    this.eventStore = deps.eventStore;
    this.snapshotStore = deps.snapshotStore;
    this.taskFileStore = deps.taskFileStore;
    this.sandbox = deps.sandbox;
    this.piClient = deps.piClient;
    this.allowedModels = deps.models ?? ALLOWED_MODELS;

    for (const agent of deps.agents) {
      this.agents.set(agent.name, agent);
    }

    this.loadState();
    this.scheduler.rebuildWaitIndex(this.tasks);

    if (!options.resetState && !options.stopWhenWaiting) {
      this.scheduleReadyTasks();
    }
  }

  // -----------------------------------------------------------------------
  // Task management
  // -----------------------------------------------------------------------

  /**
   * Creates a root task from a user message.
   *
   * The user never chooses the agent: a task is either parked in the Inbox
   * (`execute: false`, the default) or sent straight to the Manager for
   * orchestration (`execute: true`). When no explicit `title` is given a
   * provisional one is derived from the message and an async request refines
   * it via the LLM, emitting a TASK_UPDATED event when ready.
   */
  addTask(input: {
    message: string;
    title?: string;
    runtimeConfig?: RuntimeConfig;
    attachmentPaths?: string[];
    execute?: boolean;
  }): Task {
    const assignedTo = input.execute ? MANAGER_AGENT : INBOX_AGENT;
    const task = this.createRootTask(
      input.title ?? deriveProvisionalTitle(input.message),
      assignedTo,
      input.runtimeConfig,
      input.attachmentPaths ?? [],
      input.message,
    );
    if (!input.title) void this.generateTaskTitle(task, input.message);
    return task;
  }

  /**
   * Low-level primitive: create a root task assigned to `agentName` and
   * schedule it (Inbox tasks are created but never scheduled). `addTask` is
   * the product entry point; this is used directly by tests and internals.
   */
  createRootTask(
    title: string,
    agentName: string,
    runtimeConfig?: RuntimeConfig,
    attachmentPaths: string[] = [],
    message?: string,
  ): Task {
    if (agentName !== INBOX_AGENT) this.assertAgentExists(agentName);
    const taskId = this.nextId('task');
    const attachments = this.copyTaskAttachments(taskId, attachmentPaths);
    const normalizedConfig = normalizeRuntimeConfig(runtimeConfig, this.allowedModels);
    const task = new TaskImpl(
      { taskId, title, assignedTo: agentName, depth: 0, runtimeConfig: normalizedConfig },
      false,
      attachments,
    );
    task.appendChat('user', 'text', message ?? title, normalizedConfig, attachments);

    this.tasks.set(task.taskId, task);
    this.rootTaskIds.push(task.taskId);
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_CREATED, { task, payload: { task: task.serialize() } });
    this.persist();
    this.emit('state:changed');
    this.scheduleTask(task.taskId);
    return task;
  }

  // Best-effort async title generation; failures keep the provisional title.
  private async generateTaskTitle(task: Task, message: string): Promise<void> {
    try {
      const title = sanitizeTitle(await this.piClient.generateTitle(message));
      // The task may have been archived/removed while the title was generated.
      if (!this.tasks.has(task.taskId)) return;
      if (!title || task.options.title === title) return;
      task.options.title = title;
      this.markTaskDirty(task);
      this.recordEvent(SWARM_EVENT_TYPE.TASK_UPDATED, { task, payload: { title } });
      this.persist();
      this.emit('state:changed');
    } catch {
      // Title generation is non-critical; the provisional title remains.
    }
  }

  /**
   * Reassigns a root task between the Inbox and the Manager — the only moves
   * the user is allowed to make. `inbox` parks the task (never scheduled);
   * `manager` sends it to execution.
   */
  moveTask(taskId: string, target: 'inbox' | 'manager'): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} não encontrada`);
    if (task.options.parentId) throw new Error('Apenas tasks raiz podem ser movidas');
    if (isTerminalTaskStatus(task.status)) throw new Error('Task finalizada não pode ser movida');

    const wasActive = this.runningTaskIds.has(taskId) || this.queuedTaskIds.has(taskId);
    // dequeue aborts any in-flight Pi run; the runTask result-guard discards
    // late output, so moving to the Inbox truly pauses execution.
    this.dequeue(taskId);
    task.options.assignedTo = target === 'inbox' ? INBOX_AGENT : MANAGER_AGENT;
    task.status = TASK_STATUS.PENDING;
    task.activeRunId = undefined;
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_UPDATED, {
      task,
      payload: { assignedTo: task.assignedTo, status: task.status },
    });
    if (target === 'inbox' && wasActive) {
      this.recordEvent(SWARM_EVENT_TYPE.TASK_PAUSED, { task });
    }
    this.persist();
    this.emit('state:changed');
    if (target === 'manager') this.scheduleTask(taskId);
    return task;
  }

  /**
   * User-driven cancel: stops any in-flight run/queue entry and marks the task
   * CANCELLED. Backs both DELETE /api/tasks/:id and a drag to the Cancel column.
   */
  cancelTask(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} não encontrada`);
    if (isTerminalTaskStatus(task.status)) return task;
    this.dequeue(taskId);
    task.status = TASK_STATUS.CANCELLED;
    task.failureReason = 'cancelled_by_user';
    task.activeRunId = undefined;
    task.metrics.finishedAt = new Date().toISOString();
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_CANCELLED, { task });
    this.scheduler.rebuildWaitIndex(this.tasks);
    this.persist();
    this.emit('state:changed');
    return task;
  }

  /**
   * User-driven completion (Revisão → Done). Only a task awaiting review can be
   * completed by the user; this is what turns REVIEW into COMPLETED.
   */
  completeTaskByUser(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} não encontrada`);
    if (task.status === TASK_STATUS.COMPLETED) return task;
    if (task.status !== TASK_STATUS.REVIEW) {
      throw new Error('Apenas tasks em revisão podem ser concluídas pelo usuário');
    }
    this.dequeue(taskId);
    task.status = TASK_STATUS.COMPLETED;
    task.activeRunId = undefined;
    task.metrics.finishedAt = new Date().toISOString();
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_COMPLETED, { task, messages: task.resultMessages });
    this.scheduler.rebuildWaitIndex(this.tasks);
    this.persist();
    this.emit('state:changed');
    return task;
  }

  /**
   * Appends a user message to a task's chat. If the task is awaiting review,
   * the message reopens it: it returns to the Manager for execution.
   */
  appendUserMessage(taskId: string, message: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} não encontrada`);
    task.appendChat('user', 'text', message);
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.MESSAGE_APPENDED, {
      task,
      messages: [task.chat[task.chat.length - 1]],
    });
    const reopenable =
      task.status === TASK_STATUS.REVIEW || isTerminalTaskStatus(task.status);
    // Resume from WAITING(human) on user response
    if (task.status === TASK_STATUS.WAITING && task.waitingReason === 'human') {
      task.status = TASK_STATUS.PENDING;
      task.waitingReason = undefined;
      task.activeRunId = undefined;
      this.markTaskDirty(task);
      this.recordEvent(SWARM_EVENT_TYPE.TASK_RESUMED, { task });
      this.persist();
      this.emit('state:changed');
      this.scheduleTask(taskId);
      return task;
    }
    if (reopenable && !task.options.parentId) {
      task.options.assignedTo = MANAGER_AGENT;
      task.status = TASK_STATUS.PENDING;
      task.activeRunId = undefined;
      this.markTaskDirty(task);
      this.recordEvent(SWARM_EVENT_TYPE.TASK_RESUMED, { task });
      this.persist();
      this.emit('state:changed');
      this.scheduleTask(taskId);
      return task;
    }
    this.persist();
    this.emit('state:changed');
    return task;
  }

  /** Updates a task's runtime config (model/effort) and emits TASK_UPDATED. */
  updateTaskRuntimeConfig(taskId: string, runtimeConfig: RuntimeConfig): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} não encontrada`);
    task.options.runtimeConfig = {
      ...(task.options.runtimeConfig ?? {}),
      ...(normalizeRuntimeConfig(runtimeConfig, this.allowedModels) ?? {}),
    };
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_UPDATED, {
      task,
      payload: { runtimeConfig: task.options.runtimeConfig },
    });
    this.persist();
    this.emit('state:changed');
    return task;
  }

  /**
   * Archives every root task in a given status (Done/Cancel columns): the task
   * family's files move to `.swarm/tasks/_archived`, the tasks leave the active
   * state (and snapshot), and a TASK_ARCHIVED event is recorded per root for
   * audit. Returns the archived root task ids.
   */
  archiveByStatus(status: string): string[] {
    const roots = [...this.tasks.values()].filter(
      (task) => !task.options.parentId && task.status === status,
    );
    const archivedRootIds: string[] = [];
    for (const root of roots) {
      const familyIds = this.collectFamilyIds(root);
      for (const id of familyIds) {
        this.dequeue(id);
        this.taskFileStore.archiveTask(id);
        this.tasks.delete(id);
      }
      this.rootTaskIds = this.rootTaskIds.filter((id) => id !== root.taskId);
      this.recordEvent(SWARM_EVENT_TYPE.TASK_ARCHIVED, {
        task: root,
        payload: { taskId: root.taskId, archivedTaskIds: familyIds, status },
      });
      archivedRootIds.push(root.taskId);
    }
    if (archivedRootIds.length > 0) {
      this.scheduler.rebuildWaitIndex(this.tasks);
      this.persist();
      this.emit('state:changed');
    }
    return archivedRootIds;
  }

  // Returns a task id and all of its descendant subtask ids.
  private collectFamilyIds(root: Task): string[] {
    const ids: string[] = [];
    const queue: Task[] = [root];
    while (queue.length > 0) {
      const task = queue.shift()!;
      ids.push(task.taskId);
      for (const sub of this.getSubtasks(task)) queue.push(sub);
    }
    return ids;
  }

  // Removes a task from the scheduling queue and aborts its in-flight run.
  private dequeue(taskId: string): void {
    this.queuedTaskIds.delete(taskId);
    this.taskQueue = this.taskQueue.filter((id) => id !== taskId);
    this.workerPool.cancel(taskId);
    this.cancelActiveRun(taskId);
  }

  // Aborts the in-flight Pi run for a task (if any) and marks its run cancelled.
  // The runTask result-guard discards any output that arrives after this.
  private cancelActiveRun(taskId: string): void {
    const controller = this.runAbortControllers.get(taskId);
    if (controller && !controller.signal.aborted) controller.abort();
    const task = this.tasks.get(taskId);
    if (!task) return;
    const run = this.getActiveRun(task);
    if (run && run.status === 'RUNNING') {
      run.status = 'FAILED';
      run.error = 'cancelado';
      run.completedAt = new Date().toISOString();
      this.recordEvent(SWARM_EVENT_TYPE.RUN_CANCELLED, { task, runId: run.runId });
    }
  }

  spawnSubtask(
    parentTask: Task,
    agentName: string,
    title: string,
    message: string,
    runtimeConfig?: RuntimeConfig,
  ): Task {
    this.assertAgentExists(agentName);
    if (isTerminalTaskStatus(parentTask.status)) {
      throw new Error(`Task ${parentTask.taskId} ja esta terminal e nao pode criar subtasks`);
    }
    if (parentTask.depth >= MAX_TASK_DEPTH) {
      throw new Error(`Depth maximo ${MAX_TASK_DEPTH} atingido para task ${parentTask.taskId}`);
    }
    if (parentTask.subtaskIds.length >= MAX_SUBTASKS_PER_TASK) {
      throw new Error(`Limite de ${MAX_SUBTASKS_PER_TASK} subtasks atingido para task ${parentTask.taskId}`);
    }

    const subtask = new TaskImpl(
      {
        taskId: this.nextId('task'),
        title,
        assignedTo: agentName,
        parentId: parentTask.taskId,
        depth: parentTask.depth + 1,
        runtimeConfig: normalizeRuntimeConfig(runtimeConfig, this.allowedModels),
      },
      true,
    );
    subtask.chat[0].text = message;

    parentTask.subtaskIds.push(subtask.taskId);
    this.tasks.set(subtask.taskId, subtask);
    this.markTaskDirty(parentTask);
    this.markTaskDirty(subtask);
    this.recordEvent(SWARM_EVENT_TYPE.SUBTASK_CREATED, {
      task: subtask,
      parentId: parentTask.taskId,
      payload: { parentTaskId: parentTask.taskId, task: subtask.serialize() },
    });
    this.persist();
    this.scheduleTask(subtask.taskId);
    return subtask;
  }

  /**
   * Only the orchestrator (Manager) decomposes work into subtasks. Specialized
   * agents are leaf executors: they do the work and return, which keeps their
   * context minimal and prevents trivial tasks from spawning runaway nesting.
   */
  isOrchestrator(task: Task): boolean {
    return task.options.assignedTo === MANAGER_AGENT;
  }

  getSubtasks(task: Task): Task[] {
    return task.subtaskIds
      .map((tid) => this.tasks.get(tid))
      .filter((subtask): subtask is Task => Boolean(subtask));
  }

  getRootTask(): Task | undefined {
    const rootTaskId = this.rootTaskIds[0];
    return rootTaskId ? this.tasks.get(rootTaskId) : undefined;
  }

  getAgentNames(): string[] {
    return [...this.agents.keys()];
  }

  getTaskDir(taskId: string): string {
    this.sandbox.validateTaskId(taskId);
    return this.sandbox.resolveSubpath('.swarm', 'tasks', taskId);
  }

  // -----------------------------------------------------------------------
  // Scheduling & Execution
  // -----------------------------------------------------------------------

  scheduleReadyTasks(): void {
    if (this.shuttingDown) return;

    for (const task of this.tasks.values()) {
      if (task.status === TASK_STATUS.PENDING || task.status === TASK_STATUS.QUEUED) {
        this.scheduleTask(task.taskId);
      }
    }

    if (this.options.stopWhenWaiting) return;
    const candidateTaskIds = new Set<string>();
    for (const waiters of this.scheduler.waitingByDependency.values()) {
      for (const tid of waiters) candidateTaskIds.add(tid);
    }
    for (const tid of candidateTaskIds) {
      const task = this.tasks.get(tid);
      if (!task || task.status !== TASK_STATUS.WAITING) continue;
      const triggerEvents = this.getReadyEvents(task);
      if (triggerEvents.length > 0) this.scheduleTask(task.taskId, triggerEvents);
    }
  }

  scheduleTask(taskId: string, triggerEvents: SwarmEvent[] = [], delayMs = 0): void {
    if (this.shuttingDown) return;
    const task = this.tasks.get(taskId);
    if (!task || isTerminalTaskStatus(task.status)) return;
    // Inbox tasks await an explicit user action before they can run.
    if (task.assignedTo === INBOX_AGENT) return;

    this.mergePendingTriggerEvents(taskId, triggerEvents);
    // Self-reschedule guard: when a task re-schedules itself from inside its own
    // run (retry / coerced wait), runningTaskIds still holds it, so the enqueue
    // below would be skipped and the task would stall in PENDING forever. Defer
    // until the current run has torn down (finally clears runningTaskIds).
    if (this.runningTaskIds.has(taskId)) {
      setTimeout(() => this.scheduleTask(taskId, [], 0), Math.max(delayMs, 10));
      return;
    }
    if (!this.queuedTaskIds.has(taskId)) {
      this.queuedTaskIds.add(taskId);
      this.taskQueue.push(taskId);
      if (task.status !== TASK_STATUS.QUEUED) {
        task.status = TASK_STATUS.QUEUED;
        this.markTaskDirty(task);
        this.recordEvent(SWARM_EVENT_TYPE.TASK_QUEUED, { task });
        this.persist();
      }
    }

    if (delayMs > 0) setTimeout(() => this.pumpQueue(), delayMs);
    else setTimeout(() => this.pumpQueue(), 0);
  }

  async runTask(taskId: string, triggerEvents: SwarmEvent[] = []): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || isTerminalTaskStatus(task.status)) return;
    if (this.runningTaskIds.has(taskId)) return;

    const agent = this.agents.get(task.options.assignedTo);
    if (!agent) throw new Error(`Agente ${task.options.assignedTo} não encontrado`);

    const startedAt = new Date().toISOString();
    const run = this.getOrCreateExecutionRun(task, startedAt);
    this.runningTaskIds.add(taskId);
    task.status = TASK_STATUS.RUNNING;
    task.metrics.startedAt ??= startedAt;
    run.status = 'RUNNING';
    run.startedAt = startedAt;
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_STARTED, { task, runId: run.runId });
    this.recordEvent(SWARM_EVENT_TYPE.RUN_STARTED, { task, runId: run.runId });
    this.persist();

    const controller = new AbortController();
    this.runAbortControllers.set(taskId, controller);
    // Subtasks created during this run mean the parent now depends on them and
    // must wait + re-consolidate from their real results (see applyDecision).
    const subtasksBefore = task.subtaskIds.length;
    try {
      this.taskFileStore.ensureTaskDir(task.taskId);
      this.ensureScopeSpec(task);
      const continuity = {
        scopeSpec: this.taskFileStore.loadScopeSpec(task.taskId),
        progressLog: this.taskFileStore.loadProgressLog(task.taskId),
        envResume: this.taskFileStore.loadEnvResume(task.taskId),
      };
      const result = await this.piClient.run(agent, task, this, triggerEvents, controller.signal, continuity);
      // If the run was cancelled or the task was moved/superseded mid-flight,
      // discard the result so no phantom output is applied after a pause.
      if (controller.signal.aborted || task.activeRunId !== run.runId || task.status !== TASK_STATUS.RUNNING) {
        return;
      }
      const finishedAt = new Date().toISOString();
      task.metrics = addSessionStats(task.metrics, result.stats, startedAt, finishedAt);
      this.budget.trackUsage(task.taskId, result.stats.tokens?.input ?? 0, result.stats.tokens?.output ?? 0, result.stats.cost ?? 0);
      this.assertWithinBudget();
      this.assertWithinCardCeiling(task);
      const decision = parseDecision(result.output);
      // Check for stagnation before applying decision
      const stagnationReason = this.checkForStagnation(task, result.output);
      if (stagnationReason) {
        this.failTask(task, run, 'Estagnação detectada: outputs muito similares entre epochs', 'stagnation');
        this.persist();
        return;
      }
      task.technicalRetryCount = 0;
      this.applyDecision(task, run, decision, triggerEvents, task.subtaskIds.slice(subtasksBefore));
    } catch (error) {
      // A cancelled run (pause/move/cancel) must not be retried or failed.
      if (error instanceof RunCancelledError || controller.signal.aborted || task.activeRunId !== run.runId) {
        return;
      }
      this.handleRunFailure(task, run, error, triggerEvents, startedAt, task.subtaskIds.slice(subtasksBefore));
    } finally {
      this.runAbortControllers.delete(taskId);
      this.runningTaskIds.delete(taskId);
      this.emit('state:changed');
      setTimeout(() => this.pumpQueue(), 0);
    }
  }

  async waitUntilSettled(rootTask: Task): Promise<void> {
    return new Promise<void>((resolve) => {
      const check = () => {
        if (isTerminalTaskStatus(rootTask.status)) return resolve();
        if (this.options.stopWhenWaiting && rootTask.status === TASK_STATUS.WAITING && this.isQuiescent())
          return resolve();
        this.once('state:changed', check);
      };
      check();
    });
  }

  // -----------------------------------------------------------------------
  // State: metadata, config, serialization
  // -----------------------------------------------------------------------

  toMetadata(task: Task): TaskMetadata {
    const agent = this.agents.get(task.options.assignedTo);
    return {
      taskId: task.taskId,
      title: task.title,
      assignedTo: task.options.assignedTo,
      parentId: task.options.parentId,
      status: task.status,
      depth: task.depth,
      maxDepth: MAX_TASK_DEPTH,
      canCreateSubtasks: task.depth < MAX_TASK_DEPTH && task.subtaskIds.length < MAX_SUBTASKS_PER_TASK,
      // Carried over WS so the UI can rebuild the subtask tree (workflow/summary).
      // Omitting it made every WS-delivered task look childless.
      subtaskIds: [...task.subtaskIds],
      chatFile: this.getTaskRelativePath(task.taskId, 'chat.jsonl'),
      attachmentsDir: this.getTaskRelativePath(task.taskId, 'attachments'),
      artifactsDir: this.getTaskRelativePath(task.taskId, 'artifacts'),
      artifactsFile: this.getTaskRelativePath(task.taskId, 'artifacts.yaml'),
      runtimeConfig: this.resolveRuntimeConfig(task, agent),
      allowedModels: this.allowedModels,
      allowedEfforts: ALLOWED_EFFORTS,
      retryCount: task.retryCount,
      technicalRetryCount: task.technicalRetryCount,
      maxRetries: MAX_TASK_RETRIES,
      maxTechnicalRetries: MAX_TECHNICAL_RETRIES,
      maxSubtasksPerTask: MAX_SUBTASKS_PER_TASK,
      runTimeoutMs: RUN_TIMEOUT_MS,
      activeRunId: task.activeRunId,
      runs: task.runs,
      taskChat: task.chat,
      artifacts: task.artifacts,
      metrics: task.metrics,
      subtaskSummary: this.buildSubtaskSummary(task),
    };
  }

  /** One line per direct subtask: id, title, agent, status and last result. */
  buildSubtaskSummary(task: Task): string {
    const subtasks = this.getSubtasks(task);
    if (subtasks.length === 0) return 'Sem subtasks.';
    return subtasks
      .map(
        (st) =>
          `- ${st.taskId} ${st.options.title} (${st.options.assignedTo}) [${st.status}]: ` +
          `${formatMessages(st.resultMessages) || 'sem mensagens'}`,
      )
      .join('\n');
  }

  // Slim metadata for the SYSTEM prompt: only what the agent needs to decide its
  // next move. The full chat/runs/metrics/artifacts already travel in the user
  // prompt (buildPrompt) — re-sending them here doubled the context every turn,
  // which is what inflated cache-token totals. Keeping this lean also guarantees
  // a subtask only sees the essentials, never sibling/parent internals.
  buildTaskMetadataBlock(task: Task, metadata?: TaskMetadata): string {
    const md = metadata ?? this.toMetadata(task);
    const slim = {
      taskId: md.taskId,
      title: md.title,
      assignedTo: md.assignedTo,
      status: md.status,
      depth: md.depth,
      maxDepth: md.maxDepth,
      canCreateSubtasks: md.canCreateSubtasks,
      runtimeConfig: md.runtimeConfig,
      allowedModels: md.allowedModels,
      allowedEfforts: md.allowedEfforts,
      retryCount: md.retryCount,
      maxRetries: md.maxRetries,
      technicalRetryCount: md.technicalRetryCount,
      maxTechnicalRetries: md.maxTechnicalRetries,
      maxSubtasksPerTask: md.maxSubtasksPerTask,
      attachmentsDir: md.attachmentsDir,
      artifactsDir: md.artifactsDir,
    };
    return ['<task_metadata>', JSON.stringify(slim, null, 2), '</task_metadata>'].join('\n');
  }

  resolveRuntimeConfig(task: Task, agent?: Agent): Required<RuntimeConfig> {
    return mergeRuntimeConfig(agent?.runtimeConfig, task.options.runtimeConfig);
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  persist(): void {
    this.flushDirtyTasks();
    // Events are appended incrementally to events.jsonl (eventStore), so the
    // snapshot only carries tasks + roots + counters — no O(events) rewrite.
    this.snapshotStore.saveSnapshot(this.tasks, this.rootTaskIds, this.nextSeq);
  }

  persistTask(task: Task): void {
    this.markTaskDirty(task);
    this.persist();
  }

  recordArtifactCreated(task: Task, artifact: TaskArtifact): void {
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.ARTIFACT_CREATED, { task, payload: { artifact } });
  }

  // Appends an informative assistant message mid-run and pushes it to the UI in
  // real time. Does not finalize the task; the run still emits its own decision.
  postAgentMessage(task: Task, text: string): TaskChatMessage {
    task.appendChat('assistant', 'text', text);
    this.markTaskDirty(task);
    const message = task.chat[task.chat.length - 1];
    this.recordEvent(SWARM_EVENT_TYPE.MESSAGE_APPENDED, { task, messages: [message] });
    this.persist();
    this.emit('state:changed');
    return message;
  }

  // Writes an artifact file, registers it on the task and emits ARTIFACT_CREATED.
  createArtifact(
    task: Task,
    fileName: string,
    content: string,
    description: string,
    fileType: string,
  ): TaskArtifact {
    // Idempotent: skip if artifact with same path already exists
    const existingPath = this.taskFileStore.writeArtifactFile(task.taskId, fileName, content);
    const existing = task.artifacts.find((a) => a.path === existingPath);
    if (existing) return existing;

    const sizeBytes = Buffer.byteLength(content, 'utf8');
    const artifact: TaskArtifact = { description, fileType, path: existingPath, sizeBytes };
    task.artifacts.push(artifact);
    task.appendChat('assistant', 'artifact', description, undefined, undefined, [artifact]);
    this.recordArtifactCreated(task, artifact);
    this.persist();
    return artifact;
  }

  /**
   * Agent tools that mutate orchestration state (create_subtask, create_artifact).
   * Returned as Pi-agnostic specs; the runner adapts them to Pi SDK tools so the
   * Manager can actually decompose work into subtasks for specialized agents.
   */
  buildAgentTools(task: Task, includeDelegation: boolean): CustomToolSpec[] {
    const delegatable = this.getAgentNames().filter(
      (name) => name !== MANAGER_AGENT && name !== INBOX_AGENT,
    );
    // post_message and create_artifact are available to EVERY agent (feedback and
    // file output are not orchestration). create_subtask is added only for tasks
    // that orchestrate — executor subtasks just do the work and return, which
    // keeps their context minimal and prevents runaway nesting.
    const tools: CustomToolSpec[] = [
      {
        name: 'post_message',
        description:
          'Envia uma mensagem informativa ao chat da task durante a execucao (progresso, decisao, proximo passo). NAO finaliza a task; o usuario ve em tempo real.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Mensagem de feedback ao usuario.' },
          },
          required: ['text'],
          additionalProperties: false,
        },
        execute: async (params: Record<string, unknown>) => {
          this.postAgentMessage(task, String(params.text));
          return 'ok';
        },
      },
    ];
    if (includeDelegation) {
      tools.push({
        name: 'create_subtask',
        description:
          'Cria uma subtask assincrona delegada a um agente especializado e retorna seus metadados (incluindo taskId). Use o taskId retornado nos waitGroups do status waiting.',
        parameters: {
          type: 'object',
          properties: {
            assignedTo: { type: 'string', enum: delegatable, description: 'Agente destino.' },
            title: { type: 'string', description: 'Titulo curto da subtask.' },
            message: { type: 'string', description: 'Instrucao objetiva e auto-contida da subtask.' },
            model: { type: 'string', enum: Object.keys(this.allowedModels) },
            effort: { type: 'string', enum: ALLOWED_EFFORTS },
          },
          required: ['assignedTo', 'title', 'message'],
          additionalProperties: false,
        },
        execute: async (params: Record<string, unknown>) => {
          const assignedTo = String(params.assignedTo);
          const title = String(params.title);
          const message = String(params.message);
          const runtimeConfig = normalizeRuntimeConfig({
            model: params.model === undefined ? undefined : (params.model as ModelAlias),
            effort: params.effort === undefined ? undefined : (params.effort as EffortLevel),
          }, this.allowedModels);
          // Idempotent: re-issuing the same subtask (replay/retry) reuses it.
          const existing = this.getSubtasks(task).find(
            (subtask) =>
              subtask.options.assignedTo === assignedTo &&
              subtask.options.title === title &&
              subtask.chat.some((c) => c.role === 'user' && c.text === message),
          );
          const subtask = existing ?? this.spawnSubtask(task, assignedTo, title, message, runtimeConfig);
          return JSON.stringify(this.toMetadata(subtask));
        },
      });
    }
    tools.push({
        name: 'create_artifact',
        description: 'Cria um arquivo no diretorio artifacts da task atual e o registra.',
        parameters: {
          type: 'object',
          properties: {
            fileName: { type: 'string', description: 'Nome do arquivo dentro de artifacts.' },
            content: { type: 'string', description: 'Conteudo textual completo.' },
            description: { type: 'string', description: 'Descricao breve do artefato.' },
            file_type: { type: 'string', description: 'Tipo, ex: markdown, json, text.' },
          },
          required: ['fileName', 'content', 'description', 'file_type'],
          additionalProperties: false,
        },
        execute: async (params: Record<string, unknown>) => {
          const artifact = this.createArtifact(
            task,
            String(params.fileName),
            String(params.content),
            String(params.description),
            String(params.file_type),
          );
          return JSON.stringify(artifact);
        },
    });
    // ask_human: write question to chat and park in WAITING(human)
    tools.push({
      name: 'ask_human',
      description: 'Faz uma pergunta ao humano. A pergunta vai ao chat e a task fica aguardando resposta.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Pergunta clara e objetiva ao humano.' },
        },
        required: ['question'],
        additionalProperties: false,
      },
      execute: async (params: Record<string, unknown>) => {
        const question = String(params.question);
        task.appendChat('assistant', 'text', question);
        this.markTaskDirty(task);
        this.recordEvent(SWARM_EVENT_TYPE.MESSAGE_APPENDED, {
          task,
          messages: [task.chat[task.chat.length - 1]],
        });
        // Park task in WAITING(human)
        task.status = TASK_STATUS.WAITING;
        task.waitingReason = 'human';
        this.markTaskDirty(task);
        this.recordEvent(SWARM_EVENT_TYPE.TASK_WAITING, {
          task,
          payload: { waitingReason: 'human' },
        });
        this.persist();
        this.emit('state:changed');
        return JSON.stringify({ status: 'waiting', question });
      },
    });
    return tools;
  }

  shutdown(): void {
    this.shuttingDown = true;
    this.taskQueue = [];
    this.queuedTaskIds.clear();
    this.workerPool.cancelAll();
    for (const controller of this.runAbortControllers.values()) {
      if (!controller.signal.aborted) controller.abort();
    }
    this.runAbortControllers.clear();
    for (const taskId of this.runningTaskIds) {
      const task = this.tasks.get(taskId);
      if (!task || isTerminalTaskStatus(task.status)) continue;
      task.status = TASK_STATUS.PENDING;
      this.markTaskDirty(task);
    }
    this.persist();
    this.emit('state:changed');
  }

  // -----------------------------------------------------------------------
  // Reporting
  // -----------------------------------------------------------------------

  printExecutionReport(): void {
    console.log('\n================== EXECUTION SUMMARY =================');
    console.log(this.formatSummaryTable());
    console.log('\n================== EXECUTION GRAPH =================');
    console.log(this.formatExecutionGraph());
  }

  formatSummaryTable(): string {
    const tasks = [...this.tasks.values()];
    const rows = tasks.map((task) => [
      task.taskId,
      task.options.assignedTo,
      task.status,
      this.formatTaskDependencies(task),
      formatDuration(task.metrics.durationMs),
      String(task.metrics.tokens.input),
      String(task.metrics.tokens.output),
      String(task.metrics.tokens.cache),
      String(task.metrics.tokens.total),
      formatCost(task.metrics.cost),
      `${task.retryCount}/${task.technicalRetryCount}`,
    ]);
    const totals = tasks.reduce(
      (acc, task) => ({
        durationMs: acc.durationMs + task.metrics.durationMs,
        input: acc.input + task.metrics.tokens.input,
        output: acc.output + task.metrics.tokens.output,
        cache: acc.cache + task.metrics.tokens.cache,
        total: acc.total + task.metrics.tokens.total,
        cost: acc.cost + task.metrics.cost,
      }),
      { durationMs: 0, input: 0, output: 0, cache: 0, total: 0, cost: 0 },
    );
    rows.push([
      'TOTAL',
      '-',
      '-',
      '-',
      formatDuration(totals.durationMs),
      String(totals.input),
      String(totals.output),
      String(totals.cache),
      String(totals.total),
      formatCost(totals.cost),
      '-',
    ]);
    return formatMarkdownTable(
      ['task', 'agent', 'status', 'depends_on', 'duration', 'input', 'output', 'cache', 'total', 'price', 'retry/tech'],
      rows,
    );
  }

  formatExecutionGraph(): string {
    const lines: string[] = [];
    for (const rootTaskId of this.rootTaskIds) {
      const rootTask = this.tasks.get(rootTaskId);
      if (rootTask) this.appendTaskGraph(lines, rootTask, '');
    }
    if (this.events.length) {
      lines.push('', 'Events:');
      for (const event of this.events) {
        lines.push(
          `  #${event.seq} ${event.type} ${event.taskId ?? '-'} -> parent=${event.parentId ?? '-'} run=${event.runId ?? '-'} wait=${event.waitId ?? '-'}`,
        );
      }
    }
    return lines.join('\n') || '(sem tasks)';
  }

  // -----------------------------------------------------------------------
  // Attachment handling
  // -----------------------------------------------------------------------

  private copyTaskAttachments(taskId: string, attachmentPaths: string[]): AttachmentRef[] {
    if (attachmentPaths.length === 0) return [];
    const refs: AttachmentRef[] = [];
    for (const sourcePath of attachmentPaths) {
      const ref = this.taskFileStore.copyAttachment(taskId, sourcePath);
      const fullPath = this.sandbox.resolve(ref);
      refs.push({
        id: ref.split('_')[0] ?? '',
        originalName: basename(sourcePath),
        path: ref,
        sizeBytes: existsSync(fullPath) ? lstatSync(fullPath).size : 0,
      });
    }
    return refs;
  }

  // -----------------------------------------------------------------------
  // Private: pump, apply, handle failure
  // -----------------------------------------------------------------------

  private pumpQueue(): void {
    if (this.shuttingDown) return;
    while (this.runningTaskIds.size < MAX_CONCURRENCY && this.taskQueue.length > 0) {
      const taskId = this.taskQueue.shift();
      if (!taskId) continue;
      this.queuedTaskIds.delete(taskId);
      const task = this.tasks.get(taskId);
      if (!task || isTerminalTaskStatus(task.status) || this.runningTaskIds.has(taskId)) continue;
      const triggerEvents = this.takePendingTriggerEvents(taskId);
      this.runTask(taskId, triggerEvents).catch((error) => {
        const failedTask = this.tasks.get(taskId);
        if (failedTask && !isTerminalTaskStatus(failedTask.status)) {
          const run = this.getOrCreateExecutionRun(failedTask, new Date().toISOString());
          this.handleRunFailure(failedTask, run, error, triggerEvents, new Date().toISOString());
        }
      });
    }
  }

  private applyDecision(
    task: Task,
    run: TaskRun,
    decision: AgentDecision,
    triggerEvents: SwarmEvent[],
    newSubtaskIds: string[] = [],
  ): void {
    if (decision.status === 'retry') {
      this.markEventsProcessed(task, triggerEvents);
      task.resultMessages = task.appendAgentMessages(decision.messages);
      if (task.retryCount >= MAX_TASK_RETRIES) {
        task.resultMessages = task.appendAgentMessages([
          { type: 'text', text: `Retry maximo atingido: ${decision.instructions ?? ''}` },
        ]);
        this.failTask(task, run, 'Retry maximo atingido');
        this.persist();
        return;
      }

      const rc = normalizeRuntimeConfig({ model: decision.model, effort: decision.effort }, this.allowedModels);
      task.retryCount += 1;
      task.status = TASK_STATUS.PENDING;
      // Auto-escalate if agent didn't explicitly request a change
      const currentConfig = this.resolveRuntimeConfig(task, this.agents.get(task.options.assignedTo));
      const effectiveRc = rc ?? escalateConfig(currentConfig);
      task.options.runtimeConfig = { ...(task.options.runtimeConfig ?? {}), ...effectiveRc };
      task.appendChat(
        'user',
        'text',
        decision.instructions ?? 'Reexecute a task com a configuracao atualizada.',
        rc,
      );
      this.markTaskDirty(task);
      this.recordEvent(SWARM_EVENT_TYPE.TASK_RETRY_REQUESTED, {
        task,
        runId: run.runId,
        payload: { reason: decision.instructions ?? '' },
      });
      this.recordEvent(SWARM_EVENT_TYPE.TASK_RETRIED, {
        task,
        runId: run.runId,
        payload: { retryCount: task.retryCount },
      });
      this.persist();
      this.scheduleTask(task.taskId);
      return;
    }

    if (decision.status === 'waiting') {
      const waitGroups = this.normalizeWaitGroups(task, decision);
      this.markEventsProcessed(task, triggerEvents);
      task.resultMessages = task.appendAgentMessages(decision.messages);
      this.startOrUpdateWaitRun(task, run, waitGroups, task.resultMessages);
      this.announceDelegation(task, waitGroups);
      task.status = TASK_STATUS.WAITING;
      this.markTaskDirty(task);
      this.recordEvent(SWARM_EVENT_TYPE.TASK_WAITING, {
        task,
        runId: run.runId,
        payload: { waitGroups },
      });
      this.persist();
      this.resumeIfWaitSatisfied(task);
      return;
    }

    // completed
    // Structural guard: an agent cannot finish while its own subtasks are still
    // pending. Creating a subtask means depending on it, so a premature
    // `completed` is coerced into WAITING (WAIT_ALL over the unfinished subtasks).
    // The parent re-runs with their results once they settle — that is what the
    // workflow exists for, and it stops the root reaching REVIEW too early.
    // A same-turn consolidation cannot have the subtasks' real results (those
    // arrive as events on the NEXT run), so any subtask created this run — or
    // still pending — forces WAITING. The parent re-runs and consolidates from
    // the delivered results; if they already finished, resume is immediate.
    const pendingSubtasks = this.getSubtasks(task)
      .filter((st) => !isTerminalTaskStatus(st.status))
      .map((st) => st.taskId);
    const waitTaskIds = uniqueStrings([...newSubtaskIds, ...pendingSubtasks]);
    if (waitTaskIds.length > 0) {
      this.coerceToWait(task, run, decision.messages, waitTaskIds, triggerEvents);
      return;
    }

    // Manager delegation guard: if the Manager is a root task that CAN delegate
    // but returned completed without creating ANY subtasks, force a retry with
    // stronger delegation instructions. Simple one-liner tasks are exempt.
    const isManagerRoot = !task.options.parentId && task.options.assignedTo === MANAGER_AGENT;
    if (isManagerRoot && task.subtaskIds.length === 0 && task.runs.length <= 1) {
      const firstUserMsg = task.chat.find((m) => m.role === 'user')?.text ?? '';
      const isSimpleTask = firstUserMsg.length < 60 && !firstUserMsg.includes('\n');
      if (!isSimpleTask) {
        // Force retry with delegation instruction
        task.retryCount += 1;
        task.status = TASK_STATUS.PENDING;
        task.appendChat(
          'user', 'text',
          'Voce e o ORQUESTRADOR. NAO faca o trabalho diretamente. ' +
          'Crie subtasks via create_subtask para cada parte do trabalho, delegue aos agentes especializados, ' +
          'e retorne status waiting com waitGroups. So responda completed depois de consolidar os resultados das subtasks.',
        );
        this.markTaskDirty(task);
        this.recordEvent(SWARM_EVENT_TYPE.TASK_RETRY_REQUESTED, {
          task, runId: run.runId,
          payload: { reason: 'Manager completou sem delegar - forçando retry com instrução de delegação' },
        });
        this.recordEvent(SWARM_EVENT_TYPE.TASK_RETRIED, {
          task, runId: run.runId,
          payload: { retryCount: task.retryCount },
        });
        this.persist();
        this.scheduleTask(task.taskId);
        return;
      }
    }

    // Sanitize result messages: remove raw technical errors before showing to user
    const sanitizedMessages = sanitizeMessages(decision.messages);

    this.markEventsProcessed(task, triggerEvents);
    task.resultMessages = task.appendAgentMessages(sanitizedMessages);
    this.completeActiveRun(task, run);
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.RUN_COMPLETED, {
      task,
      runId: run.runId,
      messages: task.resultMessages,
    });
    // A Manager root task is not finished until the user reviews it: the Manager
    // hands it off to Revisão (REVIEW); the user later completes or reopens it.
    // Subtasks (and non-Manager roots) complete normally so wait groups resolve.
    if (isManagerRoot) {
      task.status = TASK_STATUS.REVIEW;
      this.recordEvent(SWARM_EVENT_TYPE.TASK_REVIEW, {
        task,
        runId: run.runId,
        messages: task.resultMessages,
      });
    } else {
      task.status = TASK_STATUS.COMPLETED;
      this.recordEvent(SWARM_EVENT_TYPE.TASK_COMPLETED, {
        task,
        runId: run.runId,
        messages: task.resultMessages,
      });
    }
    this.persist();
  }

  /** Check Definition of Done before allowing REVIEW/COMPLETED. */
  private checkDoD(task: Task): { passed: boolean; failures: string[] } {
    const failures: string[] = [];

    // 1. Scope-spec all satisfied
    const scopeSpec = this.taskFileStore.loadScopeSpec(task.taskId);
    if (scopeSpec.length > 0) {
      const unsatisfied = scopeSpec.filter((item) => !item.satisfied);
      if (unsatisfied.length > 0) {
        failures.push(`Scope-spec incompleto: ${unsatisfied.length} itens nao atendidos`);
      }
    }

    // 2. No open subtasks
    const openSubtasks = task.subtaskIds.filter((id) => {
      const st = this.tasks.get(id);
      return st && !isTerminalTaskStatus(st.status);
    });
    if (openSubtasks.length > 0) {
      failures.push(`${openSubtasks.length} subtasks ainda abertas`);
    }

    // 3. Within budget
    if (!this.budget.isWithinBudget()) {
      failures.push('Budget global excedido');
    }

    return { passed: failures.length === 0, failures };
  }

  // Parks the task in WAITING on the given subtask ids (WAIT_ALL), retaining the
  // current messages. If the deps already settled, resumes immediately so the
  // parent re-runs and consolidates from the real, delivered results.
  private coerceToWait(
    task: Task,
    run: TaskRun,
    messages: AgentOutputMessage[],
    waitTaskIds: string[],
    triggerEvents: SwarmEvent[],
    reason?: string,
  ): void {
    const waitGroups = this.normalizeWaitGroups(task, {
      status: 'waiting',
      messages,
      waitGroups: [{ waitId: 'auto', mode: WAIT_GROUP_MODE.WAIT_ALL, taskIds: uniqueStrings(waitTaskIds) }],
    });
    this.markEventsProcessed(task, triggerEvents);
    if (messages.length > 0) task.resultMessages = task.appendAgentMessages(messages);
    this.startOrUpdateWaitRun(task, run, waitGroups, task.resultMessages);
    this.announceDelegation(task, waitGroups);
    task.status = TASK_STATUS.WAITING;
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_WAITING, {
      task,
      runId: run.runId,
      payload: { waitGroups, coerced: true, ...(reason ? { reason } : {}) },
    });
    this.persist();
    this.resumeIfWaitSatisfied(task);
  }

  private handleRunFailure(
    task: Task,
    run: TaskRun,
    error: unknown,
    triggerEvents: SwarmEvent[],
    startedAt: string,
    newSubtaskIds: string[] = [],
  ): void {
    const finishedAt = new Date().toISOString();
    task.metrics.finishedAt = finishedAt;
    task.metrics.durationMs += Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
    const message = errorMessage(error);
    const isTimeout = error instanceof RunTimeoutError;
    const isBudget = error instanceof BudgetExceededError;
    const isInvalidOutput = error instanceof AgentOutputInvalidError;

    run.error = message;
    run.status = isTimeout ? 'TIMEOUT' : 'FAILED';
    run.completedAt = finishedAt;

    if (isTimeout) {
      this.recordEvent(SWARM_EVENT_TYPE.RUN_TIMEOUT, { task, runId: run.runId, payload: { error: message } });
    } else {
      this.recordEvent(SWARM_EVENT_TYPE.RUN_FAILED, { task, runId: run.runId, payload: { error: message } });
    }
    if (isInvalidOutput) {
      this.recordEvent(SWARM_EVENT_TYPE.AGENT_OUTPUT_INVALID, {
        task,
        runId: run.runId,
        payload: { error: message, output: (error as AgentOutputInvalidError).rawOutput.slice(0, 4000) },
      });
    }
    if (isBudget) {
      this.recordEvent(SWARM_EVENT_TYPE.BUDGET_EXCEEDED, { task, runId: run.runId, payload: { error: message } });
    }

    // Resilience: if the agent already created subtasks this run but failed to
    // emit a valid waiting decision (model non-compliance), park in WAITING on
    // the still-unfinished subtasks instead of retrying/failing. Creating a
    // subtask means depending on it — the parent must await and consolidate.
    if (!isBudget && !isTimeout) {
      const pendingSubtasks = this.getSubtasks(task)
        .filter((st) => !isTerminalTaskStatus(st.status))
        .map((st) => st.taskId);
      const waitTaskIds = uniqueStrings([...newSubtaskIds, ...pendingSubtasks]);
      if (waitTaskIds.length > 0) {
        try {
          this.coerceToWait(task, run, [], waitTaskIds, triggerEvents, message);
          return;
        } catch {
          // Coercion failed (e.g. no valid subtask deps) — fall through to retry.
        }
      }
    }

    if (!isBudget && task.technicalRetryCount < MAX_TECHNICAL_RETRIES) {
      task.technicalRetryCount += 1;
      task.status = TASK_STATUS.PENDING;
      task.appendChat(
        'user',
        'text',
        `A execucao anterior falhou: ${sanitizeErrorMessage(message)}. Reexecute mantendo o objetivo original. Retorne somente JSON puro valido no contrato especificado.`,
      );
      this.markTaskDirty(task);
      this.recordEvent(SWARM_EVENT_TYPE.TASK_RETRY_REQUESTED, {
        task,
        runId: run.runId,
        payload: { reason: message, technical: true },
      });
      this.recordEvent(SWARM_EVENT_TYPE.TASK_RETRIED, {
        task,
        runId: run.runId,
        payload: { technicalRetryCount: task.technicalRetryCount },
      });
      this.persist();
      this.scheduleTask(task.taskId, triggerEvents, RETRY_BASE_DELAY_MS * task.technicalRetryCount);
      return;
    }

    task.resultMessages = task.appendAgentMessages([
      { type: 'text', text: `Falha ao executar task. ${sanitizeErrorMessage(message)}` },
    ]);
    this.failTask(task, run, message);
    this.persist();
  }

  private failTask(task: Task, run: TaskRun, reason: string, failureReason?: import('../domain/task.js').FailureReason): void {
    task.status = TASK_STATUS.FAILED;
    task.failureReason = failureReason;
    task.metrics.finishedAt = new Date().toISOString();
    run.status = 'FAILED';
    run.completedAt = run.completedAt ?? new Date().toISOString();
    run.error = reason;
    task.activeRunId = undefined;
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_FAILED, {
      task,
      runId: run.runId,
      messages: task.resultMessages,
      payload: { error: reason },
    });
    this.scheduler.rebuildWaitIndex(this.tasks);
  }

  // -----------------------------------------------------------------------
  // Private: wait groups, normalization, cycle detection
  // -----------------------------------------------------------------------

  private normalizeWaitGroups(task: Task, decision: AgentDecision): AgentWaitGroup[] {
    const candidateGroups = decision.waitGroups?.length
      ? decision.waitGroups
      : [
          {
            waitId: 'default',
            mode: decision.waitMode ?? WAIT_GROUP_MODE.WAIT_ALL,
            taskIds: decision.waitingForTaskIds?.length
              ? decision.waitingForTaskIds
              : this.getSubtasks(task)
                  .filter((st) => !isTerminalTaskStatus(st.status))
                  .map((st) => st.taskId),
          },
        ];

    const normalizedGroups = candidateGroups.map((group) => this.normalizeSingleWaitGroup(task, group));
    if (normalizedGroups.length === 0 || normalizedGroups.every((group) => group.taskIds.length === 0)) {
      throw new AgentOutputInvalidError(
        'Status waiting sem wait group valido ou taskIds vazios',
        JSON.stringify(decision),
      );
    }
    return normalizedGroups;
  }

  private normalizeSingleWaitGroup(task: Task, group: AgentWaitGroup): AgentWaitGroup {
    if (!group.waitId || typeof group.waitId !== 'string') {
      throw new AgentOutputInvalidError('Wait group sem waitId valido', JSON.stringify(group));
    }
    const waitId = sanitizeWaitId(group.waitId);
    if (group.mode !== 'WAIT_ALL' && group.mode !== 'ON_DEMAND') {
      throw new AgentOutputInvalidError(`Wait group ${waitId} com mode invalido`, JSON.stringify(group));
    }
    const taskIds = uniqueStrings(group.taskIds ?? []);
    if (taskIds.length === 0) {
      throw new AgentOutputInvalidError(`Wait group ${waitId} vazio`, JSON.stringify(group));
    }

    for (const dependencyTaskId of taskIds) {
      if (dependencyTaskId === task.taskId) {
        throw new AgentOutputInvalidError(`Self-wait detectado em ${task.taskId}`, JSON.stringify(group));
      }
      const dependency = this.tasks.get(dependencyTaskId);
      if (!dependency) {
        throw new AgentOutputInvalidError(
          `Wait group ${waitId} referencia task inexistente: ${dependencyTaskId}`,
          JSON.stringify(group),
        );
      }
      if (dependency.options.parentId !== task.taskId) {
        throw new AgentOutputInvalidError(
          `Wait group ${waitId} referencia task que nao e subtask direta: ${dependencyTaskId}`,
          JSON.stringify(group),
        );
      }
      if (this.waitGraphReachable(dependencyTaskId, task.taskId)) {
        throw new AgentOutputInvalidError(
          `Ciclo de dependencia detectado entre ${task.taskId} e ${dependencyTaskId}`,
          JSON.stringify(group),
        );
      }
    }

    return { waitId, mode: group.mode, taskIds };
  }

  private waitGraphReachable(fromTaskId: string, targetTaskId: string, visited = new Set<string>()): boolean {
    if (fromTaskId === targetTaskId) return true;
    if (visited.has(fromTaskId)) return false;
    visited.add(fromTaskId);
    const task = this.tasks.get(fromTaskId);
    if (!task) return false;
    const run = this.getActiveRun(task);
    if (!run) return false;
    for (const group of run.waitGroups) {
      for (const dependencyTaskId of group.taskIds) {
        if (this.waitGraphReachable(dependencyTaskId, targetTaskId, visited)) return true;
      }
    }
    return false;
  }

  // Handles the race where dependencies already settled before the wait was
  // registered (very fast subtasks, or replay): re-evaluate now and resume.
  private resumeIfWaitSatisfied(task: Task): void {
    const ready = this.getReadyEvents(task);
    if (ready.length > 0) this.scheduleTask(task.taskId, ready);
  }

  private getReadyEvents(task: Task): SwarmEvent[] {
    const run = this.getActiveRun(task);
    if (!run || run.status !== 'WAITING') return [];

    for (const group of run.waitGroups) {
      if (group.status === WAIT_GROUP_STATUS.PROCESSED) continue;
      const terminalEvents = this.events
        .filter(
          (event) =>
            isTerminalTaskEvent(event.type) &&
            Boolean(event.taskId) &&
            group.taskIds.includes(event.taskId as string) &&
            !event.processedByTaskIds.includes(task.taskId) &&
            !group.processedEventIds.includes(event.eventId),
        )
        .map((event) => ({ ...event, runId: run.runId, waitId: group.waitId }));

      const failedEvent = terminalEvents.find(
        (event) => event.type === SWARM_EVENT_TYPE.TASK_FAILED || event.type === SWARM_EVENT_TYPE.TASK_CANCELLED,
      );
      if (failedEvent) {
        if (group.status !== WAIT_GROUP_STATUS.READY) {
          group.status = WAIT_GROUP_STATUS.READY;
          this.recordEvent(SWARM_EVENT_TYPE.WAIT_GROUP_READY, {
            task,
            runId: run.runId,
            waitId: group.waitId,
            payload: { reason: failedEvent.type },
          });
        }
        return [failedEvent];
      }

      if (group.mode === WAIT_GROUP_MODE.ON_DEMAND && terminalEvents.length > 0) {
        if (group.status !== WAIT_GROUP_STATUS.READY) {
          group.status = WAIT_GROUP_STATUS.READY;
          this.recordEvent(SWARM_EVENT_TYPE.WAIT_GROUP_READY, {
            task,
            runId: run.runId,
            waitId: group.waitId,
            payload: { reason: 'ON_DEMAND' },
          });
        }
        return [terminalEvents[0]];
      }

      const allCompleted = group.taskIds.every(
        (dependencyTaskId) => this.tasks.get(dependencyTaskId)?.status === TASK_STATUS.COMPLETED,
      );
      if (group.mode === WAIT_GROUP_MODE.WAIT_ALL && allCompleted) {
        if (group.status !== WAIT_GROUP_STATUS.READY) {
          group.status = WAIT_GROUP_STATUS.READY;
          this.recordEvent(SWARM_EVENT_TYPE.WAIT_GROUP_READY, {
            task,
            runId: run.runId,
            waitId: group.waitId,
            payload: { reason: 'WAIT_ALL' },
          });
        }
        if (terminalEvents.length > 0) return terminalEvents;
        // The group is satisfied but every completion was already consumed — the
        // agent re-emitted `waiting` on subtasks that had already settled (common
        // with weaker models). An empty return would leave the parent stuck in
        // WAITING forever; re-deliver the known completions so it resumes and
        // consolidates. Pathological re-wait loops are bounded by the card ceiling.
        return this.events
          .filter(
            (event) =>
              isTerminalTaskEvent(event.type) &&
              Boolean(event.taskId) &&
              group.taskIds.includes(event.taskId as string),
          )
          .map((event) => ({ ...event, runId: run.runId, waitId: group.waitId }));
      }
    }

    return [];
  }

  private markEventsProcessed(task: Task, triggerEvents: SwarmEvent[]): void {
    const run = this.getActiveRun(task);
    for (const event of triggerEvents) {
      const originalEvent = this.events.find((candidate) => candidate.eventId === event.eventId) ?? event;
      const group = run?.waitGroups.find((candidate) => candidate.waitId === event.waitId);
      if (group && !group.processedEventIds.includes(originalEvent.eventId)) {
        group.processedEventIds.push(originalEvent.eventId);
        const processedTaskIds = new Set(
          this.events
            .filter(
              (candidate) =>
                isTerminalTaskEvent(candidate.type) &&
                Boolean(candidate.taskId) &&
                group.taskIds.includes(candidate.taskId as string) &&
                group.processedEventIds.includes(candidate.eventId),
            )
            .map((candidate) => candidate.taskId as string),
        );
        if (group.taskIds.every((tid) => processedTaskIds.has(tid))) {
          group.status = WAIT_GROUP_STATUS.PROCESSED;
          this.recordEvent(SWARM_EVENT_TYPE.WAIT_GROUP_PROCESSED, {
            task,
            runId: run?.runId,
            waitId: group.waitId,
          });
        }
      }
      if (!originalEvent.processedByTaskIds.includes(task.taskId)) {
        originalEvent.processedByTaskIds.push(task.taskId);
      }
      if (!task.chat.some((message) => message.eventId === originalEvent.eventId)) {
        const eventMessage = task.appendChat(
          'event',
          'event',
          `task ${originalEvent.taskId ?? '-'} ${terminalEventVerb(originalEvent.type)}`,
          undefined,
          undefined,
          originalEvent.messages?.flatMap((m) => m.artifacts ?? []),
          originalEvent.eventId,
        );
        // Carry the referenced subtask id so the UI can open its chat / show its result.
        if (originalEvent.taskId) eventMessage.refTaskId = originalEvent.taskId;
      }
    }
    if (triggerEvents.length > 0) this.markTaskDirty(task);
  }

  private scheduleWaitersForEvent(event: SwarmEvent): void {
    this.scheduler.scheduleWaitersForEvent(
      event,
      this.tasks,
      (waiter) => this.getReadyEvents(waiter),
      (taskId, events) => this.scheduleTask(taskId, events),
    );
  }

  // -----------------------------------------------------------------------
  // Private: run lifecycle
  // -----------------------------------------------------------------------

  private getActiveRun(task: Task): TaskRun | undefined {
    return task.activeRunId ? task.runs.find((run) => run.runId === task.activeRunId) : undefined;
  }

  private getOrCreateExecutionRun(task: Task, startedAt: string): TaskRun {
    const active = this.getActiveRun(task);
    if (active) return active;
    const run: TaskRun = {
      runId: this.nextId('run'),
      status: 'RUNNING',
      epoch: task.runs.length + 1,
      waitGroups: [],
      resultMessages: [],
      createdAt: startedAt,
      startedAt,
    };
    task.activeRunId = run.runId;
    task.runs.push(run);
    return run;
  }

  // Posts one deterministic feedback line naming the delegated subtasks and the
  // wait mode, so the user always sees "what is happening" even when the model
  // forgets to call post_message itself. Skips if the same line was just posted.
  private announceDelegation(task: Task, waitGroups: AgentWaitGroup[]): void {
    const subtasks = waitGroups
      .flatMap((g) => g.taskIds)
      .map((id) => this.tasks.get(id))
      .filter((st): st is Task => Boolean(st));
    if (subtasks.length === 0) return;
    const modes = [...new Set(waitGroups.map((g) => g.mode))].join('/');
    const lines = subtasks.map((st) => `• ${st.options.title} → ${st.options.assignedTo} [${st.status}]`);
    const text = `Deleguei ${subtasks.length} subtask(s) e estou aguardando (${modes}):\n${lines.join('\n')}`;
    const last = task.chat[task.chat.length - 1];
    if (last && last.role === 'assistant' && last.text === text) return;
    this.postAgentMessage(task, text);
  }

  private startOrUpdateWaitRun(
    task: Task,
    run: TaskRun,
    waitGroups: AgentWaitGroup[],
    resultMessages: TaskChatMessage[],
  ): void {
    run.status = 'WAITING';
    // A run entering WAITING is in a valid state again; drop any error left by a
    // failed attempt that was recovered via coercion (no scary stale error).
    run.error = undefined;
    run.resultMessages = resultMessages;
    run.waitGroups = mergeWaitGroups(
      run.waitGroups,
      waitGroups.map((group) => ({
        waitId: group.waitId,
        mode: group.mode,
        taskIds: group.taskIds,
        processedEventIds: [],
        status: WAIT_GROUP_STATUS.WAITING as 'WAITING',
      })),
    );
    task.activeRunId = run.runId;
    this.scheduler.rebuildWaitIndex(this.tasks);
    for (const group of waitGroups) {
      this.recordEvent(SWARM_EVENT_TYPE.WAIT_GROUP_REGISTERED, {
        task,
        runId: run.runId,
        waitId: group.waitId,
        payload: { group },
      });
    }
  }

  private completeActiveRun(task: Task, run: TaskRun): void {
    run.status = 'COMPLETED';
    run.completedAt = new Date().toISOString();
    run.checkpointSeq = this.nextSeq - 1; // last event seq
    for (const group of run.waitGroups) group.status = WAIT_GROUP_STATUS.PROCESSED;
    task.activeRunId = undefined;
    this.scheduler.rebuildWaitIndex(this.tasks);
  }

  // -----------------------------------------------------------------------
  // Private: state recovery
  // -----------------------------------------------------------------------

  private loadState(): void {
    // The event log is the append-only source of truth; always load it from the
    // jsonl rather than the snapshot (which no longer embeds it).
    this.events = this.eventStore.loadAll();
    const snapshot = this.snapshotStore.loadSnapshot();
    if (snapshot) {
      this.nextSeq =
        snapshot.nextSeq ?? this.events.reduce((max, event) => Math.max(max, event.seq), 0) + 1;
      this.rootTaskIds = uniqueStrings(snapshot.rootTaskIds ?? []);
      for (const serializedTask of snapshot.tasks ?? []) {
        const task = TaskImpl.fromSerialized(serializedTask);
        this.tasks.set(task.taskId, task);
        if (!task.options.parentId && !this.rootTaskIds.includes(task.taskId)) {
          this.rootTaskIds.push(task.taskId);
        }
      }
      // Load chats from file store
      for (const task of this.tasks.values()) {
        const chat = this.taskFileStore.loadChat(task.taskId);
        if (chat.length > 0) {
          task.chat = chat;
        }
      }
    } else {
      this.nextSeq = this.events.reduce((max, event) => Math.max(max, event.seq), 0) + 1;
      this.replayEventsMinimal();
    }

    // events.jsonl stores each event as appended (processedByTaskIds: []). That
    // per-task consumption flag is mutated in-place after append and only the
    // wait groups persist it, so rebuild it from the loaded runs' processedEventIds.
    this.rederiveProcessedEvents();
    this.repairDepths();
    this.deriveIdCounters();
    this.recoverStatusesAfterCrash();
    this.reseedBudget();
  }

  /**
   * Rebuild each event's `processedByTaskIds` (the per-task "already consumed"
   * flag) from the persisted wait groups. This flag mutates in-place after the
   * event is appended to the log, so it is not in events.jsonl; the equivalent
   * `group.processedEventIds` IS persisted on the runs, so we replay it here.
   */
  private rederiveProcessedEvents(): void {
    const eventById = new Map(this.events.map((event) => [event.eventId, event]));
    for (const task of this.tasks.values()) {
      for (const run of task.runs) {
        for (const group of run.waitGroups) {
          for (const eventId of group.processedEventIds) {
            const event = eventById.get(eventId);
            if (event && !event.processedByTaskIds.includes(task.taskId)) {
              event.processedByTaskIds.push(task.taskId);
            }
          }
        }
      }
    }
  }

  /** Re-seed BudgetTracker from persisted task.metrics so post-restart gate matches live state. */
  private reseedBudget(): void {
    for (const task of this.tasks.values()) {
      if (task.metrics.cost > 0 || task.metrics.tokens.total > 0) {
        this.budget.trackUsage(
          task.taskId,
          task.metrics.tokens.input,
          task.metrics.tokens.output,
          task.metrics.cost,
        );
      }
    }
  }

  // Resumes sequential id counters from the highest suffix already persisted,
  // so newly minted ids never collide with restored ones.
  private deriveIdCounters(): void {
    const suffix = (id: string | undefined, prefix: string): number => {
      const match = id ? new RegExp(`^${prefix}_(\\d+)$`).exec(id) : null;
      return match ? Number(match[1]) : 0;
    };
    let task = 0;
    let run = 0;
    for (const t of this.tasks.values()) {
      task = Math.max(task, suffix(t.taskId, 'task'));
      for (const r of t.runs) run = Math.max(run, suffix(r.runId, 'run'));
    }
    const evt = this.events.reduce((max, e) => Math.max(max, suffix(e.eventId, 'evt')), 0);
    this.idCounters = { task, run, evt };
  }

  private nextId(prefix: 'task' | 'run' | 'evt'): string {
    this.idCounters[prefix] += 1;
    return `${prefix}_${this.idCounters[prefix]}`;
  }

  private replayEventsMinimal(): void {
    for (const event of this.events) {
      const maybeTask = event.payload?.task as SerializedTask | undefined;
      if (
        (event.type === SWARM_EVENT_TYPE.TASK_CREATED ||
          event.type === SWARM_EVENT_TYPE.SUBTASK_CREATED) &&
        maybeTask &&
        typeof maybeTask.options?.taskId === 'string'
      ) {
        const task = TaskImpl.fromSerialized(maybeTask);
        this.tasks.set(task.taskId, task);
        if (!task.options.parentId && !this.rootTaskIds.includes(task.taskId)) {
          this.rootTaskIds.push(task.taskId);
        }
      }
      if (event.taskId) {
        const task = this.tasks.get(event.taskId);
        if (!task) continue;
        // Status transitions
        if (event.type === SWARM_EVENT_TYPE.TASK_QUEUED) task.status = TASK_STATUS.QUEUED;
        if (event.type === SWARM_EVENT_TYPE.TASK_STARTED) task.status = TASK_STATUS.RUNNING;
        if (event.type === SWARM_EVENT_TYPE.TASK_WAITING) task.status = TASK_STATUS.WAITING;
        if (event.type === SWARM_EVENT_TYPE.TASK_SUSPENDED) task.status = TASK_STATUS.SUSPENDED;
        if (event.type === SWARM_EVENT_TYPE.TASK_COMPLETED) task.status = TASK_STATUS.COMPLETED;
        if (event.type === SWARM_EVENT_TYPE.TASK_FAILED) {
          task.status = TASK_STATUS.FAILED;
          task.failureReason = (event.payload?.failureReason as import('../domain/task.js').FailureReason) ?? undefined;
        }
        if (event.type === SWARM_EVENT_TYPE.TASK_CANCELLED) {
          task.status = TASK_STATUS.CANCELLED;
          task.failureReason = 'cancelled_by_user';
        }
        if (event.type === SWARM_EVENT_TYPE.TASK_REVIEW) task.status = TASK_STATUS.REVIEW;
        // Chat reconstruction from events
        if (event.type === SWARM_EVENT_TYPE.MESSAGE_APPENDED && event.messages) {
          for (const msg of event.messages) {
            const exists = task.chat.some((c) => c.ts === msg.ts && c.role === msg.role && c.text === msg.text);
            if (!exists) task.chat.push(msg);
          }
        }
        // Artifact reconstruction
        if (event.type === SWARM_EVENT_TYPE.ARTIFACT_CREATED && event.payload?.artifact) {
          const artifact = event.payload.artifact as import('../domain/task.js').TaskArtifact;
          const exists = task.artifacts.some((a) => a.path === artifact.path);
          if (!exists) task.artifacts.push(artifact);
        }
        // Failure reason from TASK_FAILED payload
        if (event.type === SWARM_EVENT_TYPE.TASK_FAILED && event.payload?.failureReason) {
          task.failureReason = event.payload.failureReason as import('../domain/task.js').FailureReason;
        }
      }
    }
    // Drop archived families so replay-only recovery matches snapshot recovery.
    for (const event of this.events) {
      if (event.type !== SWARM_EVENT_TYPE.TASK_ARCHIVED) continue;
      const ids = (event.payload?.archivedTaskIds as string[] | undefined) ?? [];
      for (const id of ids) this.tasks.delete(id);
      if (event.taskId) {
        this.tasks.delete(event.taskId);
        this.rootTaskIds = this.rootTaskIds.filter((id) => id !== event.taskId);
      }
    }
  }

  private repairDepths(): void {
    const visit = (task: Task, depth: number): void => {
      task.options.depth = depth;
      for (const subtask of this.getSubtasks(task)) visit(subtask, depth + 1);
    };
    for (const rootTaskId of this.rootTaskIds) {
      const rootTask = this.tasks.get(rootTaskId);
      if (rootTask) visit(rootTask, 0);
    }
    for (const task of this.tasks.values()) {
      if (task.options.parentId && !this.tasks.has(task.options.parentId)) {
        task.options.parentId = undefined;
        task.options.depth = 0;
        if (!this.rootTaskIds.includes(task.taskId)) this.rootTaskIds.push(task.taskId);
      }
    }
  }

  private recoverStatusesAfterCrash(): void {
    for (const task of this.tasks.values()) {
      if (task.status === TASK_STATUS.RUNNING || task.status === TASK_STATUS.QUEUED) {
        task.status = TASK_STATUS.PENDING;
        this.markTaskDirty(task);
      }
      if (task.status === TASK_STATUS.WAITING && !this.hasValidActiveWait(task)) {
        task.status = TASK_STATUS.PENDING;
        task.activeRunId = undefined;
        this.markTaskDirty(task);
      }
    }
    this.flushDirtyTasks();
  }

  private hasValidActiveWait(task: Task): boolean {
    const run = this.getActiveRun(task);
    if (!run || run.status !== 'WAITING') return false;
    return run.waitGroups.some(
      (group) =>
        group.status === 'WAITING' &&
        group.taskIds.length > 0 &&
        group.taskIds.every((tid) => {
          const dependency = this.tasks.get(tid);
          return Boolean(dependency && dependency.options.parentId === task.taskId);
        }),
    );
  }

  /** Generate a minimal scope-spec from the task's objective if one doesn't exist. */
  private ensureScopeSpec(task: Task): void {
    const existing = this.taskFileStore.loadScopeSpec(task.taskId);
    if (existing.length > 0) return;

    const firstUserMsg = task.chat.find((m) => m.role === 'user');
    const objective = firstUserMsg?.text ?? task.title;
    this.taskFileStore.saveScopeSpec(task.taskId, [
      { id: 'obj', description: objective, satisfied: false },
    ]);
  }

  /** Check if task has stagnated across consecutive runs. */
  private checkForStagnation(task: Task, currentOutput: string): 'stagnation' | null {
    if (task.runs.length < 2) return null;
    const signals: RunSignal[] = task.runs
      .filter((r) => r.resultMessages.length > 0)
      .map((r) => ({
        output: r.resultMessages.map((m) => m.text ?? '').join(' '),
        epoch: r.epoch,
      }));
    // Add current output
    signals.push({ output: currentOutput, epoch: task.runs.length + 1 });
    return checkStagnation(signals);
  }

  // -----------------------------------------------------------------------
  // Private: events, budget, queue helpers
  // -----------------------------------------------------------------------

  private recordEvent(
    type: SwarmEventType,
    args: {
      task?: Task;
      parentId?: string;
      runId?: string;
      waitId?: string;
      messages?: TaskChatMessage[];
      payload?: Record<string, unknown>;
    } = {},
  ): SwarmEvent {
    if (
      (type === SWARM_EVENT_TYPE.TASK_COMPLETED ||
        type === SWARM_EVENT_TYPE.TASK_FAILED ||
        type === SWARM_EVENT_TYPE.TASK_CANCELLED) &&
      args.task
    ) {
      const alreadyRecorded = this.events.some(
        (event) => event.type === type && event.taskId === args.task?.taskId,
      );
      if (alreadyRecorded) {
        return this.events.find(
          (event) => event.type === type && event.taskId === args.task?.taskId,
        ) as SwarmEvent;
      }
    }

    const event: SwarmEvent = {
      seq: this.nextSeq++,
      eventId: this.nextId('evt'),
      type,
      taskId: args.task?.taskId,
      parentId: args.parentId ?? args.task?.options.parentId,
      runId: args.runId,
      waitId: args.waitId,
      ts: new Date().toISOString(),
      messages: args.messages,
      processedByTaskIds: [],
      payload: args.payload,
    };
    this.events.push(event);
    this.eventStore.append(event);
    console.log(formatSwarmEvent(event));
    // Push every recorded event so the UI updates in real time. Relying on
    // 'state:changed' alone misses most events (it is emitted sparsely and only
    // ever carries the latest event).
    this.emit('event', event);
    if (isTerminalTaskEvent(type)) this.scheduleWaitersForEvent(event);
    return event;
  }

  private assertWithinBudget(): void {
    if (!this.budget.isWithinBudget()) {
      const summary = this.budget.getSummary();
      this.recordEvent(SWARM_EVENT_TYPE.BUDGET_EXCEEDED, {
        payload: { totalTokens: summary.totalTokens, totalCost: summary.totalCost },
      });
      throw new BudgetExceededError(
        `Budget excedido: tokens=${summary.totalTokens}/${MAX_TOTAL_TOKENS} cost=${summary.totalCost}/${MAX_TOTAL_COST}`,
      );
    }
  }

  private assertWithinCardCeiling(task: Task): void {
    const ceiling = { maxCost: MAX_TOTAL_COST, maxActiveMs: RUN_TIMEOUT_MS * MAX_TASK_RETRIES };
    const reason = checkCardCeiling(task.metrics, ceiling);
    if (reason) {
      this.recordEvent(SWARM_EVENT_TYPE.BUDGET_EXCEEDED, {
        task,
        payload: { scope: 'card', cost: task.metrics.cost, durationMs: task.metrics.durationMs },
      });
      throw new BudgetExceededError(
        `Card ceiling excedido: cost=${task.metrics.cost} duration=${task.metrics.durationMs}ms`,
      );
    }
  }

  private isQuiescent(): boolean {
    return (
      this.runningTaskIds.size === 0 &&
      this.queuedTaskIds.size === 0 &&
      this.taskQueue.length === 0 &&
      [...this.tasks.values()].every(
        (task) =>
          task.status !== TASK_STATUS.PENDING &&
          task.status !== TASK_STATUS.QUEUED &&
          task.status !== TASK_STATUS.RUNNING,
      )
    );
  }

  private mergePendingTriggerEvents(taskId: string, triggerEvents: SwarmEvent[]): void {
    if (triggerEvents.length === 0) return;
    const existing = this.pendingTriggerEvents.get(taskId) ?? new Map<string, SwarmEvent>();
    for (const event of triggerEvents) existing.set(event.eventId, event);
    this.pendingTriggerEvents.set(taskId, existing);
  }

  private takePendingTriggerEvents(taskId: string): SwarmEvent[] {
    const events = [...(this.pendingTriggerEvents.get(taskId)?.values() ?? [])];
    this.pendingTriggerEvents.delete(taskId);
    return events;
  }

  private markTaskDirty(task: Task): void {
    this.dirtyTaskIds.add(task.taskId);
  }

  private flushDirtyTasks(): void {
    for (const taskId of this.dirtyTaskIds) {
      const task = this.tasks.get(taskId);
      if (task) {
        this.taskFileStore.ensureTaskDir(taskId);
        this.taskFileStore.saveTaskYaml(taskId, task.serialize());
        this.taskFileStore.saveChat(taskId, task.chat);
        this.taskFileStore.saveArtifacts(taskId, task.artifacts);
      }
    }
    this.dirtyTaskIds.clear();
  }

  private assertAgentExists(agentName: string): void {
    if (!this.agents.has(agentName)) throw new Error(`Agente ${agentName} não encontrado`);
  }

  private getTaskRelativePath(taskId: string, filename: string): string {
    this.sandbox.validateTaskId(taskId);
    return this.sandbox.relativeTo(this.sandbox.resolveSubpath('.swarm', 'tasks', taskId, filename));
  }

  private formatTaskDependencies(task: Task): string {
    const dependencies = new Set<string>();
    for (const run of task.runs) {
      for (const group of run.waitGroups) {
        for (const tid of group.taskIds) dependencies.add(`${group.waitId}:${tid}`);
      }
    }
    if (task.options.parentId) dependencies.add(`parent:${task.options.parentId}`);
    return dependencies.size ? [...dependencies].join(', ') : '-';
  }

  private appendTaskGraph(lines: string[], task: Task, indent: string): void {
    lines.push(
      `${indent}${task.taskId} [${task.options.assignedTo}/${task.status}] ${task.title}`,
    );
    for (const run of task.runs) {
      lines.push(`${indent}  run ${run.runId} [${run.status}]`);
      for (const group of run.waitGroups) {
        lines.push(`${indent}    wait ${group.waitId} (${group.mode}/${group.status})`);
        for (const tid of group.taskIds) {
          const subtask = this.tasks.get(tid);
          lines.push(
            `${indent}      depends_on -> ${tid}${subtask ? ` [${subtask.options.assignedTo}/${subtask.status}]` : ''}`,
          );
        }
      }
    }
    for (const subtask of this.getSubtasks(task)) {
      this.appendTaskGraph(lines, subtask, `${indent}  `);
    }
  }
}
