import { describe, it, expect, beforeEach } from 'vitest';
import { Scheduler } from '../../application/scheduler.js';
import { Task } from '../../domain/task.js';
import { TASK_STATUS, SWARM_EVENT_TYPE, WAIT_GROUP_MODE, WAIT_GROUP_STATUS } from '../../domain/types.js';
import type { TaskStatus } from '../../domain/types.js';
import type { SwarmEvent } from '../../domain/events.js';
import type { TaskRun } from '../../domain/run.js';
import type { WaitGroup } from '../../domain/wait-group.js';

function makeRun(runId: string, waitGroups: WaitGroup[] = []): TaskRun {
  return {
    runId,
    status: 'WAITING',
    epoch: 1,
    waitGroups,
    resultMessages: [],
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  };
}

function makeWaitGroup(
  waitId: string,
  mode: 'WAIT_ALL' | 'ON_DEMAND',
  taskIds: string[],
  status: 'WAITING' | 'READY' | 'PROCESSED' = 'WAITING',
  processedEventIds: string[] = [],
): WaitGroup {
  return { waitId, mode, taskIds, processedEventIds, status };
}

function makeEvent(overrides: Partial<SwarmEvent> = {}): SwarmEvent {
  return {
    seq: 1,
    eventId: 'evt_1',
    type: SWARM_EVENT_TYPE.TASK_COMPLETED,
    taskId: 'task_a',
    ts: new Date().toISOString(),
    processedByTaskIds: [],
    ...overrides,
  };
}

function makeTask(id: string, status: TaskStatus = 'WAITING', run?: TaskRun): Task {
  const task = new Task({ taskId: id, title: `Task ${id}`, assignedTo: 'agent-1', depth: 0 }, false);
  task.status = status;
  if (run) {
    task.runs = [run];
    task.activeRunId = run.runId;
  }
  return task;
}

