import { describe, it, expect, beforeEach } from 'vitest';
import { Task } from '../../domain/task.js';
import type {
  TaskOptions,
  SerializedTask,
  TaskChatMessage,
  AttachmentRef,
  TaskArtifact,
} from '../../domain/task.js';

const defaultOptions: TaskOptions = {
  taskId: 'task_test-123',
  title: 'Test Task',
  assignedTo: 'agent-1',
  depth: 0,
};

describe('Task constructor', () => {
  it('sets all options fields', () => {
    const task = new Task(defaultOptions);

    expect(task.taskId).toBe('task_test-123');
    expect(task.title).toBe('Test Task');
    expect(task.assignedTo).toBe('agent-1');
    expect(task.depth).toBe(0);
    expect(task.parentId).toBeUndefined();
    expect(task.runtimeConfig).toBeUndefined();
  });

  it('defaults status to PENDING', () => {
    const task = new Task(defaultOptions);
    expect(task.status).toBe('PENDING');
  });

  it('defaults subtaskIds to empty array', () => {
    const task = new Task(defaultOptions);
    expect(task.subtaskIds).toEqual([]);
  });

  it('defaults runs to empty array', () => {
    const task = new Task(defaultOptions);
    expect(task.runs).toEqual([]);
  });

  it('defaults chat to empty array', () => {
    const task = new Task(defaultOptions, false);
    expect(task.chat).toEqual([]);
  });

  it('defaults retryCount and technicalRetryCount to 0', () => {
    const task = new Task(defaultOptions);
    expect(task.retryCount).toBe(0);
    expect(task.technicalRetryCount).toBe(0);
  });

  it('defaults metrics to empty metrics', () => {
    const task = new Task(defaultOptions);
    expect(task.metrics).toEqual({
      durationMs: 0,
      tokens: { input: 0, output: 0, total: 0 },
      cost: 0,
    });
  });

  it('seeds initial chat message by default', () => {
    const task = new Task(defaultOptions);
    expect(task.chat).toHaveLength(1);
    expect(task.chat[0].role).toBe('user');
    expect(task.chat[0].type).toBe('text');
    expect(task.chat[0].text).toBe('Test Task');
  });

  it('does not seed initial chat message when seedInitialMessage=false', () => {
    const task = new Task(defaultOptions, false);
    expect(task.chat).toHaveLength(0);
  });

  it('includes attachments in seed message', () => {
    const attachments: AttachmentRef[] = [
      { id: 'att-1', originalName: 'file.txt', path: '/tmp/file.txt', sizeBytes: 100 },
    ];
    const task = new Task(defaultOptions, true, attachments);
    expect(task.chat[0].attachments).toEqual(attachments);
  });

  it('includes runtimeConfig in seed message', () => {
    const opts: TaskOptions = { ...defaultOptions, runtimeConfig: { model: 'fast', effort: 'low' } };
    const task = new Task(opts);
    expect(task.chat[0].runtimeConfig).toEqual({ model: 'fast', effort: 'low' });
  });

  it('sets parentId from options', () => {
    const opts: TaskOptions = { ...defaultOptions, parentId: 'task_parent-1' };
    const task = new Task(opts);
    expect(task.parentId).toBe('task_parent-1');
  });
});

describe('Task.serialize', () => {
  it('produces valid SerializedTask', () => {
    const task = new Task(defaultOptions);
    const serialized = task.serialize();

    expect(serialized.options.taskId).toBe('task_test-123');
    expect(serialized.status).toBe('PENDING');
    expect(Array.isArray(serialized.subtaskIds)).toBe(true);
    expect(Array.isArray(serialized.runs)).toBe(true);
    expect(serialized.retryCount).toBe(0);
    expect(serialized.technicalRetryCount).toBe(0);
    expect(serialized.metrics).toBeDefined();
  });

  it('includes modified fields', () => {
    const task = new Task(defaultOptions, false);
    task.status = 'RUNNING';
    task.subtaskIds.push('task_sub-1');
    task.retryCount = 2;
    task.piSessionFile = '/path/to/session';

    const serialized = task.serialize();
    expect(serialized.status).toBe('RUNNING');
    expect(serialized.subtaskIds).toEqual(['task_sub-1']);
    expect(serialized.retryCount).toBe(2);
    expect(serialized.piSessionFile).toBe('/path/to/session');
  });
});

describe('Task.fromSerialized', () => {
  it('reconstructs identical task from serialized data', () => {
    const original = new Task(defaultOptions, false);
    original.status = 'RUNNING';
    original.subtaskIds.push('task_sub-1', 'task_sub-2');
    original.retryCount = 3;
    original.piSessionFile = '/session';

    const serialized = original.serialize();
    const restored = Task.fromSerialized(serialized);

    expect(restored.taskId).toBe(original.taskId);
    expect(restored.title).toBe(original.title);
    expect(restored.status).toBe('RUNNING');
    expect(restored.subtaskIds).toEqual(['task_sub-1', 'task_sub-2']);
    expect(restored.retryCount).toBe(3);
    expect(restored.piSessionFile).toBe('/session');
  });

  it('handles missing optional fields gracefully', () => {
    const minimal: SerializedTask = {
      options: defaultOptions,
      status: 'PENDING',
      subtaskIds: [],
    };

    const task = Task.fromSerialized(minimal);
    expect(task.taskId).toBe('task_test-123');
    expect(task.chat).toEqual([]);
    expect(task.runs).toEqual([]);
    expect(task.artifacts).toEqual([]);
    expect(task.retryCount).toBe(0);
    expect(task.technicalRetryCount).toBe(0);
    expect(task.metrics).toBeDefined();
  });

  it('restores chat messages', () => {
    const msg: TaskChatMessage = {
      ts: '2025-01-01T00:00:00.000Z',
      role: 'assistant',
      type: 'text',
      text: 'Hello',
    };
    const serialized: SerializedTask = {
      options: defaultOptions,
      status: 'PENDING',
      subtaskIds: [],
      chat: [msg],
    };

    const task = Task.fromSerialized(serialized);
    expect(task.chat).toHaveLength(1);
    expect(task.chat[0].text).toBe('Hello');
  });
});

