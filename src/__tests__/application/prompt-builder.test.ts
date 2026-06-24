import { describe, it, expect, beforeEach } from 'vitest';
import { buildPrompt } from '../../application/prompt-builder.js';
import { Task } from '../../domain/task.js';
import { SWARM_EVENT_TYPE } from '../../domain/types.js';
import type { TaskMetadata } from '../../domain/task.js';
import type { SwarmEvent } from '../../domain/events.js';
import type { TaskRun } from '../../domain/run.js';

function makeBaseMetadata(overrides: Partial<TaskMetadata> = {}): TaskMetadata {
  return {
    taskId: 'task_test-1',
    title: 'Test Task',
    assignedTo: 'agent-1',
    parentId: undefined,
    status: 'RUNNING',
    depth: 0,
    maxDepth: 5,
    canCreateSubtasks: true,
    subtaskIds: [],
    chatFile: '.swarm/tasks/task_test-1/chat.jsonl',
    attachmentsDir: '.swarm/tasks/task_test-1/attachments',
    artifactsDir: '.swarm/tasks/task_test-1/artifacts',
    artifactsFile: '.swarm/tasks/task_test-1/artifacts.yaml',
    runtimeConfig: { model: 'fast', effort: 'off' },
    allowedModels: {
      fast: { provider: 'openrouter', modelId: 'test-model', description: 'r' },
      balanced: { provider: 'openrouter', modelId: 'test-model-2', description: 'balanced' },
      deep: { provider: 'openrouter', modelId: 'test-model-3', description: 'deep' },
    },
    allowedEfforts: ['off', 'low', 'medium', 'high', 'xhigh'],
    retryCount: 0,
    technicalRetryCount: 0,
    maxRetries: 3,
    maxTechnicalRetries: 2,
    maxSubtasksPerTask: 10,
    runTimeoutMs: 300000,
    activeRunId: undefined,
    runs: [],
    taskChat: [],
    artifacts: [],
    metrics: { durationMs: 0, tokens: { input: 0, output: 0, cache: 0, total: 0 }, cost: 0 },
    ...overrides,
  };
}

function makeEvent(overrides: Partial<SwarmEvent> = {}): SwarmEvent {
  return {
    seq: 1,
    eventId: 'evt_1',
    type: SWARM_EVENT_TYPE.TASK_COMPLETED,
    taskId: 'task_sub-1',
    runId: 'run_sub-1',
    ts: '2025-01-01T00:00:00.000Z',
    messages: [{ ts: '2025-01-01T00:00:00.000Z', role: 'assistant', type: 'text', text: 'Resultado' }],
    processedByTaskIds: [],
    payload: { key: 'value' },
    ...overrides,
  };
}

