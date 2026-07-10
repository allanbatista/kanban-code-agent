import { EventEmitter } from 'node:events';
import { existsSync, lstatSync } from 'node:fs';
import { basename, join } from 'node:path';
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
  TaskMetrics,
} from '../domain/task.js';
import type { TaskRun } from '../domain/run.js';
import type { SwarmEvent } from '../domain/events.js';
import type { AgentWaitGroup, WaitGroup } from '../domain/wait-group.js';
import type { SwarmEventType, ModelAlias, EffortLevel, WaitGroupMode, AgentName } from '../domain/types.js';
import { AGENT_NAME } from '../domain/types.js';
import {
  SWARM_EVENT_TYPE,
  TASK_STATUS,
  WAIT_GROUP_MODE,
  WAIT_GROUP_STATUS,
} from '../domain/types.js';
import { AgentOutputInvalidError, parseDecision } from './decision-parser.js';
import { BudgetTracker, BudgetExceededError, CeilingExceededError, checkCardCeiling, isApproachingCeiling } from './budget-tracker.js';
import { checkStagnation, type RunSignal } from './convergence.js';
import { createDefaultGovernance, type Governance } from '../domain/governance.js';
import { Scheduler } from './scheduler.js';
import { WorkerPool, RunTimeoutError } from './worker-pool.js';
import { RunCancelledError, type CustomToolSpec } from './pi-client.js';
import type { AgentClient } from './agent-client.js';
import type { EventStore } from '../infrastructure/persistence/event-store.js';
import type { SnapshotStore } from '../infrastructure/persistence/snapshot-store.js';
import type { TaskFileStore } from '../infrastructure/persistence/task-file-store.js';
import type { PathSandbox } from '../infrastructure/filesystem/sandbox.js';
import type { Task as DomainTaskClass } from '../domain/task.js';
import { Task as TaskImpl } from '../domain/task.js';
import {
  ProjectFileStore,
  type CreateProjectInput,
  type ProjectData,
  type UpdateProjectInput,
} from '../infrastructure/persistence/project-file-store.js';
import { GitConflictError, GitRepo } from '../infrastructure/git/git-repo.js';
import { resolveDevcontainerImage } from '../infrastructure/containers/devcontainer.js';
import { WorkerSupervisor, type IsolationMode } from '../infrastructure/process/worker-supervisor.js';
import { gitCredentialEnvFromRuntime } from '../infrastructure/security/credentials.js';

// ---------------------------------------------------------------------------
// Constants (matching PoC defaults)
// ---------------------------------------------------------------------------

const DEFAULT_MODEL_ALIAS: ModelAlias = 'fast';
const DEFAULT_EFFORT: EffortLevel = 'off';
const DEFAULT_AGENT: AgentName = 'pi';

// Fallback registry when no resolved models are injected (deps.models). Aligned
// with config.ts defaults (DeepSeek) — no openrouter default anywhere (L13/F0.T2).
const ALLOWED_MODELS: Record<ModelAlias, { provider: string; modelId: string; description: string }> = {
  fast: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'tarefas simples e baixo custo' },
  balanced: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'uso geral equilibrado' },
  deep: { provider: 'deepseek', modelId: 'deepseek-v4-pro', description: 'tarefas complexas ou criticas' },
};

const ALLOWED_EFFORTS: EffortLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

// Model escalation ladder: fast → balanced → deep
const MODEL_LADDER: ModelAlias[] = ['fast', 'balanced', 'deep'];
const EFFORT_LADDER: EffortLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const DEFAULT_RUNTIME_CONFIG: Required<RuntimeConfig> = { model: DEFAULT_MODEL_ALIAS, effort: DEFAULT_EFFORT, agent: DEFAULT_AGENT };

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

const MAX_TASK_DEPTH = readPositiveIntegerEnv('SWARM_MAX_TASK_DEPTH', 5);
const MAX_SUBTASKS_PER_TASK = readPositiveIntegerEnv('SWARM_MAX_SUBTASKS_PER_TASK', 10);
const MAX_TASK_RETRIES = readPositiveIntegerEnv('SWARM_MAX_TASK_RETRIES', 3);
const MAX_TECHNICAL_RETRIES = readPositiveIntegerEnv('SWARM_MAX_TECHNICAL_RETRIES', 2);
const DEFAULT_RUN_TIMEOUT_MS = readPositiveIntegerEnv('SWARM_RUN_TIMEOUT_MS', 300000);
const DEFAULT_MAX_CONCURRENT_RUNS = readPositiveIntegerEnv('SWARM_MAX_CONCURRENT_RUNS', 4);
const DEFAULT_ISOLATION: IsolationMode = process.env.SWARM_ISOLATION === 'docker' ? 'docker' : 'inproc';
const RETRY_BASE_DELAY_MS = readPositiveIntegerEnv('SWARM_RETRY_BASE_DELAY_MS', 2000);
const MAX_TOTAL_TOKENS = readPositiveIntegerEnv('SWARM_MAX_TOTAL_TOKENS', Number.MAX_SAFE_INTEGER);
const MAX_TOTAL_COST = readPositiveNumberEnv('SWARM_MAX_TOTAL_COST', Number.POSITIVE_INFINITY);
const MAX_PROMPT_CHAT_MESSAGES = readPositiveIntegerEnv('SWARM_MAX_PROMPT_CHAT_MESSAGES', 60);
// Human-intervention timeout (§10.6): an unanswered WAITING(human) card is
// parked in SUSPENDED after this long, freeing prioritization. A late answer
// still revives it. Swept by a periodic monitor.
const HUMAN_TIMEOUT_MS = readPositiveIntegerEnv('SWARM_HUMAN_TIMEOUT_MS', 3_600_000);
const DEADLINE_SWEEP_MS = readPositiveIntegerEnv('SWARM_DEADLINE_SWEEP_MS', 30_000);
// Graceful-degradation warning threshold for per-card ceilings (§10.5).
const CEILING_WARNING_RATIO = 0.8;
// Convergence monitor knobs (§5.3) — configurable θ and N.
const CONVERGENCE_THETA = readPositiveNumberEnv('SWARM_CONVERGENCE_THETA', 0.9);
const STAGNATION_EPOCHS = readPositiveIntegerEnv('SWARM_STAGNATION_EPOCHS', 3);

// ---------------------------------------------------------------------------
// Dependency interface
// ---------------------------------------------------------------------------

export interface OrquestratorDeps {
  eventStore: EventStore;
  snapshotStore: SnapshotStore;
  taskFileStore: TaskFileStore;
  sandbox: PathSandbox;
  agents: Agent[];
  piClient: AgentClient;
  gitRepo?: GitRepo;
  workerSupervisor?: WorkerSupervisor;
  models?: Record<ModelAlias, { provider: string; modelId: string; description: string }>;
}

