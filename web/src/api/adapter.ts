import type { ApiTask, ApiAgent, ApiProject, ApiSettings, ApiChatMessage, ApiArtifact, ApiAttachment, ApiTaskRun, ApiWaitGroup } from '@/types/api';
import type { Task, TaskStatus, Agent as UIAgent, ChatMessage, Artifact, Attachment, TaskRun, WaitGroup } from '@/types/task';
import type { Project } from '@/types/project';
import type { AppearanceSettings, AdvancedSettings } from '@/types/settings';

// --- Task adapters ---

type WsTaskMetadata = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

// Backend agent names ('Manager', 'Code Reviewer') → column/lookup slugs
// ('manager', 'code-reviewer'). The Inbox sentinel maps to itself.
export function agentSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}

export function apiTaskToTask(api: ApiTask): Task {
  return {
    id: api.taskId,
    title: api.title,
    assignedTo: agentSlug(api.assignedTo),
    parentId: api.parentId,
    projectIds: Array.isArray(api.projectIds) ? api.projectIds : [],
    status: api.status as TaskStatus,
    waitingReason: api.waitingReason ?? api.metadata?.waitingReason,
    failureReason: (api as { failureReason?: Task['failureReason'] }).failureReason ?? (api.metadata as { failureReason?: Task['failureReason'] } | undefined)?.failureReason,
    evaluationVerdict: (api.metadata as { evaluationVerdict?: Task['evaluationVerdict'] } | undefined)?.evaluationVerdict,
    depth: api.depth,
    subtaskIds: Array.isArray(api.subtaskIds) ? api.subtaskIds : [],
    runtimeConfig: {
      model: api.runtimeConfig?.model ?? 'balanced',
      effort: api.runtimeConfig?.effort ?? 'medium',
    },
    chat: (api.metadata?.taskChat ?? []).map(apiChatToChat),
    artifacts: (api.metadata?.artifacts ?? []).map(apiArtifactToArtifact),
    attachments: [],
    metrics: {
      startedAt: api.metadata?.metrics?.startedAt ?? api.createdAt ?? undefined,
      finishedAt: api.metadata?.metrics?.finishedAt ?? api.updatedAt ?? undefined,
      durationMs: api.metadata?.metrics?.durationMs ?? 0,
      waitingMs: 0,
      tokens: {
        input: api.metadata?.metrics?.tokens?.input ?? 0,
        output: api.metadata?.metrics?.tokens?.output ?? 0,
        total: api.metadata?.metrics?.tokens?.total ?? 0,
        cache: 0,
      },
      cost: api.metadata?.metrics?.cost ?? 0,
    },
    retryCount: api.metadata?.retryCount ?? 0,
    runs: (api.metadata?.runs ?? []).map(apiRunToRun),
  };
}

// Flat TaskMetadata (as delivered on WS event/state messages) → UI Task.
// Same shape as apiTaskToTask but reads the flattened fields directly.
export function metadataToTask(meta: WsTaskMetadata): Task {
  const runtimeConfig = isRecord(meta.runtimeConfig) ? meta.runtimeConfig : {};
  const metrics = isRecord(meta.metrics) ? meta.metrics : {};
  const tokens = isRecord(metrics.tokens) ? metrics.tokens : {};
  const taskChat = Array.isArray(meta.taskChat) ? (meta.taskChat as ApiChatMessage[]) : [];
  const artifacts = Array.isArray(meta.artifacts) ? (meta.artifacts as ApiArtifact[]) : [];
  const runs = Array.isArray(meta.runs) ? (meta.runs as ApiTaskRun[]) : [];
  const projectIds = Array.isArray(meta.projectIds)
    ? meta.projectIds.filter((projectId): projectId is string => typeof projectId === 'string')
    : [];
  const subtaskIds = Array.isArray(meta.subtaskIds)
    ? meta.subtaskIds.filter((taskId): taskId is string => typeof taskId === 'string')
    : [];

  return {
    id: stringValue(meta.taskId),
    title: stringValue(meta.title),
    assignedTo: agentSlug(stringValue(meta.assignedTo)),
    parentId: stringValue(meta.parentId) || undefined,
    projectIds,
    status: stringValue(meta.status, 'PENDING') as TaskStatus,
    waitingReason: meta.waitingReason as Task['waitingReason'],
    failureReason: meta.failureReason as Task['failureReason'],
    evaluationVerdict: meta.evaluationVerdict as Task['evaluationVerdict'],
    depth: numberValue(meta.depth),
    subtaskIds,
    runtimeConfig: {
      model: stringValue(runtimeConfig.model, 'balanced'),
      effort: stringValue(runtimeConfig.effort, 'medium'),
    },
    chat: taskChat.map(apiChatToChat),
    artifacts: artifacts.map(apiArtifactToArtifact),
    attachments: [],
    metrics: {
      startedAt: stringValue(metrics.startedAt) || undefined,
      finishedAt: stringValue(metrics.finishedAt) || undefined,
      durationMs: numberValue(metrics.durationMs),
      waitingMs: 0,
      tokens: {
        input: numberValue(tokens.input),
        output: numberValue(tokens.output),
        total: numberValue(tokens.total),
        cache: 0,
      },
      cost: numberValue(metrics.cost),
    },
    retryCount: numberValue(meta.retryCount),
    runs: runs.map(apiRunToRun),
  };
}

