import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  TASK_STATUS,
  WAIT_GROUP_MODE,
  WAIT_GROUP_STATUS,
  TASK_RUN_STATUS,
  MODEL_ALIAS,
  EFFORT_LEVEL,
  TASK_CHAT_ROLE,
  TASK_MESSAGE_TYPE,
  SWARM_EVENT_TYPE,
} from '../../domain/types.js';
import type {
  TaskStatus,
  WaitGroupMode,
  WaitGroupStatus,
  TaskRunStatus,
  ModelAlias,
  EffortLevel,
  TaskChatRole,
  TaskMessageType,
  SwarmEventType,
} from '../../domain/types.js';

describe('TASK_STATUS', () => {
  it('has all expected keys', () => {
    expect(TASK_STATUS).toHaveProperty('PENDING');
    expect(TASK_STATUS).toHaveProperty('QUEUED');
    expect(TASK_STATUS).toHaveProperty('RUNNING');
    expect(TASK_STATUS).toHaveProperty('WAITING');
    expect(TASK_STATUS).toHaveProperty('COMPLETED');
    expect(TASK_STATUS).toHaveProperty('FAILED');
    expect(TASK_STATUS).toHaveProperty('CANCELLED');
  });

  it('has correct values matching keys', () => {
    expect(TASK_STATUS.PENDING).toBe('PENDING');
    expect(TASK_STATUS.QUEUED).toBe('QUEUED');
    expect(TASK_STATUS.RUNNING).toBe('RUNNING');
    expect(TASK_STATUS.WAITING).toBe('WAITING');
    expect(TASK_STATUS.COMPLETED).toBe('COMPLETED');
    expect(TASK_STATUS.FAILED).toBe('FAILED');
    expect(TASK_STATUS.CANCELLED).toBe('CANCELLED');
  });


});

describe('WAIT_GROUP_MODE', () => {
  it('has WAIT_ALL and ON_DEMAND', () => {
    expect(WAIT_GROUP_MODE.WAIT_ALL).toBe('WAIT_ALL');
    expect(WAIT_GROUP_MODE.ON_DEMAND).toBe('ON_DEMAND');
  });
});

describe('WAIT_GROUP_STATUS', () => {
  it('has all expected keys', () => {
    expect(WAIT_GROUP_STATUS.WAITING).toBe('WAITING');
    expect(WAIT_GROUP_STATUS.READY).toBe('READY');
    expect(WAIT_GROUP_STATUS.PROCESSED).toBe('PROCESSED');
    expect(WAIT_GROUP_STATUS.FAILED).toBe('FAILED');
  });
});

describe('TASK_RUN_STATUS', () => {
  it('has all expected keys', () => {
    expect(TASK_RUN_STATUS.RUNNING).toBe('RUNNING');
    expect(TASK_RUN_STATUS.WAITING).toBe('WAITING');
    expect(TASK_RUN_STATUS.COMPLETED).toBe('COMPLETED');
    expect(TASK_RUN_STATUS.FAILED).toBe('FAILED');
    expect(TASK_RUN_STATUS.TIMEOUT).toBe('TIMEOUT');
  });
});

describe('MODEL_ALIAS', () => {
  it('has fast, balanced, deep', () => {
    expect(MODEL_ALIAS.fast).toBe('fast');
    expect(MODEL_ALIAS.balanced).toBe('balanced');
    expect(MODEL_ALIAS.deep).toBe('deep');
  });
});

describe('EFFORT_LEVEL', () => {
  it('has all 6 levels', () => {
    expect(EFFORT_LEVEL.off).toBe('off');
    expect(EFFORT_LEVEL.minimal).toBe('minimal');
    expect(EFFORT_LEVEL.low).toBe('low');
    expect(EFFORT_LEVEL.medium).toBe('medium');
    expect(EFFORT_LEVEL.high).toBe('high');
    expect(EFFORT_LEVEL.xhigh).toBe('xhigh');
  });
});

describe('TASK_CHAT_ROLE', () => {
  it('has system, user, assistant, event', () => {
    expect(TASK_CHAT_ROLE.system).toBe('system');
    expect(TASK_CHAT_ROLE.user).toBe('user');
    expect(TASK_CHAT_ROLE.assistant).toBe('assistant');
    expect(TASK_CHAT_ROLE.event).toBe('event');
  });
});

