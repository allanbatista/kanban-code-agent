import { TASK_STATUS, type TaskStatus } from './types.js';
import type { Task } from './task.js';

// ---------------------------------------------------------------------------
// Transition table: from → Set of legal targets
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<TaskStatus, Set<TaskStatus>> = {
  [TASK_STATUS.PENDING]: new Set([TASK_STATUS.QUEUED, TASK_STATUS.CANCELLED]),
  [TASK_STATUS.QUEUED]: new Set([TASK_STATUS.RUNNING, TASK_STATUS.CANCELLED]),
  [TASK_STATUS.RUNNING]: new Set([
    TASK_STATUS.WAITING,
    TASK_STATUS.SUSPENDED,
    TASK_STATUS.REVIEW,
    TASK_STATUS.COMPLETED,
    TASK_STATUS.FAILED,
    TASK_STATUS.CANCELLED,
  ]),
  [TASK_STATUS.WAITING]: new Set([TASK_STATUS.RUNNING, TASK_STATUS.CANCELLED]),
  [TASK_STATUS.SUSPENDED]: new Set([TASK_STATUS.PENDING, TASK_STATUS.CANCELLED]),
  [TASK_STATUS.REVIEW]: new Set([TASK_STATUS.COMPLETED, TASK_STATUS.RUNNING, TASK_STATUS.CANCELLED]),
  // Terminal states — no outgoing transitions
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

export function transitionTask(task: Task, to: TaskStatus): void {
  if (!canTransition(task.status, to)) {
    throw new Error(
      `Illegal transition: ${task.status} → ${to} (task ${task.taskId})`,
    );
  }
  task.status = to;
}
