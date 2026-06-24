/**
 * Governance value object — per-task ceiling configuration.
 * Immutable snapshot captured at run start (config changes don't affect in-flight runs).
 */
export interface Governance {
  maxCost: number;               // USD, 0 = unlimited
  maxActiveMs: number;           // milliseconds of active computation
  maxDepth: number;              // max task tree depth
  maxRetries: number;            // max retry attempts per run
  maxTechnicalRetries: number;   // max technical retries (errors)
  maxEpochsWithoutCompletion: number; // max epochs without reaching completed
  maxSubtasksPerTask: number;    // max subtasks a single task can create
}

/** Default governance from env or sensible defaults. */
export function createDefaultGovernance(overrides?: Partial<Governance>): Governance {
  return {
    maxCost: readEnvNumber('SWARM_MAX_TOTAL_COST', 0),
    maxActiveMs: readEnvNumber('SWARM_MAX_ACTIVE_MS', 300_000 * 5), // runTimeout * maxRetries
    maxDepth: readEnvNumber('SWARM_MAX_TASK_DEPTH', 5),
    maxRetries: readEnvNumber('SWARM_MAX_TASK_RETRIES', 3),
    maxTechnicalRetries: readEnvNumber('SWARM_MAX_TECHNICAL_RETRIES', 2),
    maxEpochsWithoutCompletion: readEnvNumber('SWARM_MAX_EPOCHS_WITHOUT_COMPLETION', 10),
    maxSubtasksPerTask: readEnvNumber('SWARM_MAX_SUBTASKS_PER_TASK', 10),
    ...overrides,
  };
}

function readEnvNumber(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
