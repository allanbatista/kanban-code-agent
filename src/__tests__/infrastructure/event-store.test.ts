import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventStore } from '../../infrastructure/persistence/event-store.js';
import { PathSandbox } from '../../infrastructure/filesystem/sandbox.js';
import type { SwarmEvent } from '../../domain/events.js';

function createEvent(overrides: Partial<SwarmEvent> = {}): SwarmEvent {
  return {
    seq: overrides.seq ?? 1,
    eventId: overrides.eventId ?? 'evt_test-1',
    type: 'TASK_CREATED',
    taskId: overrides.taskId ?? 'task_test-1',
    ts: new Date().toISOString(),
    processedByTaskIds: [],
    ...overrides,
  };
}

function createStore(): { store: EventStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'es-'));
  const sandbox = new PathSandbox(dir);
  return { store: new EventStore(sandbox), dir };
}

function cleanup(dir: string) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

describe('EventStore', () => {
  describe('append + loadAll', () => {
    it('appends single event and loads it', () => {
      const { store, dir } = createStore();
      const event = createEvent();
      store.append(event);

      const all = store.loadAll();
      expect(all).toHaveLength(1);
      expect(all[0].eventId).toBe(event.eventId);
      expect(all[0].type).toBe('TASK_CREATED');
      cleanup(dir);
    });

    it('appends 100 events and loads all', () => {
      const { store, dir } = createStore();
      for (let i = 0; i < 100; i++) {
        store.append(createEvent({ seq: i + 1, eventId: `evt_${i}` }));
      }

      const all = store.loadAll();
      expect(all).toHaveLength(100);
      cleanup(dir);
    });

    it('empty store returns empty array', () => {
      const { store, dir } = createStore();
      expect(store.loadAll()).toEqual([]);
      cleanup(dir);
    });
  });

  describe('getByTaskId', () => {
    it('filters events by task ID', () => {
      const { store, dir } = createStore();
      store.append(createEvent({ eventId: 'evt_a', taskId: 'task_a' }));
      store.append(createEvent({ eventId: 'evt_b', taskId: 'task_b' }));
      store.append(createEvent({ eventId: 'evt_c', taskId: 'task_a' }));

      const taskAEvents = store.getByTaskId('task_a');
      expect(taskAEvents).toHaveLength(2);
      expect(taskAEvents.map((e) => e.eventId)).toEqual(['evt_a', 'evt_c']);
      cleanup(dir);
    });

    it('returns empty array for unknown task ID', () => {
      const { store, dir } = createStore();
      store.append(createEvent({ eventId: 'evt_a', taskId: 'task_a' }));

      expect(store.getByTaskId('task_unknown')).toEqual([]);
      cleanup(dir);
    });
  });

  describe('getLatestByTaskId', () => {
    it('returns most recent event for task', () => {
      const { store, dir } = createStore();
      store.append(createEvent({ seq: 1, eventId: 'evt_1', taskId: 'task_x' }));
      store.append(createEvent({ seq: 2, eventId: 'evt_2', taskId: 'task_x' }));
      store.append(createEvent({ seq: 3, eventId: 'evt_3', taskId: 'task_x' }));

      const latest = store.getLatestByTaskId('task_x');
      expect(latest?.eventId).toBe('evt_3');
      cleanup(dir);
    });

    it('returns undefined for unknown task', () => {
      const { store, dir } = createStore();
      expect(store.getLatestByTaskId('no_task')).toBeUndefined();
      cleanup(dir);
    });
  });

  describe('count', () => {
    it('returns accurate count', () => {
      const { store, dir } = createStore();
      expect(store.count()).toBe(0);

      store.append(createEvent());
      expect(store.count()).toBe(1);

      store.append(createEvent());
      store.append(createEvent());
      expect(store.count()).toBe(3);
      cleanup(dir);
    });
  });

  describe('resilience', () => {
    it('ignores truncated last line', () => {
      const { store, dir } = createStore();
      const logPath = join(dir, '.swarm', 'events', 'current.jsonl');

      // Write 2 valid lines and 1 truncated (no newline, incomplete JSON)
      const { mkdirSync } = require('node:fs');
      mkdirSync(join(dir, '.swarm', 'events'), { recursive: true });
      writeFileSync(logPath, JSON.stringify(createEvent({ eventId: 'evt_1' })) + '\n' +
                          JSON.stringify(createEvent({ eventId: 'evt_2' })) + '\n' +
                          '{ "broken": true, "miss');

      const events = store.loadAll();
      expect(events).toHaveLength(2);
      expect(events[0].eventId).toBe('evt_1');
      expect(events[1].eventId).toBe('evt_2');
      cleanup(dir);
    });

    it('handles empty last line gracefully', () => {
      const { store, dir } = createStore();
      const logPath = join(dir, '.swarm', 'events', 'current.jsonl');
      const { mkdirSync } = require('node:fs');
      mkdirSync(join(dir, '.swarm', 'events'), { recursive: true });
      writeFileSync(logPath, JSON.stringify(createEvent({ eventId: 'evt_1' })) + '\n\n');

      const events = store.loadAll();
      expect(events).toHaveLength(1);
      cleanup(dir);
    });
  });
});
