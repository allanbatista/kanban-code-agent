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

// ---------------------------------------------------------------------------
// Default agents (matches PoC)
// ---------------------------------------------------------------------------

function createAgents(): Agent[] {
  return [
    {
      name: 'Manager',
      role: 'Voce e o Gerente de projetos Senior focado em orquestracao macro. Siga instrucoes e entregue task de forma objetiva.',
      runtimeConfig: { model: 'fast', effort: 'minimal' },
      tools: ['read', 'write', 'bash', 'edit', 'grep', 'find'],
    },
    {
      name: 'Produto',
      role: 'Voce e o Product Owner Senior, focado em regras de negocio e requisitos.',
      runtimeConfig: { model: 'fast', effort: 'low' },
      tools: ['read', 'write', 'bash', 'edit', 'grep', 'find'],
    },
    {
      name: 'Architecture',
      role: 'Voce e o Arquiteto de Software Senior, focado em design de sistemas, padroes arquiteturais e qualidade tecnica.',
      runtimeConfig: { model: 'balanced', effort: 'medium' },
      tools: ['read', 'write', 'bash', 'edit', 'grep', 'find'],
    },
    {
      name: 'Engineer',
      role: 'Voce e o Principal Engenheiro de Software, focado em arquitetura e codigo.',
      runtimeConfig: { model: 'fast', effort: 'medium' },
      tools: ['read', 'write', 'bash', 'edit', 'grep', 'find'],
    },
    {
      name: 'Code Reviewer',
      role: 'Voce e o Revisor de Codigo Senior, focado em qualidade, boas praticas e deteccao de problemas.',
      runtimeConfig: { model: 'balanced', effort: 'medium' },
      tools: ['read', 'grep', 'find'],
    },
    {
      name: 'QA',
      role: 'Voce e o Analista de Qualidade Senior, focado em testes, validacao e garantia de qualidade.',
      runtimeConfig: { model: 'balanced', effort: 'low' },
      tools: ['read', 'bash', 'grep', 'find'],
    },
    {
      name: 'Generic',
      role: 'Voce e um executor de tarefas gerais de apoio.',
      runtimeConfig: { model: 'fast', effort: 'off' },
      tools: ['read', 'write', 'bash', 'edit', 'grep', 'find'],
    },
  ];
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
  };

  return new Orquestrator(deps, options ?? {});
}
