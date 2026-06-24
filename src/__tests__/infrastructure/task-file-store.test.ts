import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskFileStore } from '../../infrastructure/persistence/task-file-store.js';
import { PathSandbox } from '../../infrastructure/filesystem/sandbox.js';
import { Task } from '../../domain/task.js';
import type { SerializedTask, TaskChatMessage, TaskArtifact } from '../../domain/task.js';

function createStore(): { store: TaskFileStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tfs-'));
  const sandbox = new PathSandbox(dir);
  return { store: new TaskFileStore(sandbox), dir };
}

function cleanup(dir: string) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

function makeTask(taskId: string): Task {
  return new Task({ taskId, title: 'Test', assignedTo: 'agent-1', depth: 0 }, false);
}

describe('TaskFileStore', () => {
  describe('task YAML', () => {
    it('saves and loads task metadata', () => {
      const { store, dir } = createStore();
      const task = makeTask('task_1');
      task.status = 'RUNNING';

      store.saveTaskYaml('task_1', task.serialize());
      const loaded = store.loadTaskYaml('task_1');

      expect(loaded).not.toBeNull();
      expect(loaded!.options.taskId).toBe('task_1');
      expect(loaded!.status).toBe('RUNNING');
      cleanup(dir);
    });

    it('returns null for nonexistent file', () => {
      const { store, dir } = createStore();
      expect(store.loadTaskYaml('task_nonexistent')).toBeNull();
      cleanup(dir);
    });

    it('directory structure is created automatically', () => {
      const { store, dir } = createStore();
      const task = makeTask('task_1');

      store.saveTaskYaml('task_1', task.serialize());

      const yamlPath = join(dir, '.swarm', 'tasks', 'task_1', 'task.yml');
      expect(existsSync(yamlPath)).toBe(true);
      cleanup(dir);
    });

    it('overwrites existing task file', () => {
      const { store, dir } = createStore();
      const task = makeTask('task_1');

      task.status = 'PENDING';
      store.saveTaskYaml('task_1', task.serialize());

      task.status = 'COMPLETED';
      store.saveTaskYaml('task_1', task.serialize());

      const loaded = store.loadTaskYaml('task_1');
      expect(loaded!.status).toBe('COMPLETED');
      cleanup(dir);
    });
  });

  describe('chat JSONL', () => {
    it('saves and loads chat messages', () => {
      const { store, dir } = createStore();
      const messages: TaskChatMessage[] = [
        { ts: '2025-01-01T00:00:00Z', role: 'user', type: 'text', text: 'Hello' },
        { ts: '2025-01-01T00:00:01Z', role: 'assistant', type: 'text', text: 'Hi' },
      ];

      store.saveChat('task_1', messages);

      const loaded = store.loadChat('task_1');
      expect(loaded).toHaveLength(2);
      expect(loaded[0].text).toBe('Hello');
      expect(loaded[1].text).toBe('Hi');
      cleanup(dir);
    });

    it('returns empty array for nonexistent file', () => {
      const { store, dir } = createStore();
      expect(store.loadChat('task_nonexistent')).toEqual([]);
      cleanup(dir);
    });

    it('overwrites with the full chat snapshot on each saveChat call', () => {
      const { store, dir } = createStore();
      // Callers always pass the complete in-memory chat; saveChat rewrites the
      // file so messages are never duplicated across persists.
      store.saveChat('task_1', [
        { ts: 't1', role: 'user', type: 'text', text: 'First' },
      ]);
      store.saveChat('task_1', [
        { ts: 't1', role: 'user', type: 'text', text: 'First' },
        { ts: 't2', role: 'assistant', type: 'text', text: 'Second' },
      ]);

      const loaded = store.loadChat('task_1');
      expect(loaded).toHaveLength(2);
      expect(loaded[0].text).toBe('First');
      expect(loaded[1].text).toBe('Second');
      cleanup(dir);
    });
  });

  describe('copyAttachment', () => {
    it('copies file with UUID prefix', () => {
      const { store, dir } = createStore();
      const sourcePath = join(dir, 'original.txt');
      writeFileSync(sourcePath, 'attachment content');

      const destRel = store.copyAttachment('task_1', sourcePath);

      expect(destRel).toMatch(/\.swarm\/tasks\/task_1\/attachments\/[0-9a-f-]+_original\.txt$/);

      const fullDest = join(dir, destRel);
      expect(existsSync(fullDest)).toBe(true);
      expect(readFileSync(fullDest, 'utf-8')).toBe('attachment content');
      cleanup(dir);
    });
  });

  describe('ensureTaskDir', () => {
    it('creates task directory and attachments subfolder', () => {
      const { store, dir } = createStore();

      store.ensureTaskDir('task_99');

      const taskDir = join(dir, '.swarm', 'tasks', 'task_99');
      const attachmentsDir = join(taskDir, 'attachments');

      expect(existsSync(taskDir)).toBe(true);
      expect(existsSync(attachmentsDir)).toBe(true);
      cleanup(dir);
    });
  });

  describe('session JSONL', () => {
    it('saves session lines', () => {
      const { store, dir } = createStore();

      store.saveSession('task_1', ['line1', 'line2']);

      const sessionPath = join(dir, '.swarm', 'tasks', 'task_1', 'session.jsonl');
      expect(existsSync(sessionPath)).toBe(true);
      cleanup(dir);
    });
  });

  describe('artifacts YAML', () => {
    it('saves artifact manifest', () => {
      const { store, dir } = createStore();
      const artifacts: TaskArtifact[] = [
        { description: 'result', fileType: 'json', path: '/out.json' },
      ];

      store.saveArtifacts('task_1', artifacts);

      const artifactsPath = join(dir, '.swarm', 'tasks', 'task_1', 'artifacts.yaml');
      expect(existsSync(artifactsPath)).toBe(true);

      const content = JSON.parse(readFileSync(artifactsPath, 'utf-8'));
      expect(content).toEqual(artifacts);
      cleanup(dir);
    });
  });
});
