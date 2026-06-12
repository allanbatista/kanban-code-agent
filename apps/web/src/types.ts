export type Column = {
  id: string;
  label: string;
  agent?: string | null;
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
  routing?: { currentAgent?: string | null; manualOverride?: { active?: boolean } };
  worktree?: { branch?: string; path?: string; parentTaskId?: string | null; mergeTarget?: string };
  dependencies?: { needs?: string[]; provides?: string[]; blockedBy?: string[]; fileLocks?: string[]; semaphores?: unknown[] };
  hooks?: { active?: string[] };
  skills?: { active?: string[] };
  agent?: { currentRunId?: string; currentSessionRef?: string; lastSummary?: string } | string;
  updatedAt?: string;
};

export type AppSettings = {
  storageRoot?: string;
  runtimeRoot?: string;
  workspace?: { name?: string; language?: string };
  runtime?: { maxParallelTasks?: number; agentTokens?: Record<string, number>; projectTokens?: Record<string, number> };
  ui?: { theme?: string; density?: string; showProgressOnCard?: boolean; showAgentOnCard?: boolean; showProjectTargetsOnCard?: boolean };
  safety?: { requireApprovalForMerge?: boolean; requireApprovalForDelete?: boolean; allowShell?: boolean; allowNetwork?: boolean };
};

export type AgentSettings = {
  id: string;
  label?: string;
  provider?: string;
  instructionsPath?: string;
  instructionsBody?: string;
  skills?: string[];
  tools?: string[] | { builtin?: string[]; custom?: string[] };
  limits?: { tokens?: number };
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
    agentTokens: Record<string, number>;
    projectTokens: Record<string, number>;
  };
  queue: string[];
  running: Array<{ id: string; agent: string }>;
  merges: string[];
  worktrees: Array<{ taskId: string; branch?: string; path?: string }>;
  blockers: Array<{ taskId: string; title: string; blockedBy: string[] }>;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: string;
};
