import type { TaskRunStatus } from './types';
import type { TaskChatMessage } from './task';
import type { WaitGroup } from './wait-group';

export interface TaskRun {
  runId: string;
  status: TaskRunStatus;
  epoch: number;
  checkpointSeq?: number; // event seq at end of epoch (for restart recovery)
  waitGroups: WaitGroup[];
  resultMessages: TaskChatMessage[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}
