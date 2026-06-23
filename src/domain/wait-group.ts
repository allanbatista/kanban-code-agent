import type { WaitGroupMode, WaitGroupStatus } from './types';

export interface WaitGroup {
  waitId: string;
  mode: WaitGroupMode;
  taskIds: string[];
  processedEventIds: string[];
  status: WaitGroupStatus;
}

export interface AgentWaitGroup {
  waitId: string;
  mode: WaitGroupMode;
  taskIds: string[];
}
