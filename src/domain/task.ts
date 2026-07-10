import type { AgentName, EffortLevel, ModelAlias, TaskChatRole, TaskMessageType, TaskStatus, WaitGroupMode } from './types';
import type { TaskRun } from './run';
import type { AgentWaitGroup, WaitGroup } from './wait-group';
import { canTransition } from './state-machine.js';

export type TaskWaitingReason = 'subtasks' | 'human' | 'validation';

// --- Runtime Config ---
export interface RuntimeConfig {
  model?: ModelAlias;
  effort?: EffortLevel;
  agent?: AgentName;
}

// --- Attachment Ref ---
export interface AttachmentRef {
  id: string;
  originalName: string;
  path: string;
  sizeBytes: number;
}

// --- Task Artifact ---
export interface TaskArtifact {
  description: string;
  fileType: string;
  path: string;
  sizeBytes?: number;
}

// --- Task Chat Message ---
export interface TaskChatMessage {
  ts: string;
  role: TaskChatRole;
  type: TaskMessageType;
  text?: string;
  attachments?: AttachmentRef[];
  artifacts?: TaskArtifact[];
  runtimeConfig?: RuntimeConfig;
  eventId?: string;
  /** For terminal-event chat lines: the subtask this event refers to (so the UI can open it). */
  refTaskId?: string;
}

// --- Task Options ---
export interface TaskOptions {
  taskId: string;
  title: string;
  assignedTo: string;
  parentId?: string;
  projectIds?: string[];
  depth: number;
  runtimeConfig?: RuntimeConfig;
}

// --- Task Metrics ---
export interface TaskMetrics {
  startedAt?: string;
  finishedAt?: string;
  durationMs: number;
  tokens: {
    input: number;
    output: number;
    /** Cache read + write tokens (cheap). Kept separate so input+output+cache = total. */
    cache: number;
    total: number;
  };
  cost: number;
}

// --- Serialized Task (snapshot representation) ---
export interface SerializedTask {
  options: TaskOptions;
  status: TaskStatus;
  waitingReason?: TaskWaitingReason;
  failureReason?: FailureReason;
  subtaskIds: string[];
  resultMessages?: TaskChatMessage[];
  activeRunId?: string;
  runs?: TaskRun[];
  chat?: TaskChatMessage[];
  artifacts?: TaskArtifact[];
  retryCount?: number;
  technicalRetryCount?: number;
  metrics?: TaskMetrics;
  evaluationVerdict?: EvaluationVerdict;
}

// --- Agent Output Message ---
export interface AgentOutputMessage {
  type: TaskMessageType;
  text?: string;
  artifacts?: TaskArtifact[];
}

// --- Evaluation Verdict (QA / Code Reviewer) ---
export type EvaluationVerdict = 'approved' | 'rejected';

export interface EvaluationCriterion {
  name: string;
  passed: boolean;
  note?: string;
}

// --- Agent Decision ---
export interface AgentDecision {
  status: 'completed' | 'waiting' | 'retry';
  messages: AgentOutputMessage[];
  waitGroups?: AgentWaitGroup[];
  waitMode?: WaitGroupMode;
  waitingForTaskIds?: string[];
  instructions?: string;
  model?: ModelAlias;
  effort?: EffortLevel;
  // Independent-evaluation contract (QA / Code Reviewer): a skeptical verdict
  // with graded criteria + actionable feedback (§8.2).
  verdict?: EvaluationVerdict;
  criteria?: EvaluationCriterion[];
  feedback?: string;
}

// --- Task Metadata (derived view for agent consumption) ---
export interface TaskMetadata {
  taskId: string;
  title: string;
  assignedTo: string;
  parentId?: string;
  projectIds: string[];
  status: TaskStatus;
  waitingReason?: TaskWaitingReason;
  failureReason?: FailureReason;
  evaluationVerdict?: EvaluationVerdict;
  depth: number;
  maxDepth: number;
  canCreateSubtasks: boolean;
  subtaskIds: string[];
  chatFile: string;
  attachmentsDir: string;
  artifactsDir: string;
  artifactsFile: string;
  runtimeConfig: Required<RuntimeConfig>;
  allowedModels: Record<ModelAlias, { provider: string; modelId: string; description: string }>;
  allowedEfforts: EffortLevel[];
  retryCount: number;
  technicalRetryCount: number;
  maxRetries: number;
  maxTechnicalRetries: number;
  maxSubtasksPerTask: number;
  runTimeoutMs: number;
  activeRunId?: string;
  runs: TaskRun[];
  taskChat: TaskChatMessage[];
  artifacts: TaskArtifact[];
  metrics: TaskMetrics;
  /** Human-readable status + results of direct subtasks (built by Orquestrator). */
  subtaskSummary?: string;
}

// --- Failure Reason ---
export type FailureReason =
  | 'attempts'       // max retries/epochs exceeded
  | 'stagnation'     // no progress detected
  | 'ceiling'        // cost/time ceiling hit
  | 'blocked'        // depth limit or other structural block
  | 'human_timeout'  // human intervention timeout (→ SUSPENDED, not FAILED)
  | 'cancelled_by_user'; // user cancelled

