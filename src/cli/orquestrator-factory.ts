import type { Agent } from '../domain/agent.js';
import type { Task } from '../domain/task.js';
import type { SwarmEvent } from '../domain/events.js';
import type { AgentName } from '../domain/types.js';
import { Orquestrator, type OrquestratorDeps, type OrquestratorOptions } from '../application/orquestrator.js';
import { PiAgentClient } from '../application/pi-client.js';
import { CodexAgentClient } from '../application/codex-client.js';
import type { AgentClient, RunContinuity } from '../application/agent-client.js';
import type { AgentRunConfig, AgentRunResult } from '../application/pi-client.js';
import { PathSandbox } from '../infrastructure/filesystem/sandbox.js';
import { EventStore } from '../infrastructure/persistence/event-store.js';
import { SnapshotStore } from '../infrastructure/persistence/snapshot-store.js';
import { TaskFileStore } from '../infrastructure/persistence/task-file-store.js';
import type { SwarmConfig } from '../infrastructure/config.js';
import { loadConfig } from '../infrastructure/config.js';
import { PiSdkAgentRunner } from './pi-runner.js';
import { AGENTS } from '../infrastructure/agents/index.js';
import { SettingsStore } from '../infrastructure/persistence/settings-store.js';
import { codexHomePath } from '../infrastructure/security/codex-home.js';
import { WorkerSupervisor } from '../infrastructure/process/worker-supervisor.js';

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

function createPiClient(config: SwarmConfig, settingsStore: SettingsStore): PiAgentClient {
  // Resolver de key: settings primeiro, fallback envvar fica no runner.
  const runner = new PiSdkAgentRunner((provider) => settingsStore.getApiKey(provider));

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
// Codex Client factory
// ---------------------------------------------------------------------------

const AGENT_TOOLS = ['read', 'write', 'bash', 'edit', 'grep', 'find', 'ls'];

function createCodexClient(config: SwarmConfig, dataDir: string): CodexAgentClient {
  const allowedModels: Record<string, { provider: string; modelId: string }> = {
    fast: config.models.fast,
    balanced: config.models.balanced,
    deep: config.models.deep,
  };
  // CODEX_HOME compartilhado; ensureCodexHome (chamado no primeiro spawn do
  // client) cria o dir + config.toml; aqui so derivamos o mesmo path.
  const codexHome = codexHomePath(dataDir);
  // SWARM_CODEX_SANDBOX=danger-full-access quando o processo ja roda isolado
  // (ex.: dentro do container do server) — o bwrap do codex nao funciona la.
  const sandboxPolicy = process.env.SWARM_CODEX_SANDBOX === 'danger-full-access' ? ('externalSandbox' as const) : undefined;
  return new CodexAgentClient('', AGENT_TOOLS, allowedModels, 60, { codexHome, dataDir, sandboxPolicy });
}

// ---------------------------------------------------------------------------
// Routing client: seleciona pi/codex por task (agent resolvido). Constroi cada
// client sob demanda — o codex so nasce quando um run codex de fato acontece.
// ---------------------------------------------------------------------------

export class RoutingAgentClient implements AgentClient {
  private pi?: AgentClient;
  private codex?: AgentClient;

  constructor(
    private readonly makePi: () => AgentClient,
    private readonly makeCodex: () => AgentClient,
    private readonly resolveDefaultAgent: () => AgentName,
  ) {}

  private forName(name: AgentName): AgentClient {
    if (name === 'codex') return (this.codex ??= this.makeCodex());
    return (this.pi ??= this.makePi());
  }

  private select(agent: Agent, task: Task, orquestrator: Orquestrator): AgentClient {
    return this.forName(orquestrator.resolveRuntimeConfig(task, agent).agent);
  }

  run(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    triggerEvents: SwarmEvent[],
    signal?: AbortSignal,
    continuity?: RunContinuity,
  ): Promise<AgentRunResult> {
    return this.select(agent, task, orquestrator).run(agent, task, orquestrator, triggerEvents, signal, continuity);
  }

  buildRunConfig(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    triggerEvents: SwarmEvent[],
    signal?: AbortSignal,
    continuity?: RunContinuity,
  ): AgentRunConfig {
    return this.select(agent, task, orquestrator).buildRunConfig(agent, task, orquestrator, triggerEvents, signal, continuity);
  }

  repairInvalidOutput(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    errorMessage: string,
    invalidOutput: string,
    signal?: AbortSignal,
  ): Promise<AgentRunResult> {
    return this.select(agent, task, orquestrator).repairInvalidOutput(agent, task, orquestrator, errorMessage, invalidOutput, signal);
  }

  buildRepairRunConfig(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    errorMessage: string,
    invalidOutput: string,
    signal?: AbortSignal,
  ): AgentRunConfig {
    return this.select(agent, task, orquestrator).buildRepairRunConfig(agent, task, orquestrator, errorMessage, invalidOutput, signal);
  }

  generateTitle(message: string): Promise<string> {
    // Sem task: usa o agent default global (settings).
    return this.forName(this.resolveDefaultAgent()).generateTitle(message);
  }
}

// ---------------------------------------------------------------------------
// Keys de provider para o worker docker: mesma precedência do pi-runner
// (settings vence quando não vazia; fallback envvar). Só entram keys presentes.
// ---------------------------------------------------------------------------

function resolveProviderEnv(config: SwarmConfig, settingsStore: SettingsStore): Record<string, string> {
  const env: Record<string, string> = {};
  const providers = new Set([config.models.fast.provider, config.models.balanced.provider, config.models.deep.provider]);
  for (const provider of providers) {
    const key = `${provider.toUpperCase()}_API_KEY`;
    const value = settingsStore.getApiKey(provider) ?? process.env[key];
    if (value) env[key] = value;
  }
  return env;
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
  const dataDir = sandbox.getBaseDir();
  // Store no mesmo base dir que a rota HTTP usa (settings.json é a fonte).
  const settingsStore = new SettingsStore(dataDir);
  // Roteia por task (agent resolvido). Ambos os clients nascem sob demanda; o
  // codex nao exige binario/auth ate um run codex de fato ocorrer.
  const piClient = new RoutingAgentClient(
    () => createPiClient(resolvedConfig, settingsStore),
    () => createCodexClient(resolvedConfig, dataDir),
    () => settingsStore.getAgent(),
  );
  const agents = createAgents();

  // Supervisor com CODEX_HOME e keys de provider resolvidas (settings->env),
  // montadas/injetadas no worker docker. Em inproc esses campos ficam ociosos.
  const workerSupervisor = new WorkerSupervisor(piClient, {
    mode: resolvedConfig.isolation,
    runTimeoutMs: resolvedConfig.runTimeoutMs,
    dataDir,
    codexHome: codexHomePath(dataDir),
    workerEnv: resolveProviderEnv(resolvedConfig, settingsStore),
  });

  const deps: OrquestratorDeps = {
    eventStore: new EventStore(sandbox),
    snapshotStore: new SnapshotStore(sandbox),
    taskFileStore: new TaskFileStore(sandbox),
    sandbox,
    agents,
    piClient,
    workerSupervisor,
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
    defaultAgent: settingsStore.getAgent(),
    ...(options ?? {}),
  });
}