export interface OrquestratorOptions {
  resetState?: boolean;
  stopWhenWaiting?: boolean;
  runTimeoutMs?: number;
  maxConcurrentRuns?: number;
  isolation?: IsolationMode;
  /** Agent default global (alimentado pelos settings; F0 só carrega o campo). */
  defaultAgent?: AgentName;
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

function isAgentName(value: unknown): value is AgentName {
  return typeof value === 'string' && Object.values(AGENT_NAME).includes(value as AgentName);
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
  if (config.agent !== undefined) {
    if (!isAgentName(config.agent)) throw new Error(`Agent invalido: ${config.agent}`);
    normalized.agent = config.agent;
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
  readonly projects = new Map<string, ProjectData>();
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

  // Human-in-the-loop deadlines: taskId → ISO timestamp at which an unanswered
  // WAITING(human) card is parked in SUSPENDED. Swept by a periodic monitor.
  private humanDeadlines = new Map<string, string>();
  private deadlineTimer?: ReturnType<typeof setInterval>;

  // Independent-evaluation gate (§8.2/§11). Off by default (andaime §1.2,
  // opt-in via SWARM_EVALUATION_GATE=1); when on, a Manager root must pass QA +
  // Code Reviewer subtasks before reaching REVIEW.
  private readonly evaluationEnabled = process.env.SWARM_EVALUATION_GATE === '1';
  // Per-task governance snapshot defaults (§10). Captured into each run so a
  // mid-flight config change cannot move the goalposts of a running card.
  private readonly governance: Governance = createDefaultGovernance();

  private readonly scheduler = new Scheduler();
  private readonly workerPool: WorkerPool;
  private readonly workerSupervisor: WorkerSupervisor;
  private readonly runTimeoutMs: number;
  private readonly budget = new BudgetTracker(MAX_TOTAL_TOKENS, MAX_TOTAL_COST);
  private readonly projectMergeLocks = new Set<string>();

  private readonly eventStore: EventStore;
  private readonly snapshotStore: SnapshotStore;
  readonly taskFileStore: TaskFileStore;
  readonly projectFileStore: ProjectFileStore;
  readonly sandbox: PathSandbox;
  readonly piClient: AgentClient;
  readonly gitRepo: GitRepo;
  private readonly allowedModels: Record<ModelAlias, { provider: string; modelId: string; description: string }>;

  private options: OrquestratorOptions;

  constructor(deps: OrquestratorDeps, options: OrquestratorOptions = {}) {
    super();
    this.options = options;
    this.eventStore = deps.eventStore;
    this.snapshotStore = deps.snapshotStore;
    this.taskFileStore = deps.taskFileStore;
    this.sandbox = deps.sandbox;
    this.projectFileStore = new ProjectFileStore(deps.sandbox);
    this.piClient = deps.piClient;
    this.gitRepo = deps.gitRepo ?? new GitRepo({ env: gitCredentialEnvFromRuntime(deps.sandbox.getBaseDir()) });
    this.runTimeoutMs = options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    this.workerPool = new WorkerPool(this.runTimeoutMs, options.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS);
    this.workerSupervisor = deps.workerSupervisor ?? new WorkerSupervisor(this.piClient, {
      mode: options.isolation ?? DEFAULT_ISOLATION,
      runTimeoutMs: this.runTimeoutMs,
      dataDir: deps.sandbox.getBaseDir(),
    });
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
  // Project management
  // -----------------------------------------------------------------------

  listProjects(): ProjectData[] {
    return [...this.projects.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getProject(slug: string): ProjectData | null {
    return this.projects.get(slug) ?? null;
  }

  createProject(input: CreateProjectInput): ProjectData {
    const project = this.projectFileStore.createProject(input);
    this.projects.set(project.slug, project);
    this.recordEvent(SWARM_EVENT_TYPE.PROJECT_CREATED, { payload: { project } });
    this.persist();
    this.emit('state:changed');
    return project;
  }

  updateProject(slug: string, input: UpdateProjectInput): ProjectData | null {
    if (!this.projects.has(slug)) return null;
    const project = this.projectFileStore.updateProject(slug, input);
    if (!project) return null;
    this.projects.set(project.slug, project);
    this.recordEvent(SWARM_EVENT_TYPE.PROJECT_UPDATED, { payload: { project } });
    this.persist();
    this.emit('state:changed');
    return project;
  }

  deleteProject(slug: string): boolean {
    if (!this.projects.has(slug)) return false;
    this.projects.delete(slug);
    this.projectFileStore.deleteProject(slug);
    for (const task of this.tasks.values()) {
      if (!task.projectIds.includes(slug)) continue;
      task.options.projectIds = task.projectIds.filter((projectId) => projectId !== slug);
      this.markTaskDirty(task);
      this.recordEvent(SWARM_EVENT_TYPE.TASK_PROJECT_LINKED, {
        task,
        payload: { projectIds: task.projectIds },
      });
    }
    this.recordEvent(SWARM_EVENT_TYPE.PROJECT_DELETED, { payload: { slug } });
    this.persist();
    this.emit('state:changed');
    return true;
  }

  updateTaskProjects(taskId: string, projectIds: string[]): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} não encontrada`);
    task.options.projectIds = this.requireProjectIds(projectIds);
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_PROJECT_LINKED, {
      task,
      payload: { projectIds: task.projectIds },
    });
    this.persist();
    this.emit('state:changed');
    return task;
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
    projectIds?: string[];
    execute?: boolean;
  }): Task {
    const assignedTo = input.execute ? MANAGER_AGENT : INBOX_AGENT;
    const task = this.createRootTask(
      input.title ?? deriveProvisionalTitle(input.message),
      assignedTo,
      input.runtimeConfig,
      input.attachmentPaths ?? [],
      input.message,
      input.projectIds,
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
    projectIds: string[] = [],
  ): Task {
    if (agentName !== INBOX_AGENT) this.assertAgentExists(agentName);
    const taskId = this.nextId('task');
    const attachments = this.copyTaskAttachments(taskId, attachmentPaths);
    const normalizedConfig = normalizeRuntimeConfig(runtimeConfig, this.allowedModels);
    const linkedProjectIds = this.requireProjectIds(projectIds);
    const task = new TaskImpl(
      { taskId, title, assignedTo: agentName, depth: 0, runtimeConfig: normalizedConfig, projectIds: linkedProjectIds },
      false,
      attachments,
    );
    task.appendChat('user', 'text', message ?? title, normalizedConfig, attachments);

    this.tasks.set(task.taskId, task);
    this.rootTaskIds.push(task.taskId);
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_CREATED, { task, payload: { task: task.serialize() } });
    if (task.projectIds.length > 0) {
      this.recordEvent(SWARM_EVENT_TYPE.TASK_PROJECT_LINKED, {
        task,
        payload: { projectIds: task.projectIds },
      });
    }
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

    const wasActive = this.runningTaskIds.has(taskId) || this.queuedTaskIds.has(taskId) || this.workerPool.has(taskId);
    // dequeue aborts any in-flight Pi run; the runTask result-guard discards
    // late output, so moving to the Inbox truly pauses execution.
    this.dequeue(taskId);
    task.options.assignedTo = target === 'inbox' ? INBOX_AGENT : MANAGER_AGENT;
    task.setStatus(TASK_STATUS.PENDING, { force: true });
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
    // Cascade cancel: aborting the parent aborts the whole active family so no
    // child worker is left running (orphan-run). Reuses dequeue→cancelActiveRun.
    const familyIds = this.collectFamilyIds(task);
    for (const id of familyIds) {
      const member = this.tasks.get(id);
      if (!member || isTerminalTaskStatus(member.status)) continue;
      this.dequeue(id);
      member.setStatus(TASK_STATUS.CANCELLED, { force: true, failureReason: 'cancelled_by_user', waitingReason: undefined });
      member.activeRunId = undefined;
      member.metrics.finishedAt = new Date().toISOString();
      this.markTaskDirty(member);
      if (id !== taskId) {
        this.recordEvent(SWARM_EVENT_TYPE.TASK_CANCELLED, {
          task: member,
          payload: { cancelledByTaskId: taskId, allowDuplicateTerminalEvent: true },
        });
      }
    }
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
    this.mergeIntegrationToDefault(task);
    task.setStatus(TASK_STATUS.COMPLETED, { force: true, waitingReason: undefined });
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
   * Manual retry (F8.T2): re-open a FAILED/CANCELLED/REVIEW task and re-run it.
   * Clears the failure reason and re-schedules. An explicit user action, so the
   * terminal→PENDING transition is forced.
   */
  retryTask(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} não encontrada`);
    if (!isTerminalTaskStatus(task.status) && task.status !== TASK_STATUS.REVIEW) {
      throw new Error('Apenas tasks finalizadas ou em revisão podem ser reexecutadas');
    }
    this.dequeue(taskId);
    if (task.assignedTo === INBOX_AGENT && !task.options.parentId) task.options.assignedTo = MANAGER_AGENT;
    task.setStatus(TASK_STATUS.PENDING, { force: true, failureReason: undefined, waitingReason: undefined });
    task.activeRunId = undefined;
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_RETRIED, { task, payload: { manual: true } });
    this.recordEvent(SWARM_EVENT_TYPE.TASK_RESUMED, { task });
    this.persist();
    this.emit('state:changed');
    this.scheduleTask(taskId);
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
    // Resume from WAITING(human|validation) — or a SUSPENDED card revived by a
    // late human answer (§10.6) — on a direct response.
    if (
      (task.status === TASK_STATUS.WAITING &&
        (task.waitingReason === 'human' || task.waitingReason === 'validation')) ||
      task.status === TASK_STATUS.SUSPENDED
    ) {
      this.clearHumanDeadline(taskId);
      task.setStatus(TASK_STATUS.PENDING, { force: true, waitingReason: undefined, failureReason: undefined });
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
      // Reopen from a terminal/REVIEW state is an explicit user override.
      task.setStatus(TASK_STATUS.PENDING, { force: true });
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

  /**
   * Catch-up cursor (F7.T5): events with seq > sinceSeq, optionally scoped to a
   * task (and its direct children). The in-memory `events` mirror the durable
   * EventStore (rebuilt on load), so this works across server restarts.
   */
  getEventsSince(sinceSeq: number, taskId?: string): SwarmEvent[] {
    return this.events.filter(
      (e) => e.seq > sinceSeq && (!taskId || e.taskId === taskId || e.parentId === taskId),
    );
  }

  /** Highest event seq emitted so far (the live cursor head). */
  get latestSeq(): number {
    return this.nextSeq - 1;
  }

  /**
   * Append a human attachment to a task mid-conversation (F6.T4). Writes the
   * bytes into the task's attachments/ dir, appends a user chat message carrying
   * the AttachmentRef and emits MESSAGE_APPENDED so it is durable/replayable and
   * the agent can read it on its next run. Dep-free (no multipart): the byte
   * payload arrives as a Buffer decoded at the route boundary.
   */
  appendUserAttachment(taskId: string, fileName: string, data: Buffer, message?: string): AttachmentRef {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} não encontrada`);
    const ref = this.taskFileStore.writeAttachment(taskId, fileName, data);
    const text = message?.trim() || `Anexo: ${ref.originalName}`;
    task.appendChat('user', 'text', text, undefined, [ref]);
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.MESSAGE_APPENDED, {
      task,
      messages: [task.chat[task.chat.length - 1]],
    });
    // An attachment on a card awaiting the human is itself an answer → resume.
    if (
      (task.status === TASK_STATUS.WAITING &&
        (task.waitingReason === 'human' || task.waitingReason === 'validation')) ||
      task.status === TASK_STATUS.SUSPENDED
    ) {
      this.clearHumanDeadline(taskId);
      task.setStatus(TASK_STATUS.PENDING, { force: true, waitingReason: undefined, failureReason: undefined });
      task.activeRunId = undefined;
      this.recordEvent(SWARM_EVENT_TYPE.TASK_RESUMED, { task });
      this.persist();
      this.emit('state:changed');
      this.scheduleTask(taskId);
      return ref;
    }
    this.persist();
    this.emit('state:changed');
    return ref;
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
        const member = this.tasks.get(id);
        if (member) this.cleanupTaskGit(member);
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
        projectIds: parentTask.projectIds,
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

  requestSubtaskValidation(parentTask: Task, subtaskId: string, message: string): Task {
    const subtask = this.requireDirectSubtask(parentTask, subtaskId);
    const text = message.trim();
    if (!text) throw new Error('Mensagem de validação vazia');

    this.dequeue(subtask.taskId);
    this.appendCreatorMessage(subtask, text);
    // Parent-driven re-validation may reopen an already-completed subtask.
    subtask.setStatus(TASK_STATUS.WAITING, { force: true, waitingReason: 'validation', failureReason: undefined });
    subtask.activeRunId = undefined;
    this.reopenWaitGroupsForSubtask(parentTask, subtask.taskId);
    this.markTaskDirty(parentTask);
    this.markTaskDirty(subtask);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_WAITING, {
      task: subtask,
      payload: { waitingReason: 'validation', validatorTaskId: parentTask.taskId },
    });
    this.scheduler.rebuildWaitIndex(this.tasks);
    this.persist();
    this.emit('state:changed');
    return subtask;
  }

  continueSubtask(parentTask: Task, subtaskId: string, message: string): Task {
    const subtask = this.requireDirectSubtask(parentTask, subtaskId);
    if (subtask.status !== TASK_STATUS.WAITING || subtask.waitingReason !== 'validation') {
      throw new Error(`Subtask ${subtaskId} não está aguardando validação`);
    }
    const text = message.trim();
    if (!text) throw new Error('Mensagem de continuação vazia');

    this.appendCreatorMessage(subtask, text);
    subtask.setStatus(TASK_STATUS.PENDING, { waitingReason: undefined });
    subtask.activeRunId = undefined;
    this.markTaskDirty(subtask);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_RESUMED, { task: subtask });
    this.persist();
    this.emit('state:changed');
    this.scheduleTask(subtask.taskId);
    return subtask;
  }

  acceptSubtask(parentTask: Task, subtaskId: string, message?: string): Task {
    const subtask = this.requireDirectSubtask(parentTask, subtaskId);
    if (subtask.status === TASK_STATUS.COMPLETED) return subtask;

    this.dequeue(subtask.taskId);
    this.appendCreatorMessage(subtask, message);
    subtask.setStatus(TASK_STATUS.COMPLETED, { force: true, waitingReason: undefined, failureReason: undefined });
    subtask.activeRunId = undefined;
    subtask.metrics.finishedAt = new Date().toISOString();
    this.markTaskDirty(subtask);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_COMPLETED, {
      task: subtask,
      messages: subtask.resultMessages,
      payload: {
        acceptedByTaskId: parentTask.taskId,
        allowDuplicateTerminalEvent: true,
      },
    });
    this.scheduler.rebuildWaitIndex(this.tasks);
    this.persist();
    this.emit('state:changed');
    return subtask;
  }

  cancelSubtask(parentTask: Task, subtaskId: string, message?: string): Task {
    const subtask = this.requireDirectSubtask(parentTask, subtaskId);
    if (isTerminalTaskStatus(subtask.status)) return subtask;
    this.dequeue(subtask.taskId);
    this.appendCreatorMessage(subtask, message);
    subtask.setStatus(TASK_STATUS.CANCELLED, { force: true, waitingReason: undefined, failureReason: 'cancelled_by_user' });
    subtask.activeRunId = undefined;
    subtask.metrics.finishedAt = new Date().toISOString();
    this.markTaskDirty(subtask);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_CANCELLED, {
      task: subtask,
      payload: {
        cancelledByTaskId: parentTask.taskId,
        allowDuplicateTerminalEvent: true,
      },
    });
    this.scheduler.rebuildWaitIndex(this.tasks);
    this.persist();
    this.emit('state:changed');
    return subtask;
  }

  isOrchestrator(task: Task): boolean {
    return task.depth < MAX_TASK_DEPTH && task.subtaskIds.length < MAX_SUBTASKS_PER_TASK;
  }

  getSubtasks(task: Task): Task[] {
    return task.subtaskIds
      .map((tid) => this.tasks.get(tid))
      .filter((subtask): subtask is Task => Boolean(subtask));
  }

  private requireDirectSubtask(parentTask: Task, subtaskId: string): Task {
    if (!parentTask.subtaskIds.includes(subtaskId)) {
      throw new Error(`Task ${subtaskId} não é subtask direta de ${parentTask.taskId}`);
    }
    const subtask = this.tasks.get(subtaskId);
    if (!subtask) throw new Error(`Subtask ${subtaskId} não encontrada`);
    return subtask;
  }

  private appendCreatorMessage(task: Task, message?: string): void {
    const text = message?.trim();
    if (!text) return;
    task.appendChat('user', 'text', text);
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.MESSAGE_APPENDED, {
      task,
      messages: [task.chat[task.chat.length - 1]],
    });
  }

  /**
   * Append a system-injected user instruction (retry/feedback/DoD) AND emit
   * MESSAGE_APPENDED so a replay-from-events-only run reconstructs it faithfully
   * (constraint #10 — no chat line bypasses the ledger).
   */
  private appendUserInstruction(task: Task, text: string, runtimeConfig?: RuntimeConfig): void {
    task.appendChat('user', 'text', text, runtimeConfig);
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.MESSAGE_APPENDED, {
      task,
      messages: [task.chat[task.chat.length - 1]],
    });
  }

  private reopenWaitGroupsForSubtask(parentTask: Task, subtaskId: string): void {
    for (const run of parentTask.runs) {
      for (const group of run.waitGroups) {
        if (group.taskIds.includes(subtaskId)) {
          group.status = WAIT_GROUP_STATUS.WAITING as 'WAITING';
        }
      }
    }
  }

  /** Operational snapshot for /health (F7.T7) — observability for the operator. */
  getOperationalStats(): {
    running: number;
    queued: number;
    queueDepth: number;
    activeRuns: number;
    humanWaits: number;
    waiting: number;
    suspended: number;
  } {
    let waiting = 0;
    let suspended = 0;
    let activeRuns = 0;
    for (const task of this.tasks.values()) {
      if (task.status === TASK_STATUS.WAITING) waiting++;
      if (task.status === TASK_STATUS.SUSPENDED) suspended++;
      if (task.activeRunId) activeRuns++;
    }
    return {
      running: this.runningTaskIds.size,
      queued: this.queuedTaskIds.size + this.workerPool.pendingCount,
      queueDepth: this.taskQueue.length + this.workerPool.pendingCount,
      activeRuns,
      humanWaits: this.humanDeadlines.size,
      waiting,
      suspended,
    };
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

  getTaskWorkspaceDir(taskId: string): string {
    return this.taskFileStore.getTaskWorkspaceDir(taskId);
  }

  private prepareProjectWorktrees(task: Task, runId: string): void {
    for (const projectId of task.projectIds) {
      const project = this.projects.get(projectId);
      if (!project?.gitUrl) continue;
      const mirrorDir = this.sandbox.resolveSubpath('.swarm', 'projects', project.slug, 'repo.git');
      const worktreeDir = this.taskFileStore.getTaskProjectWorkspaceDir(task.taskId, project.slug);
      const branch = this.gitBranchForTask(task);
      this.gitRepo.ensureMirror(project.gitUrl, mirrorDir);
      const result = this.gitRepo.addWorktree(mirrorDir, worktreeDir, branch, project.defaultBranch);
      if (!result.created) continue;
      this.recordEvent(SWARM_EVENT_TYPE.WORKTREE_CREATED, {
        task,
        runId,
        payload: {
          slug: project.slug,
          branch,
          baseSha: result.baseSha,
          path: this.sandbox.relativeTo(worktreeDir),
        },
      });
    }
  }

  /**
   * Imagem do run: constrói (ou reaproveita do cache) a imagem do devcontainer
   * do projeto (F3.2). Só em modo docker; sem devcontainer usa a workerImage
   * padrão do supervisor (retorna undefined). Roda síncrono dentro do run slot,
   * após os worktrees já existirem. ponytail: build síncrono grande pode comer o
   * timeout do run; upgrade = build assíncrono com task em QUEUED, não feito aqui.
   */
  private resolveRunImage(task: Task): string | undefined {
    if (this.workerSupervisor.isolationMode !== 'docker') return undefined;
    for (const projectId of task.projectIds) {
      const project = this.projects.get(projectId);
      if (!project?.devcontainerPath) continue;
      // ponytail: primeiro projeto com devcontainer vence; multi-devcontainer por
      // task fica para depois (um container por run neste corte).
      const worktreeDir = this.taskFileStore.getTaskProjectWorkspaceDir(task.taskId, project.slug);
      const configPath = join(worktreeDir, project.devcontainerPath);
      if (!existsSync(configPath)) continue;
      return resolveDevcontainerImage({ workspaceFolder: worktreeDir, configPath, slug: project.slug });
    }
    return undefined;
  }

  private commitProjectWorktrees(task: Task, runId: string): void {
    for (const projectId of task.projectIds) {
      const project = this.projects.get(projectId);
      if (!project?.gitUrl) continue;
      const worktreeDir = this.taskFileStore.getTaskProjectWorkspaceDir(task.taskId, project.slug);
      if (!existsSync(worktreeDir) || !this.gitRepo.hasChanges(worktreeDir)) continue;
      const sha = this.gitRepo.commitAll(worktreeDir, `kca: ${task.taskId}`);
      this.recordEvent(SWARM_EVENT_TYPE.COMMIT_CREATED, {
        task,
        runId,
        payload: {
          slug: project.slug,
          branch: this.gitBranchForTask(task),
          sha,
        },
      });
    }
  }

  private reconcileSubtaskBranches(
    task: Task,
    run: TaskRun,
    messages: AgentOutputMessage[],
    triggerEvents: SwarmEvent[],
  ): boolean {
    const subtasks = this.getSubtasks(task)
      .filter((subtask) => subtask.status === TASK_STATUS.COMPLETED)
      .sort((a, b) => a.taskId.localeCompare(b.taskId));
    if (subtasks.length === 0) return true;

    for (const projectId of task.projectIds) {
      const project = this.projects.get(projectId);
      if (!project?.gitUrl) continue;
      const integrationDir = this.taskFileStore.getTaskProjectWorkspaceDir(task.taskId, project.slug);
      if (!existsSync(integrationDir)) continue;
      const into = this.gitBranchForTask(task);
      const mirrorDir = this.sandbox.resolveSubpath('.swarm', 'projects', project.slug, 'repo.git');

      for (const subtask of subtasks) {
        if (!subtask.projectIds.includes(project.slug)) continue;
        const from = this.gitBranchForTask(subtask);
        try {
          const fromSha = this.latestCommitSha(subtask.taskId, project.slug) ?? this.gitRepo.revParse(mirrorDir, from);
          const sha = this.gitRepo.merge(integrationDir, fromSha);
          this.recordEvent(SWARM_EVENT_TYPE.BRANCH_MERGED, {
            task,
            runId: run.runId,
            payload: { slug: project.slug, from, into, sha },
          });
        } catch (error) {
          if (!(error instanceof GitConflictError)) throw error;
          const resolverAgent = this.agents.has('Engineer') ? 'Engineer' : task.assignedTo;
          const resolver = this.spawnSubtask(
            task,
            resolverAgent,
            `Resolver conflito ${project.slug}`,
            `Resolva o conflito de merge entre ${from} e ${into} no projeto ${project.slug}.`,
          );
          this.recordEvent(SWARM_EVENT_TYPE.MERGE_BLOCKED, {
            task,
            runId: run.runId,
            payload: { slug: project.slug, from, into, reason: 'conflict', resolverTaskId: resolver.taskId },
          });
          this.coerceToWait(task, run, messages, [resolver.taskId], triggerEvents, 'merge conflict');
          return false;
        }
      }
    }
    return true;
  }

  private mergeIntegrationToDefault(task: Task): void {
    for (const projectId of task.projectIds) {
      const project = this.projects.get(projectId);
      if (!project?.gitUrl) continue;
      if (this.projectMergeLocks.has(project.slug)) {
        this.recordEvent(SWARM_EVENT_TYPE.MERGE_BLOCKED, {
          task,
          payload: { slug: project.slug, reason: 'lock' },
        });
        throw new Error(`Merge em andamento para projeto ${project.slug}`);
      }

      this.projectMergeLocks.add(project.slug);
      const mirrorDir = this.sandbox.resolveSubpath('.swarm', 'projects', project.slug, 'repo.git');
      const integrationDir = this.taskFileStore.getTaskProjectWorkspaceDir(task.taskId, project.slug);
      const mergeDir = this.sandbox.resolveSubpath('.swarm', 'projects', project.slug, 'merge-worktree');
      try {
        if (!existsSync(integrationDir)) continue;
        this.gitRepo.removeWorktree(mirrorDir, mergeDir);
        this.gitRepo.addWorktree(mirrorDir, mergeDir, project.defaultBranch, project.defaultBranch);
        const fromSha = this.gitRepo.head(integrationDir);
        const sha = this.gitRepo.merge(mergeDir, fromSha);
        this.recordEvent(SWARM_EVENT_TYPE.BRANCH_MERGED, {
          task,
          payload: { slug: project.slug, from: this.gitBranchForTask(task), into: project.defaultBranch, sha },
        });
      } catch (error) {
        if (error instanceof GitConflictError) {
          this.recordEvent(SWARM_EVENT_TYPE.MERGE_BLOCKED, {
            task,
            payload: { slug: project.slug, from: this.gitBranchForTask(task), into: project.defaultBranch, reason: 'conflict' },
          });
        }
        throw error;
      } finally {
        this.gitRepo.removeWorktree(mirrorDir, mergeDir);
        this.projectMergeLocks.delete(project.slug);
      }
    }
  }

  private cleanupTaskGit(task: Task): void {
    for (const projectId of task.projectIds) {
      const project = this.projects.get(projectId);
      if (!project?.gitUrl) continue;
      const mirrorDir = this.sandbox.resolveSubpath('.swarm', 'projects', project.slug, 'repo.git');
      const worktreeDir = this.taskFileStore.getTaskProjectWorkspaceDir(task.taskId, project.slug);
      this.gitRepo.removeWorktree(mirrorDir, worktreeDir);
      this.gitRepo.deleteBranch(mirrorDir, this.gitBranchForTask(task));
    }
  }

  private gitBranchForTask(task: Task): string {
    const rootTaskId = this.findRootTaskId(task);
    return task.options.parentId ? `kca/${rootTaskId}/${task.taskId}` : `kca/${task.taskId}/integration`;
  }

  private latestCommitSha(taskId: string, slug: string): string | undefined {
    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const event = this.events[i];
      if (
        event?.type === SWARM_EVENT_TYPE.COMMIT_CREATED &&
        event.taskId === taskId &&
        event.payload?.slug === slug &&
        typeof event.payload.sha === 'string'
      ) {
        return event.payload.sha;
      }
    }
    return undefined;
  }

  private findRootTaskId(task: Task): string {
    let current = task;
    while (current.options.parentId) {
      const parent = this.tasks.get(current.options.parentId);
      if (!parent) break;
      current = parent;
    }
    return current.taskId;
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
    if (this.workerPool.has(taskId)) {
      if (task.status === TASK_STATUS.PENDING || task.status === TASK_STATUS.WAITING) {
        setTimeout(() => this.scheduleTask(taskId, [], 0), Math.max(delayMs, 10));
      }
      return;
    }
    if (!this.queuedTaskIds.has(taskId)) {
      this.queuedTaskIds.add(taskId);
      this.taskQueue.push(taskId);
      if (task.status !== TASK_STATUS.QUEUED) {
        task.setStatus(TASK_STATUS.QUEUED);
        this.markTaskDirty(task);
        this.recordEvent(SWARM_EVENT_TYPE.TASK_QUEUED, { task });
        this.persist();
      }
    }

    if (delayMs > 0) setTimeout(() => this.pumpQueue(), delayMs);
    else setTimeout(() => this.pumpQueue(), 0);
  }

  async runTask(taskId: string, triggerEvents: SwarmEvent[] = [], poolSignal?: AbortSignal): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || isTerminalTaskStatus(task.status)) return;
    if (this.runningTaskIds.has(taskId)) return;

    const agent = this.agents.get(task.options.assignedTo);
    if (!agent) throw new Error(`Agente ${task.options.assignedTo} não encontrado`);

    const startedAt = new Date().toISOString();
    const run = this.getOrCreateExecutionRun(task, startedAt);
    this.runningTaskIds.add(taskId);
    task.setStatus(TASK_STATUS.RUNNING, { force: true, waitingReason: undefined });
    task.metrics.startedAt ??= startedAt;
    run.status = 'RUNNING';
    run.startedAt = startedAt;
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_STARTED, { task, runId: run.runId });
    this.recordEvent(SWARM_EVENT_TYPE.RUN_STARTED, { task, runId: run.runId });
    this.persist();

    const controller = new AbortController();
    this.runAbortControllers.set(taskId, controller);
    const abortFromPool = (): void => controller.abort();
    if (poolSignal?.aborted) controller.abort();
    else poolSignal?.addEventListener('abort', abortFromPool, { once: true });
    // Subtasks created during this run mean the parent now depends on them and
    // must wait + re-consolidate from their real results (see applyDecision).
    const subtasksBefore = task.subtaskIds.length;
    try {
      this.taskFileStore.ensureTaskDir(task.taskId);
      this.prepareProjectWorktrees(task, run.runId);
      // Imagem do run: devcontainer do projeto (F3.2) construído/cacheado após os
      // worktrees existirem; undefined => workerImage padrão do supervisor.
      const runImage = this.resolveRunImage(task);
      this.ensureScopeSpec(task);
      const continuity = {
        scopeSpec: this.taskFileStore.loadScopeSpec(task.taskId),
        progressLog: this.taskFileStore.loadProgressLog(task.taskId),
        envResume: this.taskFileStore.loadEnvResume(task.taskId),
      };
      const result = await this.workerSupervisor.runAgent(agent, task, this, triggerEvents, controller.signal, continuity, runImage);
      // If the run was cancelled or the task was moved/superseded mid-flight,
      // discard the result so no phantom output is applied after a pause.
      if (controller.signal.aborted || task.activeRunId !== run.runId || task.status !== TASK_STATUS.RUNNING) {
        return;
      }
      const finishedAt = new Date().toISOString();
      task.metrics = addSessionStats(task.metrics, result.stats, startedAt, finishedAt);
      this.budget.trackUsage(task.taskId, result.stats.tokens?.input ?? 0, result.stats.tokens?.output ?? 0, result.stats.cost ?? 0);
      this.assertWithinBudget();
      this.warnIfApproachingCeiling(task);
      this.assertWithinCardCeiling(task);
      let output = result.output;
      let decision: AgentDecision;
      try {
        decision = parseDecision(output);
      } catch (error) {
        if (!(error instanceof AgentOutputInvalidError)) throw error;
        this.recordInvalidAgentOutput(task, run, error);
        const repairStartedAt = new Date().toISOString();
        const repaired = await this.workerSupervisor.repairInvalidOutput(
          agent,
          task,
          this,
          error.message,
          error.rawOutput,
          controller.signal,
          runImage,
        );
        if (controller.signal.aborted || task.activeRunId !== run.runId || task.status !== TASK_STATUS.RUNNING) {
          return;
        }
        const repairFinishedAt = new Date().toISOString();
        task.metrics = addSessionStats(task.metrics, repaired.stats, repairStartedAt, repairFinishedAt);
        this.budget.trackUsage(
          task.taskId,
          repaired.stats.tokens?.input ?? 0,
          repaired.stats.tokens?.output ?? 0,
          repaired.stats.cost ?? 0,
        );
        this.assertWithinBudget();
        this.assertWithinCardCeiling(task);
        output = repaired.output;
        decision = parseDecision(output);
      }
      // Convergence monitor: break stagnation / endless-progression before applying.
      const stagnationReason = this.checkForStagnation(task, output);
      if (stagnationReason === 'stagnation') {
        this.failTask(task, run, 'Estagnação detectada: outputs muito similares entre epochs', 'stagnation');
        this.persist();
        return;
      }
      if (stagnationReason === 'max_epochs') {
        this.failTask(task, run, 'Máximo de epochs sem completar atingido', 'attempts');
        this.persist();
        return;
      }
      const isManagerRoot = !task.options.parentId && task.options.assignedTo === MANAGER_AGENT;
      if (decision.status === 'completed' && !isManagerRoot) this.commitProjectWorktrees(task, run.runId);
      task.technicalRetryCount = 0;
      this.applyDecision(task, run, decision, triggerEvents, task.subtaskIds.slice(subtasksBefore));
    } catch (error) {
      // A cancelled run (pause/move/cancel) must not be retried or failed.
      if (error instanceof RunCancelledError || controller.signal.aborted || task.activeRunId !== run.runId) {
        return;
      }
      this.handleRunFailure(task, run, error, triggerEvents, startedAt, task.subtaskIds.slice(subtasksBefore));
    } finally {
      poolSignal?.removeEventListener('abort', abortFromPool);
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
      projectIds: task.projectIds,
      status: task.status,
      waitingReason: task.waitingReason,
      failureReason: task.failureReason,
      evaluationVerdict: task.evaluationVerdict,
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
      runTimeoutMs: this.runTimeoutMs,
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
          `- ${st.taskId} ${st.options.title} (${st.options.assignedTo}) [` +
          `${st.waitingReason ? `${st.status}/${st.waitingReason}` : st.status}]: ` +
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
      waitingReason: md.waitingReason,
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
    // Agent default vem dos settings (options.defaultAgent), sobrescrito por
    // config do agente e por override da task.
    return mergeRuntimeConfig(
      { agent: this.options.defaultAgent },
      agent?.runtimeConfig,
      task.options.runtimeConfig,
    );
  }

  /** Aplica o agent default global em runtime (settings PATCH). */
  setDefaultAgent(agent: AgentName): void {
    this.options.defaultAgent = agent;
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  persist(): void {
    this.flushDirtyTasks();
    // Events are appended incrementally to events.jsonl (eventStore), so the
    // snapshot only carries tasks + roots + counters — no O(events) rewrite.
    this.snapshotStore.saveSnapshot(this.tasks, this.rootTaskIds, this.nextSeq, this.projects.values());
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

  updateArtifactContent(taskId: string, fileName: string, content: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} não encontrada`);

    const safeName = basename(fileName);
    const artifact = task.artifacts.find((a) => basename(a.path) === safeName);
    if (!artifact) throw new Error(`Artefato ${safeName} não encontrado`);

    artifact.path = this.taskFileStore.writeArtifactFile(taskId, safeName, content);
    artifact.sizeBytes = Buffer.byteLength(content, 'utf8');
    this.taskFileStore.saveArtifacts(taskId, task.artifacts);
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_UPDATED, {
      task,
      payload: { artifactPath: artifact.path, sizeBytes: artifact.sizeBytes },
    });
    this.persist();
    this.emit('state:changed');
    return task;
  }

