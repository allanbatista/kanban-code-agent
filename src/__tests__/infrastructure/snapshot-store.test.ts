import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SnapshotStore } from '../../infrastructure/persistence/snapshot-store.js';
import { PathSandbox } from '../../infrastructure/filesystem/sandbox.js';
import { Task } from '../../domain/task.js';
import type { SwarmEvent } from '../../domain/events.js';

function createTask(id: string, title: string): Task {
  return new Task({ taskId: id, title, assignedTo: 'agent-1', depth: 0 }, false);
}

function createEvent(overrides: Partial<SwarmEvent> = {}): SwarmEvent {
  return {
    seq: overrides.seq ?? 1,
    eventId: overrides.eventId ?? 'evt_1',
    type: 'TASK_CREATED',
    taskId: 'task_1',
    ts: new Date().toISOString(),
    processedByTaskIds: [],
    ...overrides,
  };
}

function createStore(): { store: SnapshotStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ss-'));
  const sandbox = new PathSandbox(dir);
  return { store: new SnapshotStore(sandbox), dir };
}

function cleanup(dir: string) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

describe('SnapshotStore', () => {
  describe('saveSnapshot + loadSnapshot', () => {
    it('roundtrips snapshot data', () => {
      const { store, dir } = createStore();

      const tasks = new Map<string, Task>();
      const t1 = createTask('task_1', 'Task 1');
      t1.status = 'RUNNING';
      tasks.set('task_1', t1);

      const events = [createEvent()];
      store.saveSnapshot(tasks, events, ['task_1'], 2);

      const loaded = store.loadSnapshot();
      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe(1);
      expect(loaded!.rootTaskIds).toEqual(['task_1']);
      expect(loaded!.nextSeq).toBe(2);
      expect(loaded!.tasks).toHaveLength(1);
      expect(loaded!.tasks[0].options.taskId).toBe('task_1');
      expect(loaded!.tasks[0].status).toBe('RUNNING');
      expect(loaded!.events).toHaveLength(1);
      expect(loaded!.timestamp).toBeDefined();
      cleanup(dir);
    });

    it('backup is created on save when file exists', () => {
      const { store, dir } = createStore();

      const tasks = new Map<string, Task>();
      tasks.set('task_1', createTask('task_1', 'T1'));

      store.saveSnapshot(tasks, [], ['task_1'], 1);
      store.saveSnapshot(tasks, [], ['task_1'], 2);

      const snapshotPath = join(dir, '.swarm', 'state.snapshot.json');
      const bakPath = snapshotPath + '.bak';
      expect(existsSync(bakPath)).toBe(true);
      cleanup(dir);
    });

    it('version field is present', () => {
      const { store, dir } = createStore();

      const tasks = new Map<string, Task>();
      store.saveSnapshot(tasks, [], [], 0);

      const loaded = store.loadSnapshot();
      expect(loaded!.version).toBe(1);
      cleanup(dir);
    });

    it('load from empty returns null', () => {
      const { store, dir } = createStore();
      expect(store.loadSnapshot()).toBeNull();
      cleanup(dir);
    });

    it('corrupted snapshot file returns null', () => {
      const { store, dir } = createStore();
      const snapshotPath = join(dir, '.swarm', 'state.snapshot.json');
      const { mkdirSync } = require('node:fs');
      mkdirSync(join(dir, '.swarm'), { recursive: true });
      writeFileSync(snapshotPath, 'not valid json {{{');

      expect(store.loadSnapshot()).toBeNull();
      cleanup(dir);
    });

    it('missing required fields returns null', () => {
      const { store, dir } = createStore();
      const snapshotPath = join(dir, '.swarm', 'state.snapshot.json');
      const { mkdirSync } = require('node:fs');
      mkdirSync(join(dir, '.swarm'), { recursive: true });
      writeFileSync(snapshotPath, JSON.stringify({ version: 1 }));

      expect(store.loadSnapshot()).toBeNull();
      cleanup(dir);
    });

    it('backup on empty store does nothing', () => {
      const { store, dir } = createStore();
      expect(() => store.backup()).not.toThrow();
      cleanup(dir);
    });

    it('backup preserves existing snapshot', () => {
      const { store, dir } = createStore();

      const tasks = new Map<string, Task>();
      tasks.set('task_1', createTask('task_1', 'T1'));
      store.saveSnapshot(tasks, [], ['task_1'], 1);

      store.backup();

      const snapshotPath = join(dir, '.swarm', 'state.snapshot.json');
      const bakPath = snapshotPath + '.bak';
      expect(existsSync(bakPath)).toBe(true);

      const bakContent = JSON.parse(readFileSync(bakPath, 'utf-8'));
      expect(bakContent.rootTaskIds).toEqual(['task_1']);
      cleanup(dir);
    });
  });
});