function apiChatToChat(msg: ApiChatMessage): ChatMessage {
  return {
    ts: msg.ts,
    role: msg.role === 'assistant' ? 'assistant' : msg.role === 'user' ? 'user' : 'event',
    type: msg.type === 'artifact' ? 'artifact' : msg.type === 'event' ? 'event' : 'text',
    text: msg.text,
    artifacts: msg.artifacts?.map(apiArtifactToArtifact),
    attachments: (msg as { attachments?: ApiAttachment[] }).attachments?.map(apiAttachmentToAttachment),
    refTaskId: msg.refTaskId,
  };
}

function apiArtifactToArtifact(a: ApiArtifact): Artifact {
  return {
    description: a.description,
    file_type: a.fileType,
    path: a.path,
    sizeBytes: a.sizeBytes ?? 0,
  };
}

export function apiAttachmentToAttachment(a: ApiAttachment): Attachment {
  return {
    id: a.id,
    originalName: a.originalName,
    path: a.path,
    sizeBytes: a.sizeBytes,
  };
}

function apiRunToRun(r: ApiTaskRun): TaskRun {
  return {
    runId: r.runId,
    status: r.status,
    waitGroups: (r.waitGroups ?? []).map(apiWaitGroupToWaitGroup),
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    error: r.error,
  };
}

function apiWaitGroupToWaitGroup(wg: ApiWaitGroup): WaitGroup {
  return {
    waitId: wg.waitId,
    mode: wg.mode,
    taskIds: wg.taskIds,
    processedEventIds: wg.processedEventIds,
    status: wg.status,
  };
}

// --- Agent adapters ---

export function apiAgentToAgent(api: ApiAgent): UIAgent {
  const slug = agentSlug(api.name);
  return {
    id: slug,
    name: api.name,
    icon: getAgentIcon(slug),
    color: getAgentColor(slug),
  };
}

const AGENT_ICONS: Record<string, string> = {
  manager: 'ClipboardList',
  produto: 'Puzzle',
  generic: 'Bot',
  architecture: 'Building2',
  engineer: 'Code',
  'code-reviewer': 'SearchCode',
  qa: 'FlaskConical',
  inbox: 'Inbox',
};

const AGENT_COLORS: Record<string, string> = {
  manager: '#f59e0b',
  produto: '#a78bfa',
  generic: '#94a3b8',
  architecture: '#f472b6',
  engineer: '#60a5fa',
  'code-reviewer': '#2dd4bf',
  qa: '#fb923c',
  inbox: '#94a3b8',
};

function getAgentIcon(name: string): string {
  return AGENT_ICONS[name] ?? 'Bot';
}

function getAgentColor(name: string): string {
  return AGENT_COLORS[name] ?? '#94a3b8';
}

// --- Project adapters ---

export function apiProjectToProject(api: ApiProject, taskCount?: number, runningCount?: number): Project {
  return {
    id: api.slug,
    slug: api.slug,
    name: api.name,
    description: api.description ?? '',
    gitUrl: api.gitUrl,
    defaultBranch: api.defaultBranch,
    autoMerge: api.autoMerge,
    devcontainerPath: api.devcontainerPath,
    location: '',
    taskCount: taskCount ?? 0,
    runningCount: runningCount ?? 0,
    createdAt: api.createdAt ? api.createdAt.split('T')[0] : new Date().toISOString().split('T')[0],
  };
}

// --- Settings adapters ---

export function apiSettingsToAppearance(api: ApiSettings): AppearanceSettings {
  return {
    fontSize: 14,
    fontFamily: 'Inter',
    theme: api.appearance.theme === 'system' ? 'System' : api.appearance.theme.charAt(0).toUpperCase() + api.appearance.theme.slice(1),
    density: 'Comfortable',
  };
}

export function apiSettingsToAdvanced(api: ApiSettings): AdvancedSettings {
  return {
    runTimeoutMs: api.advanced.runTimeoutMs,
    maxTaskDepth: api.advanced.maxTaskDepth,
    maxSubtasks: api.advanced.maxSubtasksPerTask,
    maxRetries: api.advanced.maxRetries,
    maxTechnicalRetries: api.advanced.maxTechnicalRetries,
    maxTokensBudget: 0,
    maxCostBudget: 0,
  };
}

// --- SwarmEvent adapter ---

export function apiEventToChatMessage(event: {
  type: string;
  taskId?: string;
  eventId?: string;
  ts?: string;
  messages?: ApiChatMessage[];
}): ChatMessage[] {
  return (event.messages ?? []).map(apiChatToChat);
}
