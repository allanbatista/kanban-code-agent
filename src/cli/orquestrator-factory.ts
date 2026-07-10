import type { Agent } from '../domain/agent.js';
import { Orquestrator, type OrquestratorDeps, type OrquestratorOptions } from '../application/orquestrator.js';
import { PiAgentClient } from '../application/pi-client.js';
import { PathSandbox } from '../infrastructure/filesystem/sandbox.js';
import { EventStore } from '../infrastructure/persistence/event-store.js';
import { SnapshotStore } from '../infrastructure/persistence/snapshot-store.js';
import { TaskFileStore } from '../infrastructure/persistence/task-file-store.js';
import type { SwarmConfig } from '../infrastructure/config.js';
import { loadConfig } from '../infrastructure/config.js';
import { PiSdkAgentRunner } from './pi-runner.js';
import { AGENTS } from '../infrastructure/agents/index.js';

// ---------------------------------------------------------------------------
// Agents from unified source
// ---------------------------------------------------------------------------

function createAgents(): Agent[] {
  return AGENTS.map((def) => ({
    name: def.name,
    role: def.role,
    runtimeConfig: def.runtimeConfig,
    tools: def.tools,
    mustNot: def.guardrails.mustNot,
  }));
}

// ---------------------------------------------------------------------------
// Pi Client factory
// ---------------------------------------------------------------------------

function createPiClient(config: SwarmConfig): PiAgentClient {
  const runner = new PiSdkAgentRunner();

  const allowedModels: Record<string, { provider: string; modelId: string }> = {
    fast: config.models.fast,
    balanced: config.models.balanced,
    deep: config.models.deep,
  };

  return new PiAgentClient(
    runner,
    '',
    ['read', 'write', 'bash', 'edit', 'grep', 'find', 'ls'],
    allowedModels,
    60,
  );
}

// ---------------------------------------------------------------------------
// Orquestrator factory
// ---------------------------------------------------------------------------

export async function createOrquestrator(
  config?: SwarmConfig,
  options?: OrquestratorOptions,
): Promise<Orquestrator> {
  const resolvedConfig = config ?? loadConfig();
  const sandbox = new PathSandbox(resolvedConfig.dataDir);
  const piClient = createPiClient(resolvedConfig);
  const agents = createAgents();

  const deps: OrquestratorDeps = {
    eventStore: new EventStore(sandbox),
    snapshotStore: new SnapshotStore(sandbox),
    taskFileStore: new TaskFileStore(sandbox),
    sandbox,
    agents,
    piClient,
    models: {
      fast: { ...resolvedConfig.models.fast, description: 'tarefas simples e baixo custo' },
      balanced: { ...resolvedConfig.models.balanced, description: 'uso geral equilibrado' },
      deep: { ...resolvedConfig.models.deep, description: 'tarefas complexas ou criticas' },
    },
  };

  return new Orquestrator(deps, {
    runTimeoutMs: resolvedConfig.runTimeoutMs,
    maxConcurrentRuns: resolvedConfig.maxConcurrentRuns,
    isolation: resolvedConfig.isolation,
    ...(options ?? {}),
  });
}
