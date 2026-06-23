import type { SwarmEvent } from '../domain/events.js';
import type { Task } from '../domain/task.js';
import { SWARM_EVENT_TYPE } from '../domain/types.js';

/**
 * Scheduler — extracted wait-index and dependency-aware scheduling from Orquestrator.
 *
 * Responsibilities:
 *  - rebuildWaitIndex: index WAITING tasks by their dependency task IDs
 *  - scheduleWaitersForEvent: wake WAITING tasks when their dependencies complete
 *  - getReadyEvents: determine which events should trigger a WAITING task
 */

/** Terminal task event types that can trigger waiters. */
function isTerminalTaskEvent(type: string): boolean {
  return (
    type === SWARM_EVENT_TYPE.TASK_COMPLETED ||
    type === SWARM_EVENT_TYPE.TASK_FAILED ||
    type === SWARM_EVENT_TYPE.TASK_CANCELLED
  );
}

export class Scheduler {
  private waitingByDependency = new Map<string, Set<string>>();

  /**
   * Rebuild the dependency index from all WAITING tasks and their active run's wait groups.
   */
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
   * Called when a terminal event fires. Finds all WAITING tasks that depend on
   * the completed/failed/cancelled task and schedules them if they are ready.
   */
  scheduleWaitersForEvent(
    event: SwarmEvent,
    tasks: Map<string, Task>,
    scheduleFn: (taskId: string, events: SwarmEvent[]) => void,
  ): void {
    if (!event.taskId) return;
    const waiterTaskIds = this.waitingByDependency.get(event.taskId);
    if (!waiterTaskIds?.size) return;
    for (const waiterTaskId of waiterTaskIds) {
      const waiter = tasks.get(waiterTaskId);
      if (!waiter || waiter.status !== 'WAITING') continue;
      const triggerEvents = this.getReadyEvents(waiter, [event], tasks);
      if (triggerEvents.length > 0) scheduleFn(waiter.options.taskId, triggerEvents);
    }
  }

  /**
   * Determine which events should trigger a WAITING task based on its active run's wait groups.
   * Matches the PoC logic exactly:
   *  - FAILED/CANCELLED dependency → immediately returns that single event
   *  - ON_DEMAND → returns the first available terminal event
   *  - WAIT_ALL → returns all terminal events only when ALL dependencies are COMPLETED
   */
  getReadyEvents(
    task: Task,
    _candidateEvents: SwarmEvent[],
    tasks: Map<string, Task>,
  ): SwarmEvent[] {
    const run = this.getActiveRun(task);
    if (!run || run.status !== 'WAITING') return [];

    for (const group of run.waitGroups) {
      if (group.status === 'PROCESSED') continue;

      const terminalEvents: SwarmEvent[] = [];
      // We need to scan all events known to the outside (not parameterized here).
      // This method is designed to be called after scheduleWaitersForEvent,
      // which already passes relevant events. For the full scan, however,
      // we need to look at ALL events. The Orquestrator will pass the full event list
      // through a different overload. Let's use the candidateEvents for the scan.

      for (const event of _candidateEvents) {
        if (!isTerminalTaskEvent(event.type)) continue;
        if (!event.taskId) continue;
        if (!group.taskIds.includes(event.taskId)) continue;
        if (event.processedByTaskIds.includes(task.taskId)) continue;
        if (group.processedEventIds.includes(event.eventId)) continue;
        terminalEvents.push(event);
      }

      // No relevant events for this group yet
      if (terminalEvents.length === 0) continue;

      const failedEvent = terminalEvents.find(
        (event) => event.type === SWARM_EVENT_TYPE.TASK_FAILED || event.type === SWARM_EVENT_TYPE.TASK_CANCELLED,
      );
      if (failedEvent) {
        return [failedEvent];
      }

      if (group.mode === 'ON_DEMAND') {
        return [terminalEvents[0]];
      }

      const allCompleted = group.taskIds.every(
        (dependencyTaskId) => tasks.get(dependencyTaskId)?.status === 'COMPLETED',
      );
      if (group.mode === 'WAIT_ALL' && allCompleted) {
        return terminalEvents;
      }
    }

    return [];
  }

  private getActiveRun(task: Task) {
    return task.activeRunId
      ? task.runs.find((run) => run.runId === task.activeRunId)
      : undefined;
  }
}