describe('TASK_MESSAGE_TYPE', () => {
  it('has text, artifact, event', () => {
    expect(TASK_MESSAGE_TYPE.text).toBe('text');
    expect(TASK_MESSAGE_TYPE.artifact).toBe('artifact');
    expect(TASK_MESSAGE_TYPE.event).toBe('event');
  });
});

describe('SWARM_EVENT_TYPE', () => {
  it('has all event types', () => {
    const keys = Object.keys(SWARM_EVENT_TYPE);
    expect(keys).toHaveLength(25);
    expect(SWARM_EVENT_TYPE.TASK_CREATED).toBe('TASK_CREATED');
    expect(SWARM_EVENT_TYPE.TASK_UPDATED).toBe('TASK_UPDATED');
    expect(SWARM_EVENT_TYPE.TASK_QUEUED).toBe('TASK_QUEUED');
    expect(SWARM_EVENT_TYPE.TASK_STARTED).toBe('TASK_STARTED');
    expect(SWARM_EVENT_TYPE.TASK_WAITING).toBe('TASK_WAITING');
    expect(SWARM_EVENT_TYPE.TASK_RESUMED).toBe('TASK_RESUMED');
    expect(SWARM_EVENT_TYPE.TASK_COMPLETED).toBe('TASK_COMPLETED');
    expect(SWARM_EVENT_TYPE.TASK_FAILED).toBe('TASK_FAILED');
    expect(SWARM_EVENT_TYPE.TASK_CANCELLED).toBe('TASK_CANCELLED');
    expect(SWARM_EVENT_TYPE.TASK_RETRY_REQUESTED).toBe('TASK_RETRY_REQUESTED');
    expect(SWARM_EVENT_TYPE.TASK_RETRIED).toBe('TASK_RETRIED');
    expect(SWARM_EVENT_TYPE.RUN_STARTED).toBe('RUN_STARTED');
    expect(SWARM_EVENT_TYPE.RUN_COMPLETED).toBe('RUN_COMPLETED');
    expect(SWARM_EVENT_TYPE.RUN_FAILED).toBe('RUN_FAILED');
    expect(SWARM_EVENT_TYPE.RUN_TIMEOUT).toBe('RUN_TIMEOUT');
    expect(SWARM_EVENT_TYPE.WAIT_GROUP_REGISTERED).toBe('WAIT_GROUP_REGISTERED');
    expect(SWARM_EVENT_TYPE.WAIT_GROUP_READY).toBe('WAIT_GROUP_READY');
    expect(SWARM_EVENT_TYPE.WAIT_GROUP_PROCESSED).toBe('WAIT_GROUP_PROCESSED');
    expect(SWARM_EVENT_TYPE.SUBTASK_CREATED).toBe('SUBTASK_CREATED');
    expect(SWARM_EVENT_TYPE.MESSAGE_APPENDED).toBe('MESSAGE_APPENDED');
    expect(SWARM_EVENT_TYPE.ARTIFACT_CREATED).toBe('ARTIFACT_CREATED');
    expect(SWARM_EVENT_TYPE.AGENT_OUTPUT_INVALID).toBe('AGENT_OUTPUT_INVALID');
    expect(SWARM_EVENT_TYPE.BUDGET_EXCEEDED).toBe('BUDGET_EXCEEDED');
  });
});

describe('type imports', () => {
  it('types are importable', () => {
    const status: TaskStatus = 'PENDING';
    const mode: WaitGroupMode = 'WAIT_ALL';
    const ws: WaitGroupStatus = 'WAITING';
    const rs: TaskRunStatus = 'RUNNING';
    const alias: ModelAlias = 'fast';
    const effort: EffortLevel = 'medium';
    const role: TaskChatRole = 'user';
    const msgType: TaskMessageType = 'text';
    const eventType: SwarmEventType = 'TASK_CREATED';

    expect(status).toBe('PENDING');
    expect(mode).toBe('WAIT_ALL');
    expect(ws).toBe('WAITING');
    expect(rs).toBe('RUNNING');
    expect(alias).toBe('fast');
    expect(effort).toBe('medium');
    expect(role).toBe('user');
    expect(msgType).toBe('text');
    expect(eventType).toBe('TASK_CREATED');
  });
});
