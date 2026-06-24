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
import { BudgetTracker, BudgetExceededError } from './budget-tracker.js';
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
const DEFAULT_RUNTIME_CONFIG: Required<RuntimeConfig> = { model: DEFAULT_MODEL_ALIAS, effort: DEFAULT_EFFORT };

// Sentinel agent for tasks that sit in the Inbox awaiting user action (never scheduled).
export const INBOX_AGENT = 'inbox';
// Agent that orchestrates user-created tasks once they are sent to execution.
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
  const oneLine = raw.trim().split('\n')[0]?.trim() ?? '';
  const unquoted = oneLine.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (unquoted.length <= MAX_TITLE_LENGTH) return unquoted;
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

function isModelAlias(value: unknown): value is ModelAlias {
  return typeof value === 'string' && value in ALLOWED_MODELS;
}

function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === 'string' && ALLOWED_EFFORTS.includes(value as EffortLevel);
}

function normalizeRuntimeConfig(config?: RuntimeConfig): RuntimeConfig | undefined {
  if (!config) return undefined;
  const normalized: RuntimeConfig = {};
  if (config.model !== undefined) {
    if (!isModelAlias(config.model)) throw new Error(`Modelo alias invalido: ${config.model}`);
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
  stats: { tokens?: { input?: number; output?: number; total?: number }; cost?: number },
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

  private options: OrquestratorOptions;

  constructor(deps: OrquestratorDeps, options: OrquestratorOptions = {}) {
    super();
    this.options = options;
    this.eventStore = deps.eventStore;
    this.snapshotStore = deps.snapshotStore;
    this.taskFileStore = deps.taskFileStore;
    this.sandbox = deps.sandbox;
    this.piClient = deps.piClient;

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
    const normalizedConfig = normalizeRuntimeConfig(runtimeConfig);
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
      ...(normalizeRuntimeConfig(runtimeConfig) ?? {}),
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
        runtimeConfig: normalizeRuntimeConfig(runtimeConfig),
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
    for (const waiters of (this.scheduler as any).waitingByDependency?.values?.() ?? []) {
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
    if (!this.queuedTaskIds.has(taskId) && !this.runningTaskIds.has(taskId)) {
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
    try {
      this.taskFileStore.ensureTaskDir(task.taskId);
      const result = await this.piClient.run(agent, task, this, triggerEvents, controller.signal);
      // If the run was cancelled or the task was moved/superseded mid-flight,
      // discard the result so no phantom output is applied after a pause.
      if (controller.signal.aborted || task.activeRunId !== run.runId || task.status !== TASK_STATUS.RUNNING) {
        return;
      }
      const finishedAt = new Date().toISOString();
      task.metrics = addSessionStats(task.metrics, result.stats, startedAt, finishedAt);
      this.budget.trackUsage(task.taskId, result.stats.tokens?.input ?? 0, result.stats.tokens?.output ?? 0, result.stats.cost ?? 0);
      this.assertWithinBudget();
      const decision = parseDecision(result.output);
      task.technicalRetryCount = 0;
      this.applyDecision(task, run, decision, triggerEvents);
    } catch (error) {
      // A cancelled run (pause/move/cancel) must not be retried or failed.
      if (error instanceof RunCancelledError || controller.signal.aborted || task.activeRunId !== run.runId) {
        return;
      }
      this.handleRunFailure(task, run, error, triggerEvents, startedAt);
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
      sessionFile: task.piSessionFile ?? this.getTaskRelativePath(task.taskId, 'session.jsonl'),
      chatFile: this.getTaskRelativePath(task.taskId, 'chat.jsonl'),
      attachmentsDir: this.getTaskRelativePath(task.taskId, 'attachments'),
      artifactsDir: this.getTaskRelativePath(task.taskId, 'artifacts'),
      artifactsFile: this.getTaskRelativePath(task.taskId, 'artifacts.yaml'),
      runtimeConfig: this.resolveRuntimeConfig(task, agent),
      allowedModels: ALLOWED_MODELS,
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
    };
  }

  buildTaskMetadataBlock(task: Task, metadata?: TaskMetadata): string {
    const md = metadata ?? this.toMetadata(task);
    return ['<task_metadata>', JSON.stringify(md, null, 2), '</task_metadata>'].join('\n');
  }

  resolveRuntimeConfig(task: Task, agent?: Agent): Required<RuntimeConfig> {
    return mergeRuntimeConfig(agent?.runtimeConfig, task.options.runtimeConfig);
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  persist(): void {
    this.flushDirtyTasks();
    this.snapshotStore.saveSnapshot(this.tasks, this.events, this.rootTaskIds, this.nextSeq);
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
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    const path = this.taskFileStore.writeArtifactFile(task.taskId, fileName, content);
    const artifact: TaskArtifact = { description, fileType, path, sizeBytes };
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
  buildAgentTools(task: Task): CustomToolSpec[] {
    const delegatable = this.getAgentNames().filter(
      (name) => name !== MANAGER_AGENT && name !== INBOX_AGENT,
    );
    return [
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
      {
        name: 'create_subtask',
        description:
          'Cria uma subtask assincrona delegada a um agente especializado e retorna seus metadados (incluindo taskId). Use o taskId retornado nos waitGroups do status waiting.',
        parameters: {
          type: 'object',
          properties: {
            assignedTo: { type: 'string', enum: delegatable, description: 'Agente destino.' },
            title: { type: 'string', description: 'Titulo curto da subtask.' },
            message: { type: 'string', description: 'Instrucao objetiva e auto-contida da subtask.' },
            model: { type: 'string', enum: Object.keys(ALLOWED_MODELS) },
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
          });
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
      },
      {
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
      },
    ];
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
      String(task.metrics.tokens.total),
      String(task.metrics.tokens.input),
      String(task.metrics.tokens.output),
      formatCost(task.metrics.cost),
      `${task.retryCount}/${task.technicalRetryCount}`,
    ]);
    const totals = tasks.reduce(
      (acc, task) => ({
        durationMs: acc.durationMs + task.metrics.durationMs,
        input: acc.input + task.metrics.tokens.input,
        output: acc.output + task.metrics.tokens.output,
        total: acc.total + task.metrics.tokens.total,
        cost: acc.cost + task.metrics.cost,
      }),
      { durationMs: 0, input: 0, output: 0, total: 0, cost: 0 },
    );
    rows.push([
      'TOTAL',
      '-',
      '-',
      '-',
      formatDuration(totals.durationMs),
      String(totals.total),
      String(totals.input),
      String(totals.output),
      formatCost(totals.cost),
      '-',
    ]);
    return formatMarkdownTable(
      ['task', 'agent', 'status', 'depends_on', 'duration', 'tokens', 'input', 'output', 'price', 'retry/tech'],
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

      const rc = normalizeRuntimeConfig({ model: decision.model, effort: decision.effort });
      task.retryCount += 1;
      task.status = TASK_STATUS.PENDING;
      task.options.runtimeConfig = { ...(task.options.runtimeConfig ?? {}), ...(rc ?? {}) };
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
      task.status = TASK_STATUS.WAITING;
      this.markTaskDirty(task);
      this.recordEvent(SWARM_EVENT_TYPE.TASK_WAITING, {
        task,
        runId: run.runId,
        payload: { waitGroups },
      });
      this.persist();
      return;
    }

    // completed
    this.markEventsProcessed(task, triggerEvents);
    task.resultMessages = task.appendAgentMessages(decision.messages);
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
    const isManagerRoot = !task.options.parentId && task.options.assignedTo === MANAGER_AGENT;
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

  private handleRunFailure(
    task: Task,
    run: TaskRun,
    error: unknown,
    triggerEvents: SwarmEvent[],
    startedAt: string,
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

    if (!isBudget && task.technicalRetryCount < MAX_TECHNICAL_RETRIES) {
      task.technicalRetryCount += 1;
      task.status = TASK_STATUS.PENDING;
      task.appendChat(
        'user',
        'text',
        `A execucao anterior falhou tecnicamente: ${message}. Reexecute mantendo o objetivo original. Retorne somente JSON puro valido no contrato especificado.`,
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
      { type: 'text', text: `Falha ao executar task: ${message}` },
    ]);
    this.failTask(task, run, message);
    this.persist();
  }

  private failTask(task: Task, run: TaskRun, reason: string): void {
    task.status = TASK_STATUS.FAILED;
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
        return terminalEvents;
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
        task.appendChat(
          'event',
          'event',
          `task ${originalEvent.taskId ?? '-'} ${terminalEventVerb(originalEvent.type)}`,
          undefined,
          undefined,
          originalEvent.messages?.flatMap((m) => m.artifacts ?? []),
          originalEvent.eventId,
        );
      }
    }
    if (triggerEvents.length > 0) this.markTaskDirty(task);
  }

  private scheduleWaitersForEvent(event: SwarmEvent): void {
    this.scheduler.scheduleWaitersForEvent(event, this.tasks, (taskId, events) => {
      this.scheduleTask(taskId, events);
    });
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
      waitGroups: [],
      resultMessages: [],
      createdAt: startedAt,
      startedAt,
    };
    task.activeRunId = run.runId;
    task.runs.push(run);
    return run;
  }

  private startOrUpdateWaitRun(
    task: Task,
    run: TaskRun,
    waitGroups: AgentWaitGroup[],
    resultMessages: TaskChatMessage[],
  ): void {
    run.status = 'WAITING';
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
    for (const group of run.waitGroups) group.status = WAIT_GROUP_STATUS.PROCESSED;
    task.activeRunId = undefined;
    this.scheduler.rebuildWaitIndex(this.tasks);
  }

  // -----------------------------------------------------------------------
  // Private: state recovery
  // -----------------------------------------------------------------------

  private loadState(): void {
    const snapshot = this.snapshotStore.loadSnapshot();
    if (snapshot) {
      this.events = snapshot.events ?? this.eventStore.loadAll();
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
      this.events = this.eventStore.loadAll();
      this.nextSeq = this.events.reduce((max, event) => Math.max(max, event.seq), 0) + 1;
      this.replayEventsMinimal();
    }

    this.repairDepths();
    this.deriveIdCounters();
    this.recoverStatusesAfterCrash();
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
        if (event.type === SWARM_EVENT_TYPE.TASK_QUEUED) task.status = TASK_STATUS.QUEUED;
        if (event.type === SWARM_EVENT_TYPE.TASK_STARTED) task.status = TASK_STATUS.RUNNING;
        if (event.type === SWARM_EVENT_TYPE.TASK_WAITING) task.status = TASK_STATUS.WAITING;
        if (event.type === SWARM_EVENT_TYPE.TASK_COMPLETED) task.status = TASK_STATUS.COMPLETED;
        if (event.type === SWARM_EVENT_TYPE.TASK_FAILED) task.status = TASK_STATUS.FAILED;
        if (event.type === SWARM_EVENT_TYPE.TASK_CANCELLED) task.status = TASK_STATUS.CANCELLED;
        if (event.type === SWARM_EVENT_TYPE.TASK_REVIEW) task.status = TASK_STATUS.REVIEW;
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
