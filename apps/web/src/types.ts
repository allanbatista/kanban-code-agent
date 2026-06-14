export type Column = {
  id: string;
  label: string;
  agent?: string | null;
  role?: string | null;
  autoStart?: boolean;
  wip?: number | null;
  wipLimit?: number | null;
};

export type Task = {
  id: string;
  title: string;
  description?: string;
  kind: string;
  column: string;
  status: string;
  priority: string;
  projectTargets: string[];
  routing?: { currentAgent?: string | null; currentRole?: string | null; lastAgent?: string | null; lastRole?: string | null; nextSuggestedColumn?: string | null; manualOverride?: { active?: boolean } };
  worktree?: { branch?: string; path?: string; parentTaskId?: string | null; mainTaskId?: string | null; mergeTarget?: string };
  subtasksSummary?: { total: number; running: number; done: number };
  dependencies?: { needs?: string[]; provides?: string[]; blockedBy?: string[]; fileLocks?: string[]; semaphores?: unknown[] };
  failure?: { type?: string; reason?: string; ts?: string; actor?: string; runId?: string };
  hooks?: { active?: string[] };
  skills?: { active?: string[] };
  agent?: { currentRunId?: string; currentSessionRef?: string; lastSummary?: string } | string;
  usage?: TokenUsageAggregate | null;
  createdAt?: string;
  updatedAt?: string;
};

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheTokens?: number;
  contextWindow?: number;
  contextPercent?: number;
  durationMs?: number;
};

export type AgentTokenUsage = TokenUsage & {
  agentId: string;
  role?: string;
  runs?: number;
  models?: AgentModelTokenUsage[];
};

export type AgentModelTokenUsage = TokenUsage & {
  provider?: string;
  model: string;
  runs?: number;
};

export type TokenUsageAggregate = {
  total: TokenUsage;
  byAgent: AgentTokenUsage[];
};

export type TaskFiles = {
  taskId: string;
  acceptance: string;
  description: string;
  planning?: { status?: string; roles?: { required?: string[]; optional?: string[] } } | null;
  subtasks?: { nodes?: Array<{ id: string; title?: string; status?: string }> } | null;
  usage?: TokenUsageAggregate | null;
  events: Array<Record<string, unknown>>;
  files: string[];
  fileEntries?: Array<{ path: string; size?: number; kind?: "text" | "image" | "binary"; contentType?: string }>;
};

export type AppSettings = {
  storageRoot?: string;
  runtimeRoot?: string;
  workspace?: { name?: string; language?: string };
  ai?: { defaultProvider?: string; defaultModel?: string; defaultEffort?: "minimal" | "low" | "medium" | "high"; enabledProviders?: string[]; providers?: Record<string, { defaultModel?: string; defaultEffort?: "minimal" | "low" | "medium" | "high" } | unknown> };
  runtime?: { maxParallelTasks?: number; agentTokens?: Record<string, number>; projectTokens?: Record<string, number> };
  ui?: { theme?: string; density?: string; showProgressOnCard?: boolean; showAgentOnCard?: boolean; showProjectTargetsOnCard?: boolean; taskTextScale?: number; taskFontFamily?: "serif" | "sans-serif" };
  safety?: { requireApprovalForMerge?: boolean; requireApprovalForDelete?: boolean; allowShell?: boolean; allowNetwork?: boolean };
};

export type AgentSettings = {
  id: string;
  label?: string;
  provider?: string;
  model?: { provider?: string; name?: string; effort?: "minimal" | "low" | "medium" | "high"; temperature?: number };
  instructionsPath?: string;
  instructionsBody?: string;
  skills?: string[];
  tools?: string[] | { builtin?: string[]; custom?: string[] };
  limits?: { tokens?: number; maxParallelTasks?: number };
};

export type ProviderStatus = {
  id: string;
  label?: string;
  type: string;
  configured: boolean;
  enabled?: boolean;
  active?: boolean;
  requiredEnv: string[];
  missingEnv: string[];
  optionalEnv?: string[];
  apiKeyEnv?: string;
  baseUrl?: string | null;
  modelsEndpoint?: string | null;
  defaultModel?: string;
  contextSource?: string;
};

export type ProviderModel = {
  id: string;
  name?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
};

export type BoardSnapshot = {
  schema: string;
  columns: Column[];
  tasks: Task[];
  settings: AppSettings;
  events: Array<Record<string, unknown>>;
};

export type OrchestratorStatus = {
  schema: string;
  capacity: {
    running: number;
    maxParallelTasks: number;
    maxParallelMerges: number;
    agentMaxParallelTasks?: Record<string, number>;
    agentTokens: Record<string, number>;
    projectTokens: Record<string, number>;
  };
  queue: string[];
  running: Array<{ id: string; agent: string }>;
  merges: string[];
  worktrees: Array<{ taskId: string; branch?: string; path?: string }>;
  blockers: Array<{ taskId: string; title: string; blockedBy: string[] }>;
  semaphores?: { tokens?: Record<string, number>; leases?: Array<{ name: string; taskId?: string; role?: string; expiresAt?: string }> };
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  persona?: string;
  displayPersona?: string;
  agentId?: string;
  runId?: string;
  disposition?: string;
  text: string;
  time: string;
};

export type TaskComment = ChatMessage;

export type AgentLogEntry = {
  id: string;
  ts: string;
  source: string;
  type: string;
  actor: string;
  taskId: string;
  agentId?: string;
  runId?: string;
  category?: string;
  role?: string;
  text: string;
  raw?: unknown;
};

export type AgentLogPage = {
  items: AgentLogEntry[];
  nextCursor?: string;
  hasMore: boolean;
};
