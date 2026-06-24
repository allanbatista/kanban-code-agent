import type { ApiTask, ApiAgent, ApiProject, ApiSettings, ApiChatMessage, ApiArtifact, ApiAttachment, ApiTaskRun, ApiWaitGroup } from '@/types/api';
import type { Task, TaskStatus, Agent as UIAgent, ChatMessage, Artifact, Attachment, TaskRun, WaitGroup } from '@/types/task';
import type { Project } from '@/types/project';
import type { AppearanceSettings, AdvancedSettings } from '@/types/settings';

// --- Task adapters ---

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
    status: api.status as TaskStatus,
    depth: api.depth,
    subtaskIds: api.subtaskIds,
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
export function metadataToTask(meta: any): Task {
  return {
    id: meta.taskId,
    title: meta.title,
    assignedTo: agentSlug(meta.assignedTo),
    parentId: meta.parentId,
    status: meta.status as TaskStatus,
    depth: meta.depth,
    subtaskIds: meta.subtaskIds,
    runtimeConfig: {
      model: meta.runtimeConfig?.model ?? 'balanced',
      effort: meta.runtimeConfig?.effort ?? 'medium',
    },
    chat: (meta.taskChat ?? []).map(apiChatToChat),
    artifacts: (meta.artifacts ?? []).map(apiArtifactToArtifact),
    attachments: [],
    metrics: {
      startedAt: meta.metrics?.startedAt ?? undefined,
      finishedAt: meta.metrics?.finishedAt ?? undefined,
      durationMs: meta.metrics?.durationMs ?? 0,
      waitingMs: 0,
      tokens: {
        input: meta.metrics?.tokens?.input ?? 0,
        output: meta.metrics?.tokens?.output ?? 0,
        total: meta.metrics?.tokens?.total ?? 0,
        cache: 0,
      },
      cost: meta.metrics?.cost ?? 0,
    },
    retryCount: meta.retryCount ?? 0,
    runs: (meta.runs ?? []).map(apiRunToRun),
  };
}

function apiChatToChat(msg: ApiChatMessage): ChatMessage {
  return {
    ts: msg.ts,
    role: msg.role === 'assistant' ? 'assistant' : msg.role === 'user' ? 'user' : 'event',
    type: msg.type === 'artifact' ? 'artifact' : msg.type === 'event' ? 'event' : 'text',
    text: msg.text,
    artifacts: msg.artifacts?.map(apiArtifactToArtifact),
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
    id: api.id,
    name: api.name,
    description: api.description ?? '',
    location: '',
    taskCount: taskCount ?? api.taskIds.length,
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
    maxConcurrency: api.advanced.maxConcurrency,
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
