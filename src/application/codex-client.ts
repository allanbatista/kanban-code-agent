import { rmSync } from 'node:fs';
import type { spawn } from 'node:child_process';
import type { Agent } from '../domain/agent.js';
import type { Task } from '../domain/task.js';
import type { SwarmEvent } from '../domain/events.js';
import type { Orquestrator } from './orquestrator.js';
import type { AgentClient, RunContinuity } from './agent-client.js';
import { PiAgentClient, type AgentRunConfig, type AgentRunResult, type AgentRunner } from './pi-client.js';
import {
  CodexRunner,
  DEFAULT_CODEX_MODEL,
  type CodexEffort,
  type CodexSandboxPolicy,
} from '../cli/codex-runner.js';
import { closeServer, listenToolServer, workerSocketPath } from '../infrastructure/process/worker-supervisor.js';
import { ensureCodexHome } from '../infrastructure/security/codex-home.js';

// ---------------------------------------------------------------------------
// CodexAgentClient: fala com `codex app-server` (JSON-RPC/stdio) via CodexRunner.
// Reusa a montagem de prompts do PiAgentClient para que ambos os agents recebam
// instrucoes IDENTICAS; a decisao vem estruturada nativa via outputSchema.
// Tools do Master chegam por MCP bridge (F1.2): aqui so subimos o tool-callback
// UDS por run e passamos o socket via KCA_TOOLS_SOCKET.
// ---------------------------------------------------------------------------

// Contrato de decisao espelhado de parseDecision/AgentDecision (decision-parser.ts,
// domain/task.ts). Enviado como outputSchema no turn/start para que o Codex
// devolva o objeto ja estruturado.
export const DECISION_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'messages'],
  properties: {
    status: { type: 'string', enum: ['completed', 'waiting', 'retry'] },
    messages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'text'],
        properties: {
          type: { type: 'string', enum: ['text', 'artifact'] },
          text: { type: 'string' },
        },
      },
    },
    waitGroups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['waitId', 'mode', 'taskIds'],
        properties: {
          waitId: { type: 'string' },
          mode: { type: 'string', enum: ['WAIT_ALL', 'ON_DEMAND'] },
          taskIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    waitMode: { type: 'string', enum: ['WAIT_ALL', 'ON_DEMAND'] },
    waitingForTaskIds: { type: 'array', items: { type: 'string' } },
    instructions: { type: 'string' },
    model: { type: 'string', enum: ['fast', 'balanced', 'deep'] },
    effort: { type: 'string', enum: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
    verdict: { type: 'string', enum: ['approved', 'rejected'] },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'passed'],
        properties: {
          name: { type: 'string' },
          passed: { type: 'boolean' },
          note: { type: 'string' },
        },
      },
    },
    feedback: { type: 'string' },
  },
};

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
  /** Base dir para os sockets UDS do tool-callback por run. */
  dataDir: string;
  /** Modelo unico; SWARM_CODEX_MODEL vence, senao DEFAULT_CODEX_MODEL. */
  model?: string;
  /** workspaceWrite (inproc) | externalSandbox (Docker/F2 — o container e o sandbox). */
  sandboxPolicy?: CodexSandboxPolicy;
  bin?: string;
  spawn?: typeof spawn;
  /** Injecao de runner para testes. */
  runnerFactory?: (runner: CodexRunner) => CodexRunner;
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
    const runner = new CodexRunner({ codexHome: options.codexHome, bin: options.bin, spawn: options.spawn });
    this.runner = options.runnerFactory ? options.runnerFactory(runner) : runner;
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
    const socketPath = workerSocketPath(this.options.dataDir, task.taskId, `${runId}-codex-tools`);
    const toolServer = await listenToolServer(socketPath, config.customTools ?? []);
    try {
      const result = await this.runner.runTurn({
        cwd: config.cwd,
        model: this.model,
        effort: mapEffort(config.thinkingLevel),
        sandboxPolicy: this.sandboxPolicy,
        outputSchema: DECISION_OUTPUT_SCHEMA,
        systemPrompt: config.systemPrompt,
        prompt: config.prompt,
        toolsSocket: socketPath,
        signal,
      });
      // ponytail: cost=0 — o app-server nao reporta preco por token (so contagem).
      return { output: result.output, stats: { tokens: result.usage, cost: 0 } };
    } finally {
      await closeServer(toolServer).catch(() => undefined);
      rmSync(socketPath, { force: true });
    }
  }
}

function mapEffort(level: string): CodexEffort {
  // Codex aceita low|medium|high; mapeia a escala do Pi (off..xhigh).
  // ponytail: mapeamento grosso; efforts por-alias do codex quando necessario.
  if (level === 'high' || level === 'xhigh') return 'high';
  if (level === 'medium') return 'medium';
  return 'low';
}
