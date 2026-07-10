import type { Agent } from '../domain/agent.js';
import type { Task } from '../domain/task.js';
import type { SwarmEvent } from '../domain/events.js';
import type { Orquestrator } from './orquestrator.js';
import type { ScopeSpecItem, ProgressLogEntry, EnvResume } from '../infrastructure/persistence/task-file-store.js';
import type { AgentRunConfig, AgentRunResult } from './pi-client.js';

/** Continuidade opcional passada entre runs (scope/progresso/env). */
export interface RunContinuity {
  scopeSpec?: ScopeSpecItem[];
  progressLog?: ProgressLogEntry[];
  envResume?: EnvResume | null;
}

/**
 * Contrato consumido por Orquestrator e WorkerSupervisor. Extraído de
 * PiAgentClient para que um segundo agent (Codex) possa plugar sem alterar
 * os chamadores. `buildRunConfig`/`buildRepairRunConfig` existem para o modo
 * serializado do supervisor (worker fora do processo).
 */
export interface AgentClient {
  run(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    triggerEvents: SwarmEvent[],
    signal?: AbortSignal,
    continuity?: RunContinuity,
  ): Promise<AgentRunResult>;

  buildRunConfig(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    triggerEvents: SwarmEvent[],
    signal?: AbortSignal,
    continuity?: RunContinuity,
  ): AgentRunConfig;

  repairInvalidOutput(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    errorMessage: string,
    invalidOutput: string,
    signal?: AbortSignal,
  ): Promise<AgentRunResult>;

  buildRepairRunConfig(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    errorMessage: string,
    invalidOutput: string,
    signal?: AbortSignal,
  ): AgentRunConfig;

  generateTitle(message: string): Promise<string>;
}
