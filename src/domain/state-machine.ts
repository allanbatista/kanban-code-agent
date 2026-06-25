import { TASK_STATUS, type TaskStatus } from './types.js';
import type { Task } from './task.js';

// ---------------------------------------------------------------------------
// Transition table: from → Set of legal targets
//
// Reflects the REAL lifecycle the Orquestrator drives (not an idealized model):
// retry sends RUNNING/QUEUED back to PENDING, the scheduler moves a satisfied
// WAITING task to QUEUED, etc. Terminal states have no automated outgoing edge.
// User/parent overrides (reopen a finished card, accept/cancel a subtask) are
// explicit and bypass the table via `Task.setStatus(to, { force: true })`.
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<TaskStatus, Set<TaskStatus>> = {
  [TASK_STATUS.PENDING]: new Set([TASK_STATUS.QUEUED, TASK_STATUS.RUNNING, TASK_STATUS.CANCELLED]),
  [TASK_STATUS.QUEUED]: new Set([TASK_STATUS.RUNNING, TASK_STATUS.PENDING, TASK_STATUS.CANCELLED]),
  [TASK_STATUS.RUNNING]: new Set([
    TASK_STATUS.WAITING,
    TASK_STATUS.SUSPENDED,
    TASK_STATUS.REVIEW,
    TASK_STATUS.COMPLETED,
    TASK_STATUS.FAILED,
    TASK_STATUS.CANCELLED,
    TASK_STATUS.PENDING, // retry / technical re-run
  ]),
  [TASK_STATUS.WAITING]: new Set([
    TASK_STATUS.RUNNING,
    TASK_STATUS.QUEUED, // scheduler re-enqueues a satisfied waiter
    TASK_STATUS.PENDING,
    TASK_STATUS.SUSPENDED, // human-intervention timeout
    TASK_STATUS.COMPLETED,
    TASK_STATUS.CANCELLED,
  ]),
  [TASK_STATUS.SUSPENDED]: new Set([TASK_STATUS.PENDING, TASK_STATUS.CANCELLED]),
  [TASK_STATUS.REVIEW]: new Set([
    TASK_STATUS.COMPLETED,
    TASK_STATUS.RUNNING,
    TASK_STATUS.PENDING,
    TASK_STATUS.CANCELLED,
  ]),
  // Terminal states — no automated outgoing transitions (reopen uses force).
  [TASK_STATUS.COMPLETED]: new Set(),
  [TASK_STATUS.FAILED]: new Set(),
  [TASK_STATUS.CANCELLED]: new Set(),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from]?.has(to) ?? false;
}

/** Guarded transition used directly by tests; production routes through Task.setStatus. */
export function transitionTask(task: Task, to: TaskStatus): void {
  if (!canTransition(task.status, to)) {
    throw new Error(
      `Illegal transition: ${task.status} → ${to} (task ${task.taskId})`,
    );
  }
  task.status = to;
}
