import type { SwarmEventType } from './types';
import type { TaskChatMessage, SerializedTask } from './task';

export interface SwarmEvent {
  seq: number;
  eventId: string;
  type: SwarmEventType;
  taskId?: string;
  parentId?: string;
  runId?: string;
  waitId?: string;
  ts: string;
  messages?: TaskChatMessage[];
  processedByTaskIds: string[];
  payload?: Record<string, unknown>;
}

export interface SwarmState {
  version: 2;
  savedAt: string;
  nextSeq: number;
  rootTaskIds: string[];
  tasks: SerializedTask[];
  events: SwarmEvent[];
}
