import type { RuntimeConfig } from './task';

export interface Agent {
  name: string;
  role: string;
  runtimeConfig: RuntimeConfig;
  tools: string[];
}