describe('Task status transitions', () => {
  let task: Task;

  beforeEach(() => {
    task = new Task(defaultOptions, false);
  });

  it('starts as PENDING', () => {
    expect(task.status).toBe('PENDING');
  });

  it('can transition to QUEUED', () => {
    task.status = 'QUEUED';
    expect(task.status).toBe('QUEUED');
  });

  it('can transition to RUNNING', () => {
    task.status = 'RUNNING';
    expect(task.status).toBe('RUNNING');
  });

  it('can transition to WAITING', () => {
    task.status = 'WAITING';
    expect(task.status).toBe('WAITING');
  });

  it('can transition to COMPLETED', () => {
    task.status = 'COMPLETED';
    expect(task.status).toBe('COMPLETED');
  });

  it('can transition to FAILED', () => {
    task.status = 'FAILED';
    expect(task.status).toBe('FAILED');
  });

  it('can transition to CANCELLED', () => {
    task.status = 'CANCELLED';
    expect(task.status).toBe('CANCELLED');
  });
});

describe('Task chat messages', () => {
  let task: Task;

  beforeEach(() => {
    task = new Task(defaultOptions, false);
  });

  it('appendChat adds message with correct role and type', () => {
    const msg = task.appendChat('assistant', 'text', 'Hi there');
    expect(task.chat).toHaveLength(1);
    expect(msg.role).toBe('assistant');
    expect(msg.type).toBe('text');
    expect(msg.text).toBe('Hi there');
  });

  it('appendChat includes timestamp', () => {
    const msg = task.appendChat('user', 'text', 'Hello');
    expect(msg.ts).toBeDefined();
    expect(new Date(msg.ts).getTime()).toBeGreaterThan(0);
  });

  it('appendChat includes eventId when provided', () => {
    const msg = task.appendChat('event', 'event', undefined, undefined, undefined, undefined, 'evt_abc');
    expect(msg.eventId).toBe('evt_abc');
  });

  it('appendChat includes attachments when provided', () => {
    const attachments: AttachmentRef[] = [
      { id: 'a1', originalName: 'f.txt', path: '/f.txt', sizeBytes: 50 },
    ];
    const msg = task.appendChat('user', 'text', 'See file', undefined, attachments);
    expect(msg.attachments).toEqual(attachments);
  });

  it('appendChat includes artifacts when provided', () => {
    const artifacts: TaskArtifact[] = [
      { description: 'output', fileType: 'json', path: '/out.json' },
    ];
    const msg = task.appendChat('assistant', 'artifact', undefined, undefined, undefined, artifacts);
    expect(msg.artifacts).toEqual(artifacts);
  });

  it('appendChat includes runtimeConfig when provided', () => {
    const msg = task.appendChat('user', 'text', 'Retry', { model: 'deep', effort: 'high' });
    expect(msg.runtimeConfig).toEqual({ model: 'deep', effort: 'high' });
  });

  it('appendAgentMessages adds multiple messages', () => {
    const msgs = task.appendAgentMessages([
      { type: 'text', text: 'First' },
      { type: 'text', text: 'Second' },
    ]);
    expect(task.chat).toHaveLength(2);
    expect(msgs).toHaveLength(2);
    expect(task.chat[0].role).toBe('assistant');
    expect(task.chat[1].role).toBe('assistant');
    expect(task.chat[0].text).toBe('First');
    expect(task.chat[1].text).toBe('Second');
  });

  it('appendAgentMessages includes artifacts', () => {
    const artifacts: TaskArtifact[] = [
      { description: 'code', fileType: 'ts', path: '/src.ts' },
    ];
    task.appendAgentMessages([
      { type: 'artifact', artifacts },
    ]);
    expect(task.chat[0].artifacts).toEqual(artifacts);
  });
});

describe('Task attachment handling', () => {
  it('TaskOptions accepts runtimeConfig', () => {
    const opts: TaskOptions = {
      taskId: 'task_1',
      title: 'T',
      assignedTo: 'a',
      depth: 0,
      runtimeConfig: { model: 'balanced', effort: 'medium' },
    };
    const task = new Task(opts, false);
    expect(task.runtimeConfig).toEqual({ model: 'balanced', effort: 'medium' });
  });

  it('resultMessages start empty', () => {
    const task = new Task(defaultOptions, false);
    expect(task.resultMessages).toEqual([]);
  });

  it('activeRunId is undefined by default', () => {
    const task = new Task(defaultOptions, false);
    expect(task.activeRunId).toBeUndefined();
  });
});

describe('Task metrics', () => {
  it('createEmptyMetrics returns zeroed metrics', () => {
    const task = new Task(defaultOptions, false);
    expect(task.metrics.tokens.input).toBe(0);
    expect(task.metrics.tokens.output).toBe(0);
    expect(task.metrics.tokens.total).toBe(0);
    expect(task.metrics.cost).toBe(0);
    expect(task.metrics.durationMs).toBe(0);
  });
});