// --- Task Class ---
export class Task {
  options: TaskOptions;
  status: TaskStatus = 'PENDING';
  failureReason?: FailureReason;
  waitingReason?: TaskWaitingReason;
  subtaskIds: string[] = [];
  resultMessages: TaskChatMessage[] = [];
  activeRunId?: string;
  runs: TaskRun[] = [];
  chat: TaskChatMessage[] = [];
  artifacts: TaskArtifact[] = [];
  retryCount = 0;
  technicalRetryCount = 0;
  metrics: TaskMetrics = this.createEmptyMetrics();
  /** Latest independent-evaluation verdict (set when this is a QA/Code Reviewer subtask). */
  evaluationVerdict?: EvaluationVerdict;

  constructor(options: TaskOptions, seedInitialMessage = true, attachments: AttachmentRef[] = []) {
    this.options = { ...options, projectIds: normalizeProjectIds(options.projectIds) };
    if (seedInitialMessage) {
      this.appendChat('user', 'text', options.title, options.runtimeConfig, attachments);
    }
  }

  get taskId(): string {
    return this.options.taskId;
  }

  get title(): string {
    return this.options.title;
  }

  get assignedTo(): string {
    return this.options.assignedTo;
  }

  get parentId(): string | undefined {
    return this.options.parentId;
  }

  get projectIds(): string[] {
    return this.options.projectIds ?? [];
  }

  get depth(): number {
    return this.options.depth;
  }

  get runtimeConfig(): RuntimeConfig | undefined {
    return this.options.runtimeConfig;
  }

  /**
   * Guarded status transition. Throws on an illegal transition per the domain
   * state machine. `force` bypasses the guard for explicit overrides (user
   * reopen of a finished card, a parent accepting/cancelling a subtask) and for
   * state restoration during replay/recovery. Optionally sets failure/waiting
   * reasons atomically with the status change.
   */
  setStatus(
    to: TaskStatus,
    opts: { force?: boolean; failureReason?: FailureReason; waitingReason?: TaskWaitingReason } = {},
  ): void {
    if (!opts.force && to !== this.status && !canTransition(this.status, to)) {
      throw new Error(`Illegal transition: ${this.status} → ${to} (task ${this.taskId})`);
    }
    this.status = to;
    if ('failureReason' in opts) this.failureReason = opts.failureReason;
    if ('waitingReason' in opts) this.waitingReason = opts.waitingReason;
  }

  serialize(): SerializedTask {
    return {
      options: this.options,
      status: this.status,
      waitingReason: this.waitingReason,
      failureReason: this.failureReason,
      subtaskIds: this.subtaskIds,
      resultMessages: this.resultMessages,
      activeRunId: this.activeRunId,
      runs: this.runs,
      artifacts: this.artifacts,
      retryCount: this.retryCount,
      technicalRetryCount: this.technicalRetryCount,
      metrics: this.metrics,
      evaluationVerdict: this.evaluationVerdict,
    };
  }

  static fromSerialized(serialized: SerializedTask): Task {
    const task = new Task(serialized.options, false);
    task.status = serialized.status;
    task.waitingReason = serialized.waitingReason;
    task.failureReason = serialized.failureReason;
    task.subtaskIds = [...(serialized.subtaskIds ?? [])];
    task.resultMessages = serialized.resultMessages ?? [];
    task.activeRunId = serialized.activeRunId;
    task.runs = serialized.runs ?? [];
    task.chat = serialized.chat ?? [];
    task.artifacts = serialized.artifacts ?? [];
    task.retryCount = serialized.retryCount ?? 0;
    task.technicalRetryCount = serialized.technicalRetryCount ?? 0;
    task.metrics = serialized.metrics ?? task.createEmptyMetrics();
    task.evaluationVerdict = serialized.evaluationVerdict;
    return task;
  }

  appendChat(
    role: TaskChatRole,
    type: TaskMessageType,
    text?: string,
    runtimeConfig?: RuntimeConfig,
    attachments?: AttachmentRef[],
    artifacts?: TaskArtifact[],
    eventId?: string,
  ): TaskChatMessage {
    const message: TaskChatMessage = { ts: new Date().toISOString(), role, type };
    if (text !== undefined) message.text = text;
    if (runtimeConfig !== undefined) message.runtimeConfig = runtimeConfig;
    if (attachments?.length) message.attachments = attachments;
    if (artifacts?.length) message.artifacts = artifacts;
    if (eventId) message.eventId = eventId;
    this.chat.push(message);
    return message;
  }

  appendAgentMessages(messages: AgentOutputMessage[]): TaskChatMessage[] {
    return messages.map((message) =>
      this.appendChat('assistant', message.type, message.text, undefined, undefined, message.artifacts),
    );
  }

  private createEmptyMetrics(): TaskMetrics {
    return {
      durationMs: 0,
      tokens: { input: 0, output: 0, cache: 0, total: 0 },
      cost: 0,
    };
  }
}

function normalizeProjectIds(projectIds: string[] | undefined): string[] {
  return [...new Set((projectIds ?? []).map((id) => id.trim()).filter(Boolean))];
}
