import type { TaskRunStatus } from './types';
import type { TaskChatMessage } from './task';
import type { WaitGroup } from './wait-group';

export interface TaskRun {
  runId: string;
  status: TaskRunStatus;
  waitGroups: WaitGroup[];
  resultMessages: TaskChatMessage[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}
