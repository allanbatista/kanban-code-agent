import { describe, it, expect, beforeEach } from 'vitest';
import { Scheduler } from '../../application/scheduler.js';
import { Task } from '../../domain/task.js';
import { TASK_STATUS, SWARM_EVENT_TYPE, WAIT_GROUP_MODE, WAIT_GROUP_STATUS } from '../../domain/types.js';
import type { SwarmEvent } from '../../domain/events.js';
import type { TaskRun } from '../../domain/run.js';
import type { WaitGroup } from '../../domain/wait-group.js';

function makeRun(runId: string, waitGroups: WaitGroup[] = []): TaskRun {
  return {
    runId,
    status: 'WAITING',
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

function makeTask(id: string, status = 'WAITING' as string, run?: TaskRun): Task {
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

      const waiters = (scheduler as any).waitingByDependency;
      expect(waiters.get('task_sub_a')?.has('task_1')).toBe(true);
      expect(waiters.get('task_sub_b')?.has('task_1')).toBe(true);
    });

    it('ignores tasks not in WAITING status', () => {
      const tasks = new Map<string, Task>();
      tasks.set('task_1', makeTask('task_1', TASK_STATUS.RUNNING));
      tasks.set('task_2', makeTask('task_2', TASK_STATUS.COMPLETED));

      scheduler.rebuildWaitIndex(tasks);

      const waiters = (scheduler as any).waitingByDependency;
      expect(waiters.size).toBe(0);
    });

    it('ignores WAITING tasks without an active run', () => {
      const tasks = new Map<string, Task>();
      const task = makeTask('task_1', TASK_STATUS.WAITING);
      tasks.set('task_1', task);

      scheduler.rebuildWaitIndex(tasks);

      const waiters = (scheduler as any).waitingByDependency;
      expect(waiters.size).toBe(0);
    });

    it('ignores WAITING tasks whose run is not WAITING', () => {
      const tasks = new Map<string, Task>();
      const run = makeRun('run_1');
      run.status = 'COMPLETED';
      const task = makeTask('task_1', TASK_STATUS.WAITING, run);
      tasks.set('task_1', task);

      scheduler.rebuildWaitIndex(tasks);

      const waiters = (scheduler as any).waitingByDependency;
      expect(waiters.size).toBe(0);
    });

    it('ignores PROCESSED wait groups', () => {
      const tasks = new Map<string, Task>();
      const waitGroup = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_sub_a'], WAIT_GROUP_STATUS.PROCESSED);
      const run = makeRun('run_1', [waitGroup]);
      const task = makeTask('task_1', TASK_STATUS.WAITING, run);
      tasks.set('task_1', task);

      scheduler.rebuildWaitIndex(tasks);

      const waiters = (scheduler as any).waitingByDependency;
      expect(waiters.size).toBe(0);
    });

    it('multiple waiters index correctly for single dependency', () => {
      const tasks = new Map<string, Task>();
      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_dep']);
      const run1 = makeRun('run_1', [wg]);
      const run2 = makeRun('run_2', [wg]);
      tasks.set('task_a', makeTask('task_a', TASK_STATUS.WAITING, run1));
      tasks.set('task_b', makeTask('task_b', TASK_STATUS.WAITING, run2));
      tasks.set('task_dep', makeTask('task_dep', TASK_STATUS.RUNNING));

      scheduler.rebuildWaitIndex(tasks);

      const waiters = (scheduler as any).waitingByDependency;
      const depWaiters = waiters.get('task_dep');
      expect(depWaiters?.has('task_a')).toBe(true);
      expect(depWaiters?.has('task_b')).toBe(true);
    });

    it('clears previous index on rebuild', () => {
      const tasks1 = new Map<string, Task>();
      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_dep']);
      tasks1.set('task_a', makeTask('task_a', TASK_STATUS.WAITING, makeRun('run_1', [wg])));
      scheduler.rebuildWaitIndex(tasks1);

      const tasks2 = new Map<string, Task>();
      scheduler.rebuildWaitIndex(tasks2);

      const waiters = (scheduler as any).waitingByDependency;
      expect(waiters.size).toBe(0);
    });
  });

  describe('scheduleWaitersForEvent', () => {
    it('calls scheduleFn when WAIT_ALL dependencies all complete', () => {
      const tasks = new Map<string, Task>();
      tasks.set('task_dep', makeTask('task_dep', TASK_STATUS.COMPLETED));

      const event = makeEvent({ taskId: 'task_dep', type: SWARM_EVENT_TYPE.TASK_COMPLETED });

      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_dep']);
      tasks.set('task_waiting', makeTask('task_waiting', TASK_STATUS.WAITING, makeRun('run_1', [wg])));

      scheduler.rebuildWaitIndex(tasks);

      let scheduled = false;
      let scheduledId = '';
      scheduler.scheduleWaitersForEvent(event, tasks, (taskId) => {
        scheduled = true;
        scheduledId = taskId;
      });

      expect(scheduled).toBe(true);
      expect(scheduledId).toBe('task_waiting');
    });

    it('does not schedule when event has no taskId', () => {
      const tasks = new Map<string, Task>();
      const event = makeEvent({ taskId: undefined });
      let scheduled = false;
      scheduler.scheduleWaitersForEvent(event, tasks, () => { scheduled = true; });
      expect(scheduled).toBe(false);
    });

    it('does not schedule when no waiters for the dependency', () => {
      const tasks = new Map<string, Task>();
      const event = makeEvent({ taskId: 'unknown_task', type: SWARM_EVENT_TYPE.TASK_COMPLETED });
      let scheduled = false;
      scheduler.scheduleWaitersForEvent(event, tasks, () => { scheduled = true; });
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
        () => { scheduled = true; },
      );
      expect(scheduled).toBe(false);
    });
  });

  describe('getReadyEvents', () => {
    it('returns empty array when task has no active run', () => {
      const tasks = new Map<string, Task>();
      const task = makeTask('task_1', TASK_STATUS.WAITING);
      const events = [makeEvent({ taskId: 'task_sub', type: SWARM_EVENT_TYPE.TASK_COMPLETED })];

      const result = scheduler.getReadyEvents(task, events, tasks);
      expect(result).toEqual([]);
    });

    it('returns empty array when run is not WAITING', () => {
      const tasks = new Map<string, Task>();
      const run = makeRun('run_1');
      run.status = 'COMPLETED';
      const task = makeTask('task_1', TASK_STATUS.WAITING, run);
      const events = [makeEvent({ taskId: 'task_sub', type: SWARM_EVENT_TYPE.TASK_COMPLETED })];

      const result = scheduler.getReadyEvents(task, events, tasks);
      expect(result).toEqual([]);
    });

    it('returns failed event when dependency fails', () => {
      const tasks = new Map<string, Task>();
      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_sub']);
      const run = makeRun('run_1', [wg]);
      const task = makeTask('task_1', TASK_STATUS.WAITING, run);
      tasks.set('task_sub', makeTask('task_sub', TASK_STATUS.FAILED));

      const events = [makeEvent({ taskId: 'task_sub', type: SWARM_EVENT_TYPE.TASK_FAILED })];
      const result = scheduler.getReadyEvents(task, events, tasks);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe(SWARM_EVENT_TYPE.TASK_FAILED);
    });

    it('returns cancelled event when dependency is cancelled', () => {
      const tasks = new Map<string, Task>();
      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_sub']);
      const run = makeRun('run_1', [wg]);
      const task = makeTask('task_1', TASK_STATUS.WAITING, run);
      tasks.set('task_sub', makeTask('task_sub', TASK_STATUS.CANCELLED));

      const events = [makeEvent({ taskId: 'task_sub', type: SWARM_EVENT_TYPE.TASK_CANCELLED })];
      const result = scheduler.getReadyEvents(task, events, tasks);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe(SWARM_EVENT_TYPE.TASK_CANCELLED);
    });

    it('returns first event for ON_DEMAND mode', () => {
      const tasks = new Map<string, Task>();
      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.ON_DEMAND, ['task_sub']);
      const run = makeRun('run_1', [wg]);
      const task = makeTask('task_1', TASK_STATUS.WAITING, run);
      tasks.set('task_sub', makeTask('task_sub', TASK_STATUS.COMPLETED));

      const events = [
        makeEvent({ eventId: 'evt_a', taskId: 'task_sub', type: SWARM_EVENT_TYPE.TASK_COMPLETED }),
        makeEvent({ eventId: 'evt_b', taskId: 'task_sub', type: SWARM_EVENT_TYPE.TASK_COMPLETED }),
      ];
      const result = scheduler.getReadyEvents(task, events, tasks);
      expect(result).toHaveLength(1);
      expect(result[0].eventId).toBe('evt_a');
    });

    it('returns all terminal events for WAIT_ALL when all deps completed', () => {
      const tasks = new Map<string, Task>();
      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_sub_a', 'task_sub_b']);
      const run = makeRun('run_1', [wg]);
      const task = makeTask('task_1', TASK_STATUS.WAITING, run);
      tasks.set('task_sub_a', makeTask('task_sub_a', TASK_STATUS.COMPLETED));
      tasks.set('task_sub_b', makeTask('task_sub_b', TASK_STATUS.COMPLETED));

      const events = [
        makeEvent({ eventId: 'evt_a', taskId: 'task_sub_a', type: SWARM_EVENT_TYPE.TASK_COMPLETED }),
        makeEvent({ eventId: 'evt_b', taskId: 'task_sub_b', type: SWARM_EVENT_TYPE.TASK_COMPLETED }),
      ];
      const result = scheduler.getReadyEvents(task, events, tasks);
      expect(result).toHaveLength(2);
    });

    it('returns empty for WAIT_ALL when not all deps completed', () => {
      const tasks = new Map<string, Task>();
      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_sub_a', 'task_sub_b']);
      const run = makeRun('run_1', [wg]);
      const task = makeTask('task_1', TASK_STATUS.WAITING, run);
      tasks.set('task_sub_a', makeTask('task_sub_a', TASK_STATUS.COMPLETED));
      tasks.set('task_sub_b', makeTask('task_sub_b', TASK_STATUS.RUNNING));

      const events = [makeEvent({ taskId: 'task_sub_a', type: SWARM_EVENT_TYPE.TASK_COMPLETED })];
      const result = scheduler.getReadyEvents(task, events, tasks);
      expect(result).toEqual([]);
    });

    it('returns empty when events are already processed', () => {
      const tasks = new Map<string, Task>();
      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_sub']);
      const run = makeRun('run_1', [wg]);
      const task = makeTask('task_1', TASK_STATUS.WAITING, run);
      tasks.set('task_sub', makeTask('task_sub', TASK_STATUS.COMPLETED));

      const events = [makeEvent({
        taskId: 'task_sub',
        type: SWARM_EVENT_TYPE.TASK_COMPLETED,
        processedByTaskIds: ['task_1'],
      })];
      const result = scheduler.getReadyEvents(task, events, tasks);
      expect(result).toEqual([]);
    });

    it('skips PROCESSED wait groups', () => {
      const tasks = new Map<string, Task>();
      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_sub'], WAIT_GROUP_STATUS.PROCESSED);
      const run = makeRun('run_1', [wg]);
      const task = makeTask('task_1', TASK_STATUS.WAITING, run);
      tasks.set('task_sub', makeTask('task_sub', TASK_STATUS.COMPLETED));

      const events = [makeEvent({ taskId: 'task_sub', type: SWARM_EVENT_TYPE.TASK_COMPLETED })];
      const result = scheduler.getReadyEvents(task, events, tasks);
      expect(result).toEqual([]);
    });

    it('ignores unrelated events', () => {
      const tasks = new Map<string, Task>();
      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_sub']);
      const run = makeRun('run_1', [wg]);
      const task = makeTask('task_1', TASK_STATUS.WAITING, run);
      tasks.set('task_sub', makeTask('task_sub', TASK_STATUS.RUNNING));

      const events = [makeEvent({ taskId: 'other_task', type: SWARM_EVENT_TYPE.TASK_COMPLETED })];
      const result = scheduler.getReadyEvents(task, events, tasks);
      expect(result).toEqual([]);
    });

    it('failed event takes priority over completed events in same group', () => {
      const tasks = new Map<string, Task>();
      const wg = makeWaitGroup('wg1', WAIT_GROUP_MODE.WAIT_ALL, ['task_sub_a', 'task_sub_b']);
      const run = makeRun('run_1', [wg]);
      const task = makeTask('task_1', TASK_STATUS.WAITING, run);
      tasks.set('task_sub_a', makeTask('task_sub_a', TASK_STATUS.COMPLETED));
      tasks.set('task_sub_b', makeTask('task_sub_b', TASK_STATUS.FAILED));

      const events = [
        makeEvent({ eventId: 'evt_ok', taskId: 'task_sub_a', type: SWARM_EVENT_TYPE.TASK_COMPLETED }),
        makeEvent({ eventId: 'evt_fail', taskId: 'task_sub_b', type: SWARM_EVENT_TYPE.TASK_FAILED }),
      ];
      const result = scheduler.getReadyEvents(task, events, tasks);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe(SWARM_EVENT_TYPE.TASK_FAILED);
    });
  });

  describe('empty state', () => {
    it('rebuildWaitIndex with empty tasks map does not throw', () => {
      expect(() => scheduler.rebuildWaitIndex(new Map())).not.toThrow();
    });

    it('scheduleWaitersForEvent with empty tasks does not throw', () => {
      expect(() =>
        scheduler.scheduleWaitersForEvent(makeEvent(), new Map(), () => {}),
      ).not.toThrow();
    });
  });
});