describe('Scheduler', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler();
  });

  describe('rebuildWaitIndex', () => {
    it('builds correct dependency map from WAITING tasks', () => {
      const tasks = new Map<string, Task>();
      const waitGroup = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_sub_a', 'task_sub_b']);
      const run = makeRun('run_1', [waitGroup]);
      const task = makeTask('task_1', TASK_STATUS.WAITING, run);
      tasks.set('task_1', task);
      tasks.set('task_sub_a', makeTask('task_sub_a', TASK_STATUS.RUNNING));
      tasks.set('task_sub_b', makeTask('task_sub_b', TASK_STATUS.RUNNING));

      scheduler.rebuildWaitIndex(tasks);

      const waiters = scheduler.waitingByDependency;
      expect(waiters.get('task_sub_a')?.has('task_1')).toBe(true);
      expect(waiters.get('task_sub_b')?.has('task_1')).toBe(true);
    });

    it('ignores tasks not in WAITING status', () => {
      const tasks = new Map<string, Task>();
      tasks.set('task_1', makeTask('task_1', TASK_STATUS.RUNNING));
      tasks.set('task_2', makeTask('task_2', TASK_STATUS.COMPLETED));

      scheduler.rebuildWaitIndex(tasks);

      expect(scheduler.waitingByDependency.size).toBe(0);
    });

    it('ignores WAITING tasks without an active run', () => {
      const tasks = new Map<string, Task>();
      tasks.set('task_1', makeTask('task_1', TASK_STATUS.WAITING));

      scheduler.rebuildWaitIndex(tasks);

      expect(scheduler.waitingByDependency.size).toBe(0);
    });

    it('ignores WAITING tasks whose run is not WAITING', () => {
      const tasks = new Map<string, Task>();
      const run = makeRun('run_1');
      run.status = 'COMPLETED';
      tasks.set('task_1', makeTask('task_1', TASK_STATUS.WAITING, run));

      scheduler.rebuildWaitIndex(tasks);

      expect(scheduler.waitingByDependency.size).toBe(0);
    });

    it('ignores PROCESSED wait groups', () => {
      const tasks = new Map<string, Task>();
      const waitGroup = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_sub_a'], WAIT_GROUP_STATUS.PROCESSED);
      const run = makeRun('run_1', [waitGroup]);
      tasks.set('task_1', makeTask('task_1', TASK_STATUS.WAITING, run));

      scheduler.rebuildWaitIndex(tasks);

      expect(scheduler.waitingByDependency.size).toBe(0);
    });

    it('multiple waiters index correctly for single dependency', () => {
      const tasks = new Map<string, Task>();
      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_dep']);
      tasks.set('task_a', makeTask('task_a', TASK_STATUS.WAITING, makeRun('run_1', [wg])));
      tasks.set('task_b', makeTask('task_b', TASK_STATUS.WAITING, makeRun('run_2', [wg])));
      tasks.set('task_dep', makeTask('task_dep', TASK_STATUS.RUNNING));

      scheduler.rebuildWaitIndex(tasks);

      const depWaiters = scheduler.waitingByDependency.get('task_dep');
      expect(depWaiters?.has('task_a')).toBe(true);
      expect(depWaiters?.has('task_b')).toBe(true);
    });

    it('clears previous index on rebuild', () => {
      const tasks1 = new Map<string, Task>();
      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_dep']);
      tasks1.set('task_a', makeTask('task_a', TASK_STATUS.WAITING, makeRun('run_1', [wg])));
      scheduler.rebuildWaitIndex(tasks1);

      scheduler.rebuildWaitIndex(new Map());

      expect(scheduler.waitingByDependency.size).toBe(0);
    });
  });

  describe('scheduleWaitersForEvent', () => {
    // readyEvents is owned by the Orquestrator; here we stub it to assert routing.
    const alwaysReady = (task: Task): SwarmEvent[] => [makeEvent({ taskId: task.taskId })];

    it('schedules the waiter when readyEvents returns events', () => {
      const tasks = new Map<string, Task>();
      tasks.set('task_dep', makeTask('task_dep', TASK_STATUS.COMPLETED));
      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_dep']);
      tasks.set('task_waiting', makeTask('task_waiting', TASK_STATUS.WAITING, makeRun('run_1', [wg])));
      scheduler.rebuildWaitIndex(tasks);

      const event = makeEvent({ taskId: 'task_dep', type: SWARM_EVENT_TYPE.TASK_COMPLETED });
      let scheduledId = '';
      scheduler.scheduleWaitersForEvent(event, tasks, alwaysReady, (taskId) => {
        scheduledId = taskId;
      });

      expect(scheduledId).toBe('task_waiting');
    });

    it('does not schedule when readyEvents returns empty', () => {
      const tasks = new Map<string, Task>();
      tasks.set('task_dep', makeTask('task_dep', TASK_STATUS.RUNNING));
      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_dep', 'task_other']);
      tasks.set('task_waiting', makeTask('task_waiting', TASK_STATUS.WAITING, makeRun('run_1', [wg])));
      scheduler.rebuildWaitIndex(tasks);

      let scheduled = false;
      scheduler.scheduleWaitersForEvent(
        makeEvent({ taskId: 'task_dep', type: SWARM_EVENT_TYPE.TASK_COMPLETED }),
        tasks,
        () => [],
        () => {
          scheduled = true;
        },
      );
      expect(scheduled).toBe(false);
    });

    it('does not schedule when event has no taskId', () => {
      let scheduled = false;
      scheduler.scheduleWaitersForEvent(makeEvent({ taskId: undefined }), new Map(), alwaysReady, () => {
        scheduled = true;
      });
      expect(scheduled).toBe(false);
    });

    it('does not schedule when no waiters for the dependency', () => {
      let scheduled = false;
      scheduler.scheduleWaitersForEvent(
        makeEvent({ taskId: 'unknown_task', type: SWARM_EVENT_TYPE.TASK_COMPLETED }),
        new Map(),
        alwaysReady,
        () => {
          scheduled = true;
        },
      );
      expect(scheduled).toBe(false);
    });

    it('does not schedule when waiter is no longer WAITING', () => {
      const tasks = new Map<string, Task>();
      tasks.set('task_dep', makeTask('task_dep', TASK_STATUS.COMPLETED));
      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_dep']);
      tasks.set('task_waiting', makeTask('task_waiting', TASK_STATUS.RUNNING, makeRun('run_1', [wg])));
      scheduler.rebuildWaitIndex(tasks);

      let scheduled = false;
      scheduler.scheduleWaitersForEvent(
        makeEvent({ taskId: 'task_dep', type: SWARM_EVENT_TYPE.TASK_COMPLETED }),
        tasks,
        alwaysReady,
        () => {
          scheduled = true;
        },
      );
      expect(scheduled).toBe(false);
    });
  });

  describe('empty state', () => {
    it('rebuildWaitIndex with empty tasks map does not throw', () => {
      expect(() => scheduler.rebuildWaitIndex(new Map())).not.toThrow();
    });

    it('scheduleWaitersForEvent with empty tasks does not throw', () => {
      expect(() =>
        scheduler.scheduleWaitersForEvent(makeEvent(), new Map(), () => [], () => {}),
      ).not.toThrow();
    });
  });
});