  /**
   * Agent tools that mutate orchestration state (create_subtask, create_artifact).
   * Returned as Pi-agnostic specs; the runner adapts them to Pi SDK tools.
   */
  buildAgentTools(task: Task, includeDelegation: boolean): CustomToolSpec[] {
    const delegatable = this.getAgentNames().filter(
      (name) => name !== MANAGER_AGENT && name !== INBOX_AGENT,
    );
    // post_message and create_artifact are available to EVERY agent (feedback and
    // file output are not orchestration). create_subtask is added only for tasks
    // that still have delegation budget.
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
          const text = String(params.text);
          // Idempotent on crash-resume: skip re-posting an identical line that is
          // already the latest assistant message (the durable chat is the guard).
          const last = task.chat[task.chat.length - 1];
          if (last?.role === 'assistant' && last.text === text) return 'ok';
          this.postAgentMessage(task, text);
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
            agent: { type: 'string', enum: Object.values(AGENT_NAME) },
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
            // Subtask herda o agent do pai, salvo override explicito.
            agent: (params.agent as AgentName | undefined) ?? task.options.runtimeConfig?.agent,
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
    const directSubtaskIds = this.getSubtasks(task).map((subtask) => subtask.taskId);
    if (directSubtaskIds.length > 0) {
      tools.push(
        {
          name: 'request_subtask_validation',
          description:
            'Coloca uma subtask direta em WAITING/validation e registra nela o que está inválido. Use isto em vez de criar subtask RETRY.',
          parameters: {
            type: 'object',
            properties: {
              taskId: { type: 'string', enum: directSubtaskIds, description: 'TaskId da subtask direta.' },
              message: { type: 'string', description: 'Feedback objetivo explicando o que não está válido.' },
            },
            required: ['taskId', 'message'],
            additionalProperties: false,
          },
          execute: async (params: Record<string, unknown>) => {
            const subtask = this.requestSubtaskValidation(task, String(params.taskId), String(params.message));
            return JSON.stringify(this.toMetadata(subtask));
          },
        },
        {
          name: 'continue_subtask',
          description:
            'Responde uma subtask em WAITING/validation e agenda a mesma taskId para continuar. Não cria retry.',
          parameters: {
            type: 'object',
            properties: {
              taskId: { type: 'string', enum: directSubtaskIds, description: 'TaskId da subtask direta.' },
              message: { type: 'string', description: 'Instrução objetiva para a subtask continuar.' },
            },
            required: ['taskId', 'message'],
            additionalProperties: false,
          },
          execute: async (params: Record<string, unknown>) => {
            const subtask = this.continueSubtask(task, String(params.taskId), String(params.message));
            return JSON.stringify(this.toMetadata(subtask));
          },
        },
        {
          name: 'accept_subtask',
          description:
            'Aceita a entrega atual de uma subtask direta e marca a própria subtask como COMPLETED.',
          parameters: {
            type: 'object',
            properties: {
              taskId: { type: 'string', enum: directSubtaskIds, description: 'TaskId da subtask direta.' },
              message: { type: 'string', description: 'Comentário opcional de aceite.' },
            },
            required: ['taskId'],
            additionalProperties: false,
          },
          execute: async (params: Record<string, unknown>) => {
            const message = typeof params.message === 'string' ? params.message : undefined;
            const subtask = this.acceptSubtask(task, String(params.taskId), message);
            return JSON.stringify(this.toMetadata(subtask));
          },
        },
        {
          name: 'cancel_subtask',
          description:
            'Cancela uma subtask direta após validação do criador.',
          parameters: {
            type: 'object',
            properties: {
              taskId: { type: 'string', enum: directSubtaskIds, description: 'TaskId da subtask direta.' },
              message: { type: 'string', description: 'Comentário opcional de cancelamento.' },
            },
            required: ['taskId'],
            additionalProperties: false,
          },
          execute: async (params: Record<string, unknown>) => {
            const message = typeof params.message === 'string' ? params.message : undefined;
            const subtask = this.cancelSubtask(task, String(params.taskId), message);
            return JSON.stringify(this.toMetadata(subtask));
          },
        },
      );
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
        // Park task in WAITING(human) + register a deadline for the timeout monitor.
        task.setStatus(TASK_STATUS.WAITING, { force: true, waitingReason: 'human' });
        this.registerHumanDeadline(task);
        this.markTaskDirty(task);
        this.recordEvent(SWARM_EVENT_TYPE.TASK_WAITING, {
          task,
          payload: { waitingReason: 'human', deadline: this.humanDeadlines.get(task.taskId) },
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
    for (const task of this.tasks.values()) {
      if (isTerminalTaskStatus(task.status)) continue;
      if (task.status !== TASK_STATUS.RUNNING && task.status !== TASK_STATUS.QUEUED) continue;
      task.setStatus(TASK_STATUS.PENDING, { force: true });
      task.activeRunId = undefined;
      this.markTaskDirty(task);
    }
    if (this.deadlineTimer) {
      clearInterval(this.deadlineTimer);
      this.deadlineTimer = undefined;
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
    while (this.taskQueue.length > 0) {
      const taskId = this.taskQueue.shift();
      if (!taskId) continue;
      this.queuedTaskIds.delete(taskId);
      const task = this.tasks.get(taskId);
      if (!task || isTerminalTaskStatus(task.status) || this.runningTaskIds.has(taskId)) continue;
      const triggerEvents = this.takePendingTriggerEvents(taskId);
      this.workerPool.enqueue(taskId, (signal) => this.runTask(taskId, triggerEvents, signal), (error) => {
        if (error instanceof RunCancelledError) return;
        const failedTask = this.tasks.get(taskId);
        if (failedTask && !isTerminalTaskStatus(failedTask.status)) {
          const now = new Date().toISOString();
          const run = this.getActiveRun(failedTask) ?? this.getOrCreateExecutionRun(failedTask, now);
          this.handleRunFailure(failedTask, run, error, triggerEvents, now);
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
        this.failTask(task, run, 'Retry maximo atingido', 'attempts');
        this.persist();
        return;
      }

      const rc = normalizeRuntimeConfig({ model: decision.model, effort: decision.effort }, this.allowedModels);
      task.retryCount += 1;
      task.setStatus(TASK_STATUS.PENDING, { waitingReason: undefined });
      // Auto-escalate if agent didn't explicitly request a change
      const currentConfig = this.resolveRuntimeConfig(task, this.agents.get(task.options.assignedTo));
      const effectiveRc = rc ?? escalateConfig(currentConfig);
      task.options.runtimeConfig = { ...(task.options.runtimeConfig ?? {}), ...effectiveRc };
      this.appendUserInstruction(
        task,
        decision.instructions ?? 'Reexecute a task com a configuracao atualizada.',
        rc,
      );
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
      task.setStatus(TASK_STATUS.WAITING, { force: true, waitingReason: 'subtasks' });
      this.scheduler.rebuildWaitIndex(this.tasks);
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
        task.setStatus(TASK_STATUS.PENDING, { waitingReason: undefined });
        this.appendUserInstruction(
          task,
          'Voce e o ORQUESTRADOR. NAO faca o trabalho diretamente. ' +
          'Crie subtasks via create_subtask para cada parte do trabalho, delegue aos agentes especializados, ' +
          'e retorne status waiting com waitGroups. So responda completed depois de consolidar os resultados das subtasks.',
        );
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

    // Independent-evaluation gate (§8.2): a Manager root that produced work must
    // pass through segregated QA + Code Reviewer subtasks before it can reach
    // REVIEW. The first time we hit completion we spawn the evaluators and wait;
    // when they approve, completion proceeds. Disabled by default (andaime §1.2).
    if (
      isManagerRoot &&
      this.evaluationEnabled &&
      this.requiresEvaluation(task) &&
      !this.hasDoubleApproval(task) &&
      !this.hasPendingEvaluators(task)
    ) {
      this.spawnEvaluators(task, run, decision.messages, triggerEvents);
      return;
    }

    // Sanitize result messages: remove raw technical errors before showing to user
    const sanitizedMessages = sanitizeMessages(decision.messages);

    // Record an evaluator's verdict (QA / Code Reviewer subtask) for the gate.
    if (decision.verdict) task.evaluationVerdict = decision.verdict;

    this.markEventsProcessed(task, triggerEvents);
    task.resultMessages = task.appendAgentMessages(sanitizedMessages);
    if (isManagerRoot && !this.reconcileSubtaskBranches(task, run, sanitizedMessages, triggerEvents)) return;
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
      // Definition of Done (§11): gate the REVIEW handoff. If unmet, send back for
      // correction (bounded by retries) instead of declaring victory prematurely.
      const dod = this.checkDoD(task);
      if (!dod.passed && task.retryCount < MAX_TASK_RETRIES) {
        task.retryCount += 1;
        task.setStatus(TASK_STATUS.PENDING, { force: true, waitingReason: undefined });
        task.activeRunId = undefined;
        this.appendUserInstruction(
          task,
          `Definition of Done nao satisfeita: ${dod.failures.join('; ')}. Corrija e conclua novamente.`,
        );
        this.recordEvent(SWARM_EVENT_TYPE.TASK_RETRY_REQUESTED, {
          task,
          runId: run.runId,
          payload: { reason: `DoD: ${dod.failures.join('; ')}`, dod: true },
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
      if (!dod.passed) {
        task.setStatus(TASK_STATUS.FAILED, { force: true, failureReason: 'blocked', waitingReason: undefined });
        task.activeRunId = undefined;
        this.recordEvent(SWARM_EVENT_TYPE.TASK_FAILED, {
          task,
          runId: run.runId,
          messages: task.resultMessages,
          payload: { failureReason: 'blocked', reason: `DoD: ${dod.failures.join('; ')}`, dod: true },
        });
        this.persist();
        return;
      }
      this.recordClosingProgressEntry(task, dod);
      task.setStatus(TASK_STATUS.REVIEW, { force: true, waitingReason: undefined });
      this.recordEvent(SWARM_EVENT_TYPE.TASK_REVIEW, {
        task,
        runId: run.runId,
        messages: task.resultMessages,
      });
      if (this.shouldAutoMerge(task)) {
        this.mergeIntegrationToDefault(task);
        task.setStatus(TASK_STATUS.COMPLETED, { force: true, waitingReason: undefined });
        task.metrics.finishedAt = new Date().toISOString();
        this.recordEvent(SWARM_EVENT_TYPE.TASK_COMPLETED, {
          task,
          runId: run.runId,
          messages: task.resultMessages,
          payload: { autoMerge: true },
        });
      }
    } else {
      task.setStatus(TASK_STATUS.COMPLETED, { force: true, waitingReason: undefined });
      this.recordEvent(SWARM_EVENT_TYPE.TASK_COMPLETED, {
        task,
        runId: run.runId,
        messages: task.resultMessages,
      });
    }
    this.persist();
  }

  private shouldAutoMerge(task: Task): boolean {
    const projects = task.projectIds
      .map((projectId) => this.projects.get(projectId))
      .filter((project): project is ProjectData => Boolean(project?.gitUrl));
    return projects.length > 0 && projects.every((project) => project.autoMerge);
  }

  /**
   * Definition of Done (§11) gate, enforced before a Manager root reaches REVIEW.
   * Checks the cumulative, machine-verifiable criteria:
   *  - tree closure (no open subtasks),
   *  - independent evaluation (QA + Code Reviewer both approved, when required),
   *  - artifact integrity (every declared artifact exists on disk),
   *  - budget sanity,
   *  - memory consolidation (a closing progress-log entry).
   * The auto-seeded single scope-spec item is advisory (the agent rarely flips
   * it), so it never hard-blocks; an explicit multi-item scope-spec does.
   */
  private checkDoD(task: Task): { passed: boolean; failures: string[] } {
    const failures: string[] = [];

    // 1. Explicit (decomposed) scope-spec must be fully satisfied. A lone
    //    auto-seeded item stays advisory so it never blocks indefinitely.
    const scopeSpec = this.taskFileStore.loadScopeSpec(task.taskId);
    if (scopeSpec.length > 1) {
      const unsatisfied = scopeSpec.filter((item) => !item.satisfied);
      if (unsatisfied.length > 0) {
        failures.push(`Scope-spec incompleto: ${unsatisfied.length} itens nao atendidos`);
      }
      const unverifiable = scopeSpec.filter((item) => !item.verification?.trim());
      if (unverifiable.length > 0) {
        failures.push(`Scope-spec sem verificacao: ${unverifiable.length} itens`);
      }
      const unverified = scopeSpec.filter((item) => item.satisfied && item.verification?.trim() && !item.verifiedAt);
      if (unverified.length > 0) {
        failures.push(`Scope-spec sem evidencia: ${unverified.length} itens`);
      }
    }

    // 2. Tree closure — no open subtasks.
    const openSubtasks = task.subtaskIds.filter((id) => {
      const st = this.tasks.get(id);
      return st && !isTerminalTaskStatus(st.status);
    });
    if (openSubtasks.length > 0) {
      failures.push(`${openSubtasks.length} subtasks ainda abertas`);
    }

    // 3. Independent evaluation gate (when required by routing).
    if (this.evaluationEnabled && this.requiresEvaluation(task) && !this.hasDoubleApproval(task)) {
      failures.push('Avaliacao independente pendente (QA + Code Reviewer devem aprovar)');
    }

    // 4. Artifact integrity — every declared artifact exists on disk.
    for (const artifact of task.artifacts) {
      if (!existsSync(this.sandbox.resolve(artifact.path))) {
        failures.push(`Artefato declarado ausente em disco: ${artifact.path}`);
      }
    }

    // 5. Budget sanity.
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
    task.setStatus(TASK_STATUS.WAITING, { force: true, waitingReason: 'subtasks' });
    this.scheduler.rebuildWaitIndex(this.tasks);
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.TASK_WAITING, {
      task,
      runId: run.runId,
      payload: { waitGroups, coerced: true, ...(reason ? { reason } : {}) },
    });
    this.persist();
    this.resumeIfWaitSatisfied(task);
  }

  private recordInvalidAgentOutput(task: Task, run: TaskRun, error: AgentOutputInvalidError): void {
    this.recordEvent(SWARM_EVENT_TYPE.AGENT_OUTPUT_INVALID, {
      task,
      runId: run.runId,
      payload: { error: error.message, output: error.rawOutput.slice(0, 4000) },
    });
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
      this.recordInvalidAgentOutput(task, run, error as AgentOutputInvalidError);
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

    if (!isBudget && !isTimeout && task.technicalRetryCount < MAX_TECHNICAL_RETRIES) {
      task.technicalRetryCount += 1;
      // Auto-escalate model/effort on repeated technical failures (§3.2).
      if (task.technicalRetryCount >= 1) {
        const escalated = escalateConfig(this.resolveRuntimeConfig(task, this.agents.get(task.options.assignedTo)));
        task.options.runtimeConfig = { ...(task.options.runtimeConfig ?? {}), ...escalated };
      }
      task.setStatus(TASK_STATUS.PENDING, { force: true, waitingReason: undefined });
      this.appendUserInstruction(
        task,
        `A execucao anterior falhou: ${sanitizeErrorMessage(message)}. Reexecute mantendo o objetivo original. Retorne somente JSON puro valido no contrato especificado.`,
      );
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
    // Map the terminal reason per the canonical motivo→estado table (§3 PLAN).
    const failureReason = error instanceof CeilingExceededError || isBudget ? 'ceiling' : 'attempts';
    this.failTask(task, run, message, failureReason);
    this.persist();
  }

  private failTask(task: Task, run: TaskRun, reason: string, failureReason?: import('../domain/task.js').FailureReason): void {
    // Failure is a sink: force the transition (it must never itself throw).
    task.setStatus(TASK_STATUS.FAILED, { force: true, waitingReason: undefined, failureReason });
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
      payload: { error: reason, ...(failureReason ? { failureReason } : {}) },
    });
    this.scheduler.rebuildWaitIndex(this.tasks);
  }

  // -----------------------------------------------------------------------
  // Private: human-in-the-loop deadlines (§10.6)
  // -----------------------------------------------------------------------

  /** Register (or refresh) the SUSPENDED deadline for a WAITING(human) card. */
  private registerHumanDeadline(task: Task): void {
    const deadline = new Date(Date.now() + HUMAN_TIMEOUT_MS).toISOString();
    this.humanDeadlines.set(task.taskId, deadline);
    this.ensureDeadlineMonitor();
  }

  private clearHumanDeadline(taskId: string): void {
    this.humanDeadlines.delete(taskId);
  }

  private ensureDeadlineMonitor(): void {
    if (this.deadlineTimer || this.shuttingDown) return;
    this.deadlineTimer = setInterval(() => this.checkHumanDeadlines(), DEADLINE_SWEEP_MS);
    // Do not keep the event loop alive solely for the sweep (tests, CLI runs).
    this.deadlineTimer.unref?.();
  }

  /**
   * Sweep WAITING(human) cards whose deadline elapsed → SUSPENDED (§10.6).
   * Exposed for deterministic testing with an injected clock.
   */
  checkHumanDeadlines(now: number = Date.now()): void {
    let changed = false;
    for (const [taskId, deadline] of [...this.humanDeadlines.entries()]) {
      const task = this.tasks.get(taskId);
      if (!task || task.status !== TASK_STATUS.WAITING || task.waitingReason !== 'human') {
        this.humanDeadlines.delete(taskId);
        continue;
      }
      if (now >= new Date(deadline).getTime()) {
        task.setStatus(TASK_STATUS.SUSPENDED, { force: true, failureReason: 'human_timeout' });
        task.activeRunId = undefined;
        this.humanDeadlines.delete(taskId);
        this.markTaskDirty(task);
        this.recordEvent(SWARM_EVENT_TYPE.TASK_SUSPENDED, {
          task,
          payload: { reason: 'human_timeout' },
        });
        changed = true;
      }
    }
    if (this.humanDeadlines.size === 0 && this.deadlineTimer) {
      clearInterval(this.deadlineTimer);
      this.deadlineTimer = undefined;
    }
    if (changed) {
      this.scheduler.rebuildWaitIndex(this.tasks);
      this.persist();
      this.emit('state:changed');
    }
  }

  // -----------------------------------------------------------------------
  // Private: independent evaluation gate (§8.2/§11) — opt-in
  // -----------------------------------------------------------------------

  private static readonly MAX_EVAL_ROUNDS = 2;
  private evaluationRounds = new Map<string, number>();

  private evaluatorAgents(): string[] {
    return ['Code Reviewer', 'QA'].filter((name) => this.agents.has(name));
  }

  private requiresEvaluation(task: Task): boolean {
    return (
      !task.options.parentId &&
      task.options.assignedTo === MANAGER_AGENT &&
      (task.artifacts.length > 0 || task.subtaskIds.length > 0)
    );
  }

  private directEvaluators(task: Task): Task[] {
    const names = new Set(this.evaluatorAgents());
    return this.getSubtasks(task).filter((st) => names.has(st.options.assignedTo));
  }

  private hasPendingEvaluators(task: Task): boolean {
    return this.directEvaluators(task).some((st) => !isTerminalTaskStatus(st.status));
  }

  /** Both QA and Code Reviewer (their latest round) completed with verdict approved. */
  private hasDoubleApproval(task: Task): boolean {
    const evaluators = this.evaluatorAgents();
    if (evaluators.length === 0) return true; // none configured → no gate
    return evaluators.every((name) => {
      const subs = this.directEvaluators(task).filter((st) => st.options.assignedTo === name);
      const latest = subs[subs.length - 1];
      return Boolean(
        latest && latest.status === TASK_STATUS.COMPLETED && latest.evaluationVerdict === 'approved',
      );
    });
  }

  /**
   * Spawn segregated QA + Code Reviewer subtasks over the produced work and park
   * the Manager waiting on them. Bounded by MAX_EVAL_ROUNDS so cross-rejection
   * can't loop forever (it also surfaces to the convergence monitor via epochs).
   */
  private spawnEvaluators(
    task: Task,
    run: TaskRun,
    messages: AgentOutputMessage[],
    triggerEvents: SwarmEvent[],
  ): void {
    const round = (this.evaluationRounds.get(task.taskId) ?? 0) + 1;
    this.evaluationRounds.set(task.taskId, round);
    if (round > Orquestrator.MAX_EVAL_ROUNDS) {
      // Did not converge — fall through to the normal completion path (the gate
      // is satisfied by giving up, so the human reviewer decides).
      this.postAgentMessage(
        task,
        'Avaliacao independente nao convergiu apos os rounds configurados; encaminhando para revisao humana.',
      );
      this.evaluationRounds.delete(task.taskId);
      this.finishManagerReview(task, run, messages, triggerEvents);
      return;
    }
    const artifactList = task.artifacts.map((a) => `- ${a.path} (${a.fileType}): ${a.description}`).join('\n');
    const reviewContext = [
      'Avalie o trabalho entregue de forma CETICA e independente.',
      'Resultado do executor:',
      ...messages.map((m) => m.text ?? ''),
      artifactList ? `Artefatos:\n${artifactList}` : 'Sem artefatos.',
      'Retorne JSON com verdict ("approved" ou "rejected"), criteria[] e feedback acionavel.',
    ].join('\n');

    const created: string[] = [];
    for (const name of this.evaluatorAgents()) {
      const title = `${name}: revisao (round ${round})`;
      const sub = this.spawnSubtask(task, name, title, reviewContext);
      created.push(sub.taskId);
    }
    this.postAgentMessage(task, `Avaliacao independente: delegada a ${this.evaluatorAgents().join(' + ')}.`);
    this.coerceToWait(task, run, messages, created, triggerEvents, 'avaliacao independente');
  }

  /** Normal Manager → REVIEW handoff (shared by the gate's give-up path). */
  private finishManagerReview(
    task: Task,
    run: TaskRun,
    messages: AgentOutputMessage[],
    triggerEvents: SwarmEvent[],
  ): void {
    this.markEventsProcessed(task, triggerEvents);
    task.resultMessages = task.appendAgentMessages(sanitizeMessages(messages));
    this.completeActiveRun(task, run);
    this.markTaskDirty(task);
    this.recordEvent(SWARM_EVENT_TYPE.RUN_COMPLETED, { task, runId: run.runId, messages: task.resultMessages });
    const dod = this.checkDoD(task);
    this.recordClosingProgressEntry(task, dod);
    task.setStatus(TASK_STATUS.REVIEW, { force: true, waitingReason: undefined });
    this.recordEvent(SWARM_EVENT_TYPE.TASK_REVIEW, { task, runId: run.runId, messages: task.resultMessages });
    this.persist();
  }

  /** Memory consolidation (§11): write a closing entry to the progress-log. */
  private recordClosingProgressEntry(task: Task, dod: { passed: boolean; failures: string[] }): void {
    const summary = task.resultMessages.map((m) => m.text ?? '').join(' ').slice(0, 500);
    this.taskFileStore.appendProgressLog(task.taskId, {
      ts: new Date().toISOString(),
      epoch: task.runs.length,
      action: 'closing',
      detail: `DoD=${dod.passed ? 'ok' : dod.failures.join('; ')}; resumo=${summary}`,
    });
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
      // Immutable governance snapshot for this run (§1.5).
      governance: { ...this.governance },
      idempotencyKeys: [],
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
    // Epoch boundary (parked waiting) → heartbeat with accumulated metrics.
    this.emitHeartbeat(task, run);
  }

  private completeActiveRun(task: Task, run: TaskRun): void {
    run.status = 'COMPLETED';
    run.completedAt = new Date().toISOString();
    run.checkpointSeq = this.nextSeq - 1; // last event seq
    for (const group of run.waitGroups) group.status = WAIT_GROUP_STATUS.PROCESSED;
    task.activeRunId = undefined;
    this.emitHeartbeat(task, run);
    this.scheduler.rebuildWaitIndex(this.tasks);
  }

  /**
   * Heartbeat between epochs (§3.6): publishes accumulated consumption metrics
   * and the epoch checkpoint seq so the UI/telemetry stays observable and a
   * restart can reason about the last valid checkpoint.
   */
  private emitHeartbeat(task: Task, run: TaskRun): void {
    run.checkpointSeq = run.checkpointSeq ?? this.nextSeq - 1;
    this.recordEvent(SWARM_EVENT_TYPE.HEARTBEAT, {
      task,
      runId: run.runId,
      payload: {
        epoch: run.epoch,
        checkpointSeq: run.checkpointSeq,
        tokens: task.metrics.tokens,
        cost: task.metrics.cost,
        durationMs: task.metrics.durationMs,
      },
    });
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

    this.loadProjectProjection(snapshot?.projects);
    this.applyTaskProjectLinkEvents();
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

  private normalizeProjectIds(projectIds: string[]): string[] {
    return [...new Set(projectIds.map((projectId) => projectId.trim()).filter(Boolean))];
  }

  private requireProjectIds(projectIds: string[]): string[] {
    const normalized = this.normalizeProjectIds(projectIds);
    for (const projectId of normalized) {
      if (!this.projects.has(projectId)) throw new Error(`Projeto ${projectId} não encontrado`);
    }
    return normalized;
  }

  private loadProjectProjection(snapshotProjects?: ProjectData[]): void {
    this.projects.clear();
    const seed = snapshotProjects?.length ? snapshotProjects : this.projectFileStore.listProjects();
    for (const project of seed) {
      this.projects.set(project.slug, project);
      this.projectFileStore.saveProject(project);
    }
    for (const event of this.events) {
      if (event.type === SWARM_EVENT_TYPE.PROJECT_CREATED || event.type === SWARM_EVENT_TYPE.PROJECT_UPDATED) {
        const project = event.payload?.project as ProjectData | undefined;
        if (!project?.slug) continue;
        this.projects.set(project.slug, project);
        this.projectFileStore.saveProject(project);
      }
      if (event.type === SWARM_EVENT_TYPE.PROJECT_DELETED) {
        const slug = event.payload?.slug;
        if (typeof slug !== 'string') continue;
        this.projects.delete(slug);
        this.projectFileStore.deleteProject(slug);
      }
    }
  }

  private applyTaskProjectLinkEvents(): void {
    for (const event of this.events) {
      if (event.type !== SWARM_EVENT_TYPE.TASK_PROJECT_LINKED || !event.taskId) continue;
      const task = this.tasks.get(event.taskId);
      const projectIds = event.payload?.projectIds;
      if (!task || !Array.isArray(projectIds)) continue;
      task.options.projectIds = this.normalizeProjectIds(projectIds.filter((id): id is string => typeof id === 'string'));
    }
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
        // Status transitions (force: restoration, not a live transition).
        if (event.type === SWARM_EVENT_TYPE.TASK_QUEUED) task.status = TASK_STATUS.QUEUED;
        if (event.type === SWARM_EVENT_TYPE.TASK_STARTED) task.status = TASK_STATUS.RUNNING;
        if (event.type === SWARM_EVENT_TYPE.TASK_WAITING) {
          task.status = TASK_STATUS.WAITING;
          task.waitingReason =
            (event.payload?.waitingReason as import('../domain/task.js').TaskWaitingReason | undefined) ??
            task.waitingReason ?? 'subtasks';
        }
        if (event.type === SWARM_EVENT_TYPE.TASK_SUSPENDED) {
          task.status = TASK_STATUS.SUSPENDED;
          task.failureReason = 'human_timeout';
        }
        if (event.type === SWARM_EVENT_TYPE.TASK_RESUMED) {
          task.status = TASK_STATUS.PENDING;
          task.waitingReason = undefined;
          task.failureReason = undefined;
        }
        if (event.type === SWARM_EVENT_TYPE.TASK_COMPLETED) {
          task.status = TASK_STATUS.COMPLETED;
          task.waitingReason = undefined;
        }
        if (event.type === SWARM_EVENT_TYPE.TASK_FAILED) {
          task.status = TASK_STATUS.FAILED;
          task.failureReason = (event.payload?.failureReason as import('../domain/task.js').FailureReason) ?? task.failureReason;
        }
        if (event.type === SWARM_EVENT_TYPE.TASK_CANCELLED) {
          task.status = TASK_STATUS.CANCELLED;
          task.failureReason = 'cancelled_by_user';
        }
        if (event.type === SWARM_EVENT_TYPE.TASK_REVIEW) task.status = TASK_STATUS.REVIEW;
        // --- Run reconstruction (epochs + wait groups) ---
        if (event.type === SWARM_EVENT_TYPE.RUN_STARTED && event.runId) {
          if (!task.runs.some((r) => r.runId === event.runId)) {
            task.runs.push({
              runId: event.runId,
              status: 'RUNNING',
              epoch: task.runs.length + 1,
              waitGroups: [],
              resultMessages: [],
              createdAt: event.ts,
              startedAt: event.ts,
            });
          }
          task.activeRunId = event.runId;
        }
        if (event.type === SWARM_EVENT_TYPE.WAIT_GROUP_REGISTERED && event.runId && event.payload?.group) {
          const run = task.runs.find((r) => r.runId === event.runId);
          const g = event.payload.group as AgentWaitGroup;
          if (run && !run.waitGroups.some((wg) => wg.waitId === g.waitId)) {
            run.waitGroups.push({ waitId: g.waitId, mode: g.mode, taskIds: [...g.taskIds], processedEventIds: [], status: WAIT_GROUP_STATUS.WAITING as 'WAITING' });
            run.status = 'WAITING';
            task.activeRunId = event.runId;
          }
        }
        if ((event.type === SWARM_EVENT_TYPE.RUN_COMPLETED) && event.runId) {
          const run = task.runs.find((r) => r.runId === event.runId);
          if (run) { run.status = 'COMPLETED'; run.completedAt = event.ts; for (const wg of run.waitGroups) wg.status = WAIT_GROUP_STATUS.PROCESSED; }
          if (task.activeRunId === event.runId) task.activeRunId = undefined;
        }
        if ((event.type === SWARM_EVENT_TYPE.RUN_FAILED || event.type === SWARM_EVENT_TYPE.RUN_TIMEOUT) && event.runId) {
          const run = task.runs.find((r) => r.runId === event.runId);
          if (run) { run.status = event.type === SWARM_EVENT_TYPE.RUN_TIMEOUT ? 'TIMEOUT' : 'FAILED'; run.completedAt = event.ts; }
        }
        // --- Metrics reconstruction from heartbeat (latest wins) ---
        if (event.type === SWARM_EVENT_TYPE.HEARTBEAT && event.payload) {
          const tokens = event.payload.tokens as TaskMetrics['tokens'] | undefined;
          if (tokens) task.metrics.tokens = { ...tokens };
          if (typeof event.payload.cost === 'number') task.metrics.cost = event.payload.cost;
          if (typeof event.payload.durationMs === 'number') task.metrics.durationMs = event.payload.durationMs;
        }
        // Chat reconstruction from MESSAGE_APPENDED + terminal/run message payloads.
        const chatBearing =
          event.type === SWARM_EVENT_TYPE.MESSAGE_APPENDED ||
          event.type === SWARM_EVENT_TYPE.RUN_COMPLETED ||
          event.type === SWARM_EVENT_TYPE.TASK_COMPLETED ||
          event.type === SWARM_EVENT_TYPE.TASK_REVIEW ||
          event.type === SWARM_EVENT_TYPE.TASK_FAILED;
        if (chatBearing && event.messages) {
          for (const msg of event.messages) {
            const exists = task.chat.some(
              (c) => (msg.eventId && c.eventId === msg.eventId) || (c.ts === msg.ts && c.role === msg.role && c.text === msg.text),
            );
            if (!exists) task.chat.push(msg);
          }
          if (event.type !== SWARM_EVENT_TYPE.MESSAGE_APPENDED) task.resultMessages = event.messages;
        }
        // Artifact reconstruction
        if (event.type === SWARM_EVENT_TYPE.ARTIFACT_CREATED && event.payload?.artifact) {
          const artifact = event.payload.artifact as import('../domain/task.js').TaskArtifact;
          const exists = task.artifacts.some((a) => a.path === artifact.path);
          if (!exists) task.artifacts.push(artifact);
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
        task.setStatus(TASK_STATUS.PENDING, { force: true });
        this.markTaskDirty(task);
      }
      if (task.status === TASK_STATUS.WAITING && task.waitingReason !== 'human' && !this.hasValidActiveWait(task)) {
        // WAITING(human) is preserved across restart (the deadline monitor still
        // tracks it); only stale subtask-waits with no live dependency are reset.
        task.setStatus(TASK_STATUS.PENDING, { force: true });
        task.activeRunId = undefined;
        this.markTaskDirty(task);
      }
      // Re-register human deadlines so the timeout survives a restart.
      if (task.status === TASK_STATUS.WAITING && task.waitingReason === 'human') {
        this.registerHumanDeadline(task);
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

  /**
   * Convergence monitor (§5.3 / §10.3). Returns:
   *  - 'max_epochs' when the card burned more epochs than allowed without ever
   *    completing (divergent-but-never-converging "endless progression", PF4),
   *  - 'stagnation' when recent epochs are near-identical (circular iteration),
   *  - null otherwise (productive iteration).
   */
  private checkForStagnation(task: Task, currentOutput: string): 'stagnation' | 'max_epochs' | null {
    const gov = this.getActiveRun(task)?.governance ?? this.governance;
    if (task.runs.length >= gov.maxEpochsWithoutCompletion) return 'max_epochs';
    if (task.runs.length < 2) return null;
    const signals: RunSignal[] = task.runs
      .filter((r) => r.resultMessages.length > 0)
      .map((r) => ({
        output: r.resultMessages.map((m) => m.text ?? '').join(' '),
        epoch: r.epoch,
      }));
    // Add current output
    signals.push({ output: currentOutput, epoch: task.runs.length + 1 });
    return checkStagnation(signals, CONVERGENCE_THETA, STAGNATION_EPOCHS);
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
    const allowDuplicateTerminalEvent = args.payload?.allowDuplicateTerminalEvent === true;
    if (
      !allowDuplicateTerminalEvent &&
      (type === SWARM_EVENT_TYPE.TASK_COMPLETED ||
        type === SWARM_EVENT_TYPE.TASK_FAILED ||
        type === SWARM_EVENT_TYPE.TASK_CANCELLED) &&
      args.task
    ) {
      const alreadyRecorded = this.events.some(
        (event) =>
          event.type === type &&
          event.taskId === args.task?.taskId &&
          event.runId === args.runId,
      );
      if (alreadyRecorded) {
        return this.events.find(
          (event) =>
            event.type === type &&
            event.taskId === args.task?.taskId &&
            event.runId === args.runId,
        ) as SwarmEvent;
      }
    }
    const payload = args.payload ? { ...args.payload } : undefined;
    if (payload) delete payload.allowDuplicateTerminalEvent;

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
      payload,
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

  private cardCeiling(task: Task): { maxCost: number; maxActiveMs: number } {
    const gov = this.getActiveRun(task)?.governance ?? this.governance;
    // maxCost 0 = unlimited (fall back to the global budget cap if finite).
    const maxCost = gov.maxCost > 0 ? gov.maxCost : (Number.isFinite(MAX_TOTAL_COST) ? MAX_TOTAL_COST : 0);
    return { maxCost, maxActiveMs: gov.maxActiveMs };
  }

  /** Per-card cost/time ceiling (§10.5): aborts only the offending card. */
  private assertWithinCardCeiling(task: Task): void {
    const ceiling = this.cardCeiling(task);
    const reason = checkCardCeiling(task.metrics, ceiling);
    if (reason) {
      this.recordEvent(SWARM_EVENT_TYPE.BUDGET_EXCEEDED, {
        task,
        payload: { scope: 'card', cost: task.metrics.cost, durationMs: task.metrics.durationMs, ceiling },
      });
      throw new CeilingExceededError(
        `Card ceiling excedido: cost=${task.metrics.cost} duration=${task.metrics.durationMs}ms`,
      );
    }
  }

  /** Graceful degradation (§10.5, M1): warn once when nearing the card ceiling. */
  private warnIfApproachingCeiling(task: Task): void {
    const ceiling = this.cardCeiling(task);
    if (!isApproachingCeiling(task.metrics, ceiling, CEILING_WARNING_RATIO)) return;
    const last = task.chat[task.chat.length - 1];
    const warning = `⚠️ Aproximando do teto do card (custo/tempo). Finalize o trabalho essencial e deixe um handoff antes do corte.`;
    if (last?.role === 'assistant' && last.text === warning) return;
    this.postAgentMessage(task, warning);
  }

  private isQuiescent(): boolean {
    return (
      this.runningTaskIds.size === 0 &&
      this.queuedTaskIds.size === 0 &&
      this.taskQueue.length === 0 &&
      this.workerPool.activeCount === 0 &&
      this.workerPool.pendingCount === 0 &&
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
