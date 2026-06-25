import type { RuntimeConfig } from './task';

export interface Agent {
  name: string;
  role: string;
  runtimeConfig: RuntimeConfig;
  tools: string[];
  /** Explicit prohibitions injected into the system prompt (§8.3 guardrails). */
  mustNot?: string[];
}