describe('buildPrompt', () => {
  let task: Task;
  let metadata: TaskMetadata;

  beforeEach(() => {
    task = new Task({ taskId: 'task_test-1', title: 'Hello World', assignedTo: 'agent-1', depth: 0 }, true);
    metadata = makeBaseMetadata({ taskId: task.taskId, title: task.title });
  });

  describe('idempotence', () => {
    it('same input produces identical prompt string', () => {
      const result1 = buildPrompt(task, metadata, [], 60);
      const result2 = buildPrompt(task, metadata, [], 60);
      expect(result1).toBe(result2);
    });

    it('same input with trigger events produces identical output', () => {
      const events = [makeEvent()];
      const result1 = buildPrompt(task, metadata, events, 60);
      const result2 = buildPrompt(task, metadata, events, 60);
      expect(result1).toBe(result2);
    });
  });

  describe('includes metadata', () => {
    it('contains task title in prompt', () => {
      const prompt = buildPrompt(task, metadata, [], 60);
      expect(prompt).toContain('Hello World');
    });

    it('contains subtask section when subtasks exist', () => {
      task.subtaskIds.push('task_sub-1');
      metadata.subtaskSummary = '- task_sub-1 Sub (agent-1) [RUNNING]: sem mensagens';
      const prompt = buildPrompt(task, metadata, [], 60);
      expect(prompt).toContain('Subtasks:');
    });

    it('contains "Sem subtasks" when canCreateSubtasks=false', () => {
      metadata.canCreateSubtasks = false;
      const prompt = buildPrompt(task, metadata, [], 60);
      expect(prompt).toContain('Sem subtasks.');
    });

    it('contains instruction to return structured JSON', () => {
      const prompt = buildPrompt(task, metadata, [], 60);
      expect(prompt).toContain('JSON estruturado');
    });
  });

  describe('includes trigger events', () => {
    it('mentions "inicio ou retomada" when no trigger events', () => {
      const prompt = buildPrompt(task, metadata, [], 60);
      expect(prompt).toContain('inicio ou retomada sem novo evento.');
    });

    it('contains event details when trigger events present', () => {
      const events = [makeEvent()];
      const prompt = buildPrompt(task, metadata, events, 60);
      expect(prompt).toContain('evt_1');
      expect(prompt).toContain('concluida');
    });

    it('contains fallback payload for events without explicit payload', () => {
      const events = [makeEvent({ payload: undefined })];
      const prompt = buildPrompt(task, metadata, events, 60);
      expect(prompt).toContain('payload=');
    });

    it('uses "falhou" for failed events', () => {
      const events = [makeEvent({ type: SWARM_EVENT_TYPE.TASK_FAILED })];
      const prompt = buildPrompt(task, metadata, events, 60);
      expect(prompt).toContain('falhou');
    });

    it('uses "cancelada" for cancelled events', () => {
      const events = [makeEvent({ type: SWARM_EVENT_TYPE.TASK_CANCELLED })];
      const prompt = buildPrompt(task, metadata, events, 60);
      expect(prompt).toContain('cancelada');
    });
  });

  describe('includes agent role', () => {
    it('contains task title which is used by system prompt', () => {
      const prompt = buildPrompt(task, metadata, [], 60);
      // The prompt itself is a string; the agent role is appended by PiAgentClient
      // We just verify the prompt is not empty and contains the title
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('Tarefa:');
    });
  });

  describe('no side effects', () => {
    it('does not mutate task object', () => {
      const chatLengthBefore = task.chat.length;
      const subtaskIdsBefore = [...task.subtaskIds];
      const statusBefore = task.status;

      buildPrompt(task, metadata, [], 60);

      expect(task.chat).toHaveLength(chatLengthBefore);
      expect(task.subtaskIds).toEqual(subtaskIdsBefore);
      expect(task.status).toBe(statusBefore);
    });

    it('does not mutate metadata object', () => {
      const metadataClone = structuredClone(metadata);
      buildPrompt(task, metadata, [], 60);
      expect(metadata).toEqual(metadataClone);
    });

    it('does not mutate trigger events', () => {
      const events = [makeEvent()];
      const eventsClone = structuredClone(events);
      buildPrompt(task, metadata, events, 60);
      expect(events).toEqual(eventsClone);
    });
  });

  describe('run summary', () => {
    it('shows "Sem runs" when no runs', () => {
      const prompt = buildPrompt(task, metadata, [], 60);
      expect(prompt).toContain('Sem runs.');
    });

    it('includes run information when runs exist', () => {
      const run: TaskRun = {
        runId: 'run_1',
        status: 'RUNNING',
        epoch: 1,
        waitGroups: [],
        resultMessages: [],
        createdAt: '2025-01-01T00:00:00.000Z',
      };
      // buildPrompt reads from task.runs, not metadata.runs
      task.runs = [run];
      const prompt = buildPrompt(task, metadata, [], 60);
      expect(prompt).toContain('run_1');
      expect(prompt).toContain('RUNNING');
    });
  });

  describe('chat messages', () => {
    it('includes recent chat messages', () => {
      const prompt = buildPrompt(task, metadata, [], 60);
      expect(prompt).toContain('Task chat:');
      // Task was created with seedInitialMessage=true -> 1 chat message with title
      expect(prompt).toContain('Hello World');
    });

    it('truncates chat to maxPromptChatMessages', () => {
      // Seed: 1 message. Add many more.
      for (let i = 0; i < 10; i++) {
        task.appendChat('assistant', 'text', `Message ${i}`);
      }
      // 11 messages total, max 5
      const prompt = buildPrompt(task, metadata, [], 5);

      // Should only contain last 5 messages from chat tail
      const lines = prompt.split('\n');
      const chatLines = lines.filter((l) => l.trim().startsWith('- '));
      // 1 seed + 10 appended = 11. With max=5, only 5 lines appear
      // But the seed message "Hello World" is at position 0, tail shows last 5
      // Messages: 0=seed, 1..10=assistant. Tail of 5 = messages 6..10
      expect(prompt).toContain('Message 6');
      expect(prompt).not.toContain('Message 1');
      expect(prompt).not.toContain('Message 2');
    });
  });

  describe('formatChatMessage within buildPrompt', () => {
    it('formats attachments in chat', () => {
      task.appendChat(
        'assistant',
        'text',
        'Here is a file',
        undefined,
        [{ id: 'a1', originalName: 'file.txt', path: '/f.txt', sizeBytes: 100 }],
      );
      const prompt = buildPrompt(task, metadata, [], 60);
      expect(prompt).toContain('attachments=/f.txt');
    });

    it('formats artifacts in chat', () => {
      task.appendChat(
        'assistant',
        'artifact',
        undefined,
        undefined,
        undefined,
        [{ description: 'output', fileType: 'json', path: '/out.json' }],
      );
      const prompt = buildPrompt(task, metadata, [], 60);
      expect(prompt).toContain('artifacts=/out.json');
    });

    it('formats eventId in chat', () => {
      task.appendChat('event', 'event', undefined, undefined, undefined, undefined, 'evt_xyz');
      const prompt = buildPrompt(task, metadata, [], 60);
      expect(prompt).toContain('eventId=evt_xyz');
    });
  });

  describe('subtask lines', () => {
    it('shows subtask summary from metadata when subtasks exist', () => {
      task.subtaskIds.push('task_sub-1', 'task_sub-2');
      metadata.subtaskSummary = [
        '- task_sub-1 Sub A (agent-1) [COMPLETED]: assistant/text: ok',
        '- task_sub-2 Sub B (agent-1) [RUNNING]: sem mensagens',
      ].join('\n');
      const prompt = buildPrompt(task, metadata, [], 60);
      expect(prompt).toContain('task_sub-1');
      expect(prompt).toContain('task_sub-2');
    });

    it('shows subtasks from run wait groups', () => {
      task.subtaskIds.push('task_sub-1');
      const run: TaskRun = {
        runId: 'run_1',
        status: 'WAITING',
        epoch: 1,
        waitGroups: [
          { waitId: 'wg1', mode: 'WAIT_ALL', taskIds: ['task_sub-1'], processedEventIds: [], status: 'WAITING' },
        ],
        resultMessages: [],
        createdAt: '2025-01-01T00:00:00.000Z',
      };
      task.runs = [run];
      const prompt = buildPrompt(task, metadata, [], 60);
      expect(prompt).toContain('task_sub-1');
    });

    it('shows "Sem subtasks" when subtaskIds empty and no run data', () => {
      task.subtaskIds = [];
      metadata.runs = [];
      const prompt = buildPrompt(task, metadata, [], 60);
      expect(prompt).toContain('Sem subtasks.');
    });
  });
});
