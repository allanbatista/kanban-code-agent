import type { EffortLevel, ModelAlias, TaskChatRole, TaskMessageType, TaskStatus, WaitGroupMode } from './types';
import type { TaskRun } from './run';
import type { AgentWaitGroup, WaitGroup } from './wait-group';

// --- Runtime Config ---
export interface RuntimeConfig {
  model?: ModelAlias;
  effort?: EffortLevel;
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
}

// --- Task Options ---
export interface TaskOptions {
  taskId: string;
  title: string;
  assignedTo: string;
  parentId?: string;
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
    total: number;
  };
  cost: number;
}

// --- Serialized Task (snapshot representation) ---
export interface SerializedTask {
  options: TaskOptions;
  status: TaskStatus;
  subtaskIds: string[];
  resultMessages?: TaskChatMessage[];
  activeRunId?: string;
  runs?: TaskRun[];
  piSessionFile?: string;
  chat?: TaskChatMessage[];
  artifacts?: TaskArtifact[];
  retryCount?: number;
  technicalRetryCount?: number;
  metrics?: TaskMetrics;
}

// --- Agent Output Message ---
export interface AgentOutputMessage {
  type: TaskMessageType;
  text?: string;
  artifacts?: TaskArtifact[];
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
}

// --- Task Metadata (derived view for agent consumption) ---
export interface TaskMetadata {
  taskId: string;
  title: string;
  assignedTo: string;
  parentId?: string;
  status: TaskStatus;
  depth: number;
  maxDepth: number;
  canCreateSubtasks: boolean;
  sessionFile: string;
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

// --- Task Class ---
export class Task {
  options: TaskOptions;
  status: TaskStatus = 'PENDING';
  subtaskIds: string[] = [];
  resultMessages: TaskChatMessage[] = [];
  activeRunId?: string;
  runs: TaskRun[] = [];
  piSessionFile?: string;
  chat: TaskChatMessage[] = [];
  artifacts: TaskArtifact[] = [];
  retryCount = 0;
  technicalRetryCount = 0;
  metrics: TaskMetrics = this.createEmptyMetrics();

  constructor(options: TaskOptions, seedInitialMessage = true, attachments: AttachmentRef[] = []) {
    this.options = { ...options };
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

  get depth(): number {
    return this.options.depth;
  }

  get runtimeConfig(): RuntimeConfig | undefined {
    return this.options.runtimeConfig;
  }

  serialize(): SerializedTask {
    return {
      options: this.options,
      status: this.status,
      subtaskIds: this.subtaskIds,
      resultMessages: this.resultMessages,
      activeRunId: this.activeRunId,
      runs: this.runs,
      piSessionFile: this.piSessionFile,
      artifacts: this.artifacts,
      retryCount: this.retryCount,
      technicalRetryCount: this.technicalRetryCount,
      metrics: this.metrics,
    };
  }

  static fromSerialized(serialized: SerializedTask): Task {
    const task = new Task(serialized.options, false);
    task.status = serialized.status;
    task.subtaskIds = [...(serialized.subtaskIds ?? [])];
    task.resultMessages = serialized.resultMessages ?? [];
    task.activeRunId = serialized.activeRunId;
    task.runs = serialized.runs ?? [];
    task.piSessionFile = serialized.piSessionFile;
    task.chat = serialized.chat ?? [];
    task.artifacts = serialized.artifacts ?? [];
    task.retryCount = serialized.retryCount ?? 0;
    task.technicalRetryCount = serialized.technicalRetryCount ?? 0;
    task.metrics = serialized.metrics ?? task.createEmptyMetrics();
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
      tokens: { input: 0, output: 0, total: 0 },
      cost: 0,
    };
  }
}
