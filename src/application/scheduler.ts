import type { SwarmEvent } from '../domain/events.js';
import type { Task } from '../domain/task.js';

/**
 * Scheduler — owns the wait-index for dependency-aware scheduling.
 *
 * Responsibilities:
 * - rebuildWaitIndex: index WAITING tasks by the dependency task IDs they wait on
 * - scheduleWaitersForEvent: wake WAITING tasks whose dependencies just settled
 *
 * Ready-event computation lives in the Orquestrator (full event-log scan, sets
 * wait-group READY, records WAIT_GROUP_READY). The Scheduler only routes which
 * waiters to re-evaluate, so there is a single source of truth.
 */
export class Scheduler {
  waitingByDependency = new Map<string, Set<string>>();

  /** Rebuild the dependency index from all WAITING tasks' active wait groups. */
  rebuildWaitIndex(tasks: Map<string, Task>): void {
    this.waitingByDependency.clear();
    for (const task of tasks.values()) {
      if (task.status !== 'WAITING') continue;
      const run = this.getActiveRun(task);
      if (!run || run.status !== 'WAITING') continue;
      for (const group of run.waitGroups) {
        if (group.status === 'PROCESSED') continue;
        for (const dependencyTaskId of group.taskIds) {
          const waiters = this.waitingByDependency.get(dependencyTaskId) ?? new Set<string>();
          waiters.add(task.taskId);
          this.waitingByDependency.set(dependencyTaskId, waiters);
        }
      }
    }
  }

  /**
   * Called when a terminal event fires. Finds every WAITING task that depends on
   * the settled task, asks the Orquestrator (via `readyEvents`) which trigger
   * events are ready for that waiter, and schedules it when there are any.
   */
  scheduleWaitersForEvent(
    event: SwarmEvent,
    tasks: Map<string, Task>,
    readyEvents: (task: Task) => SwarmEvent[],
    scheduleFn: (taskId: string, events: SwarmEvent[]) => void,
  ): void {
    if (!event.taskId) return;
    const waiterTaskIds = this.waitingByDependency.get(event.taskId);
    if (!waiterTaskIds?.size) return;
    for (const waiterTaskId of waiterTaskIds) {
      const waiter = tasks.get(waiterTaskId);
      if (!waiter || waiter.status !== 'WAITING') continue;
      const triggerEvents = readyEvents(waiter);
      if (triggerEvents.length > 0) scheduleFn(waiter.taskId, triggerEvents);
    }
  }

  private getActiveRun(task: Task) {
    return task.activeRunId ? task.runs.find((run) => run.runId === task.activeRunId) : undefined;
  }
}
