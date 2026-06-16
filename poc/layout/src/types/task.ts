export type TaskStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface TaskMetrics {
  startedAt?: string;
  finishedAt?: string;
  durationMs: number;
  tokens: { input: number; output: number; total: number };
  cost: number;
}

export interface TaskRun {
  runId: string;
  status: 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';
  waitGroups: WaitGroup[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface WaitGroup {
  waitId: string;
  mode: 'WAIT_ALL' | 'ON_DEMAND';
  taskIds: string[];
  processedEventIds: string[];
  status: 'WAITING' | 'READY' | 'PROCESSED' | 'FAILED';
}

export interface Agent {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export interface ChatMessage {
  ts: string;
  role: 'system' | 'user' | 'assistant' | 'event';
  type: 'text' | 'artifact' | 'event';
  text?: string;
  artifacts?: Artifact[];
}

export interface Artifact {
  description: string;
  file_type: string;
  path: string;
  sizeBytes: number;
}

export interface Attachment {
  id: string;
  originalName: string;
  path: string;
  sizeBytes: number;
}

export interface Task {
  id: string;
  title: string;
  assignedTo: string;
  parentId?: string;
  status: TaskStatus;
  depth: number;
  subtaskIds: string[];
  runId?: string;
  runtimeConfig: { model: string; effort: string };
  chat: ChatMessage[];
  artifacts: Artifact[];
  attachments: Attachment[];
  metrics: TaskMetrics;
  retryCount: number;
  runs: TaskRun[];
}

export type ModelAlias = 'fast' | 'balanced' | 'deep';
export type EffortLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
