// Domain type aliases and enum-like const objects

// --- Task Status ---
export const TASK_STATUS = {
  PENDING: 'PENDING',
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  WAITING: 'WAITING',
  SUSPENDED: 'SUSPENDED',
  REVIEW: 'REVIEW',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export type TaskStatus = typeof TASK_STATUS[keyof typeof TASK_STATUS];

// --- Wait Group Mode ---
export const WAIT_GROUP_MODE = {
  WAIT_ALL: 'WAIT_ALL',
  ON_DEMAND: 'ON_DEMAND',
} as const;

export type WaitGroupMode = typeof WAIT_GROUP_MODE[keyof typeof WAIT_GROUP_MODE];

// --- Wait Group Status ---
export const WAIT_GROUP_STATUS = {
  WAITING: 'WAITING',
  READY: 'READY',
  PROCESSED: 'PROCESSED',
  FAILED: 'FAILED',
} as const;

export type WaitGroupStatus = typeof WAIT_GROUP_STATUS[keyof typeof WAIT_GROUP_STATUS];

// --- Task Run Status ---
export const TASK_RUN_STATUS = {
  RUNNING: 'RUNNING',
  WAITING: 'WAITING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  TIMEOUT: 'TIMEOUT',
} as const;

export type TaskRunStatus = typeof TASK_RUN_STATUS[keyof typeof TASK_RUN_STATUS];

// --- Model Alias ---
export const MODEL_ALIAS = {
  fast: 'fast',
  balanced: 'balanced',
  deep: 'deep',
} as const;

export type ModelAlias = typeof MODEL_ALIAS[keyof typeof MODEL_ALIAS];

// --- Effort Level ---
export const EFFORT_LEVEL = {
  off: 'off',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
} as const;

export type EffortLevel = typeof EFFORT_LEVEL[keyof typeof EFFORT_LEVEL];

// --- Task Chat Role ---
export const TASK_CHAT_ROLE = {
  system: 'system',
  user: 'user',
  assistant: 'assistant',
  event: 'event',
} as const;

export type TaskChatRole = typeof TASK_CHAT_ROLE[keyof typeof TASK_CHAT_ROLE];

// --- Task Message Type ---
export const TASK_MESSAGE_TYPE = {
  text: 'text',
  artifact: 'artifact',
  event: 'event',
} as const;

export type TaskMessageType = typeof TASK_MESSAGE_TYPE[keyof typeof TASK_MESSAGE_TYPE];

// --- Swarm Event Type ---
export const SWARM_EVENT_TYPE = {
  TASK_CREATED: 'TASK_CREATED',
  TASK_UPDATED: 'TASK_UPDATED',
  TASK_QUEUED: 'TASK_QUEUED',
  TASK_STARTED: 'TASK_STARTED',
  TASK_WAITING: 'TASK_WAITING',
  TASK_RESUMED: 'TASK_RESUMED',
  TASK_COMPLETED: 'TASK_COMPLETED',
  TASK_FAILED: 'TASK_FAILED',
  TASK_CANCELLED: 'TASK_CANCELLED',
  TASK_RETRY_REQUESTED: 'TASK_RETRY_REQUESTED',
  TASK_RETRIED: 'TASK_RETRIED',
  RUN_STARTED: 'RUN_STARTED',
  RUN_COMPLETED: 'RUN_COMPLETED',
  RUN_FAILED: 'RUN_FAILED',
  RUN_TIMEOUT: 'RUN_TIMEOUT',
  WAIT_GROUP_REGISTERED: 'WAIT_GROUP_REGISTERED',
  WAIT_GROUP_READY: 'WAIT_GROUP_READY',
  WAIT_GROUP_PROCESSED: 'WAIT_GROUP_PROCESSED',
  SUBTASK_CREATED: 'SUBTASK_CREATED',
  MESSAGE_APPENDED: 'MESSAGE_APPENDED',
  ARTIFACT_CREATED: 'ARTIFACT_CREATED',
  AGENT_OUTPUT_INVALID: 'AGENT_OUTPUT_INVALID',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  TASK_PAUSED: 'TASK_PAUSED',
  TASK_SUSPENDED: 'TASK_SUSPENDED',
  TASK_REVIEW: 'TASK_REVIEW',
  TASK_ARCHIVED: 'TASK_ARCHIVED',
  RUN_CANCELLED: 'RUN_CANCELLED',
  HEARTBEAT: 'HEARTBEAT',
} as const;

export type SwarmEventType = typeof SWARM_EVENT_TYPE[keyof typeof SWARM_EVENT_TYPE];
