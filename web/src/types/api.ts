// Tipos que correspondem exatamente ao contrato da API backend

export interface ApiTask {
  taskId: string;
  title: string;
  assignedTo: string;
  parentId?: string;
  projectIds: string[];
  status: 'PENDING' | 'QUEUED' | 'RUNNING' | 'WAITING' | 'SUSPENDED' | 'REVIEW' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  waitingReason?: 'subtasks' | 'human' | 'validation';
  depth: number;
  subtaskIds: string[];
  runtimeConfig: { model?: string; effort?: string; agent?: string };
  metadata: {
    taskId: string;
    title: string;
    assignedTo: string;
    parentId?: string;
    projectIds: string[];
    status: string;
    waitingReason?: 'subtasks' | 'human' | 'validation';
    depth: number;
    maxDepth: number;
    canCreateSubtasks: boolean;
    runtimeConfig: { model: string; effort: string };
    retryCount: number;
    technicalRetryCount: number;
    maxRetries: number;
    maxTechnicalRetries: number;
    maxSubtasksPerTask: number;
    runTimeoutMs: number;
    activeRunId?: string;
    runs: ApiTaskRun[];
    taskChat: ApiChatMessage[];
    artifacts: ApiArtifact[];
    metrics: ApiMetrics;
  };
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ApiTaskRun {
  runId: string;
  status: 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';
  waitGroups: ApiWaitGroup[];
  startedAt?: string;
  completedAt?: string;
  error?: string;
  piSessionFile?: string;
}

export interface ApiWaitGroup {
  waitId: string;
  mode: 'WAIT_ALL' | 'ON_DEMAND';
  taskIds: string[];
  processedEventIds: string[];
  status: 'WAITING' | 'READY' | 'PROCESSED' | 'FAILED';
}

export interface ApiChatMessage {
  ts: string;
  role: 'user' | 'assistant' | 'event';
  type: 'text' | 'artifact' | 'event';
  text?: string;
  attachments?: ApiAttachment[];
  artifacts?: ApiArtifact[];
  runtimeConfig?: { model?: string; effort?: string };
  eventId?: string;
  refTaskId?: string;
}

export interface ApiArtifact {
  description: string;
  fileType: string;
  path: string;
  sizeBytes?: number;
}

export interface ApiAttachment {
  id: string;
  originalName: string;
  path: string;
  sizeBytes: number;
}

export interface ApiMetrics {
  durationMs: number;
  tokens: { input: number; output: number; total: number };
  cost: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface ApiAgent {
  name: string;
  role: string;
  runtimeConfig: { model?: string; effort?: string };
  tools: string[];
}

export interface ApiProject {
  slug: string;
  name: string;
  description: string;
  gitUrl?: string;
  defaultBranch: string;
  autoMerge: boolean;
  devcontainerPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiSettings {
  agent: 'pi' | 'codex';
  appearance: {
    theme: 'light' | 'dark' | 'system';
    language: string;
  };
  providers: ApiProviderConfig[];
  advanced: {
    runTimeoutMs: number;
    maxTaskDepth: number;
    maxSubtasksPerTask: number;
    maxRetries: number;
    maxTechnicalRetries: number;
    dataDir: string;
  };
}

export interface ApiProviderConfig {
  name: string;
  provider: string;
  modelId: string;
  apiKey: string;
  enabled: boolean;
}

export interface ApiCodexStatus {
  loggedIn: boolean;
  method?: 'apiKey' | 'chatgpt';
  email?: string;
  plan?: string;
}

export interface ApiCodexDeviceLogin {
  loginId: string;
  verificationUrl: string;
  userCode: string;
}

export interface ApiUserProfile {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  provider: string;
}

export interface ApiHealth {
  status: string;
  uptime: number;
  version: string;
}

// Respostas envelopadas da API
export interface ApiTaskListResponse {
  tasks: ApiTask[];
  total: number;
}

export interface ApiAgentListResponse {
  agents: ApiAgent[];
  total: number;
}

export interface ApiProjectListResponse {
  projects: ApiProject[];
  total: number;
}
