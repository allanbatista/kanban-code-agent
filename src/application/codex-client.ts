import { mkdirSync, rmSync } from 'node:fs';
import type { spawn } from 'node:child_process';
import type { Agent } from '../domain/agent.js';
import type { Task } from '../domain/task.js';
import type { SwarmEvent } from '../domain/events.js';
import type { Orquestrator } from './orquestrator.js';
import type { AgentClient, RunContinuity } from './agent-client.js';
import { PiAgentClient, type AgentRunConfig, type AgentRunResult, type AgentRunner } from './pi-client.js';
import {
  CodexRunner,
  DECISION_OUTPUT_SCHEMA,
  DEFAULT_CODEX_MODEL,
  runCodexTurn,
  type CodexSandboxPolicy,
} from '../cli/codex-runner.js';
import { closeServer, listenToolServer, runSocketDir, toolsSocketPath } from '../infrastructure/process/worker-supervisor.js';
import { ensureCodexHome } from '../infrastructure/security/codex-home.js';

// Reexport: o schema de decisao mora no nivel-runner (codex-runner) mas fazia
// parte da superficie publica deste modulo.
export { DECISION_OUTPUT_SCHEMA };

// ---------------------------------------------------------------------------
// CodexAgentClient: fala com `codex app-server` (JSON-RPC/stdio) via CodexRunner.
// Reusa a montagem de prompts do PiAgentClient para que ambos os agents recebam
// instrucoes IDENTICAS; a decisao vem estruturada nativa via outputSchema.
// Tools do Master chegam por MCP bridge (F1.2): aqui so subimos o tool-callback
// UDS por run e passamos o socket via KCA_TOOLS_SOCKET.
// ---------------------------------------------------------------------------

// O AgentRunner do Pi nunca roda no caminho Codex; reusamos o PiAgentClient
// apenas para montar prompts (buildRunConfig/buildRepairRunConfig).
const NEVER_RUNNER: AgentRunner = {
  run() {
    throw new Error('CodexAgentClient nao usa o AgentRunner do Pi (so reusa a montagem de prompts)');
  },
};

export interface CodexClientOptions {
  /** CODEX_HOME compartilhado (default <dataDir>/.swarm/auth/codex — F1.2 cria o dir). */
  codexHome: string;
  /** Usado para localizar/criar o CODEX_HOME compartilhado (<dataDir>/.swarm/auth/codex). */
  dataDir: string;
  /** Modelo unico; SWARM_CODEX_MODEL vence, senao DEFAULT_CODEX_MODEL. */
  model?: string;
  /** workspaceWrite (inproc) | externalSandbox (Docker/F2 — o container e o sandbox). */
  sandboxPolicy?: CodexSandboxPolicy;
  bin?: string;
  spawn?: typeof spawn;
  /** Injecao de runner para testes (sobrescreve o CodexRunner interno). */
  runner?: CodexRunner;
}

export class CodexAgentClient implements AgentClient {
  private readonly prompts: PiAgentClient;
  private readonly runner: CodexRunner;
  private readonly model: string;
  private readonly sandboxPolicy: CodexSandboxPolicy;
  private homeReady = false;

  constructor(
    systemPromptBase: string,
    tools: string[],
    allowedModels: Record<string, { provider: string; modelId: string }>,
    maxPromptChatMessages: number,
    private readonly options: CodexClientOptions,
  ) {
    // ponytail: reusa o PiAgentClient so para montar prompts identicos ao Pi.
    this.prompts = new PiAgentClient(NEVER_RUNNER, systemPromptBase, tools, allowedModels, maxPromptChatMessages);
    this.runner = options.runner ?? new CodexRunner({ codexHome: options.codexHome, bin: options.bin, spawn: options.spawn });
    this.model = options.model ?? process.env.SWARM_CODEX_MODEL ?? DEFAULT_CODEX_MODEL;
    this.sandboxPolicy = options.sandboxPolicy ?? 'workspaceWrite';
  }

  buildRunConfig(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    triggerEvents: SwarmEvent[],
    signal?: AbortSignal,
    continuity?: RunContinuity,
  ): AgentRunConfig {
    return this.prompts.buildRunConfig(agent, task, orquestrator, triggerEvents, signal, continuity);
  }

  buildRepairRunConfig(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    errorMessage: string,
    invalidOutput: string,
    signal?: AbortSignal,
  ): AgentRunConfig {
    return this.prompts.buildRepairRunConfig(agent, task, orquestrator, errorMessage, invalidOutput, signal);
  }

  async run(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    triggerEvents: SwarmEvent[],
    signal?: AbortSignal,
    continuity?: RunContinuity,
  ): Promise<AgentRunResult> {
    const config = this.buildRunConfig(agent, task, orquestrator, triggerEvents, signal, continuity);
    return this.runTurnWithTools(config, task, signal);
  }

  async repairInvalidOutput(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    errorMessage: string,
    invalidOutput: string,
    signal?: AbortSignal,
  ): Promise<AgentRunResult> {
    const config = this.buildRepairRunConfig(agent, task, orquestrator, errorMessage, invalidOutput, signal);
    return this.runTurnWithTools(config, task, signal);
  }

  async generateTitle(message: string): Promise<string> {
    // Turno unico, sem outputSchema nem tools (mesmo prompt do Pi).
    try {
      this.ensureHome();
      const result = await this.runner.runTurn({
        cwd: process.cwd(),
        model: this.model,
        effort: 'low',
        sandboxPolicy: this.sandboxPolicy,
        systemPrompt:
          'Você gera títulos curtos para tarefas. Dada a mensagem do usuário, responda APENAS com um título conciso de no máximo 8 palavras, no idioma da mensagem, sem aspas e sem pontuação final.',
        prompt: message,
      });
      return result.output ?? '';
    } catch {
      // ponytail: fallback por truncamento se o turno de titulo falhar (auth/binario
      // ausente nao deve travar a criacao da task).
      return message.split('\n')[0].slice(0, 60);
    }
  }

  // Cria o CODEX_HOME (dir 0700 + config.toml do MCP bridge) uma unica vez, antes
  // do primeiro spawn. Idempotente; nunca toca auth.json.
  private ensureHome(): void {
    if (this.homeReady) return;
    ensureCodexHome(this.options.dataDir);
    this.homeReady = true;
  }

  private async runTurnWithTools(config: AgentRunConfig, task: Task, signal?: AbortSignal): Promise<AgentRunResult> {
    this.ensureHome();
    const runId = task.activeRunId ?? 'run';
    // Reusa o mesmo tool-callback UDS do supervisor (POST /tool {name, params}).
    // Dir curto sob /tmp (0700), fora do dataDir, p/ o path caber no limite
    // sun_path (~108 chars no Linux) mesmo com dataDir longo.
    const socketDir = runSocketDir(task.taskId, `${runId}-codex`);
    mkdirSync(socketDir, { recursive: true, mode: 0o700 });
    const socketPath = toolsSocketPath(task.taskId, `${runId}-codex`);
    const toolServer = await listenToolServer(socketPath, config.customTools ?? []);
    try {
      return await runCodexTurn(this.runner, config, {
        model: this.model,
        sandboxPolicy: this.sandboxPolicy,
        toolsSocket: socketPath,
        signal,
      });
    } finally {
      await closeServer(toolServer).catch(() => undefined);
      // Remove o dir do run inteiro (t.sock).
      rmSync(socketDir, { recursive: true, force: true });
    }
  }
}
