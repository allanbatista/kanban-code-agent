import type { TaskRunStatus } from './types';
import type { TaskChatMessage } from './task';
import type { WaitGroup } from './wait-group';
import type { Governance } from './governance';

export interface TaskRun {
  runId: string;
  status: TaskRunStatus;
  epoch: number;
  checkpointSeq?: number; // event seq at end of epoch (for restart recovery)
  // Governance snapshot captured at run start — immutable for this run so a
  // mid-flight config change cannot move the goalposts (§1.5, M3).
  governance?: Governance;
  // Idempotency keys already executed by side-effecting tools in this run, so a
  // crash-resume of the same epoch does not duplicate the effect (§3.6).
  idempotencyKeys?: string[];
  waitGroups: WaitGroup[];
  resultMessages: TaskChatMessage[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}
