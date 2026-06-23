import type { Agent } from '../domain/agent.js';
import type { Task } from '../domain/task.js';
import type { SwarmEvent } from '../domain/events.js';
import type { Orquestrator } from './orquestrator.js';
import { buildPrompt } from './prompt-builder.js';

/**
 * Minimal interface for what we need from Pi SDK.
 * Application layer does NOT import Pi SDK directly.
 */
export interface AgentRunConfig {
  cwd: string;
  model: unknown; // Pi SDK Model object
  thinkingLevel: string;
  tools: string[];
  systemPrompt: string;
  prompt: string;
  sessionManager: unknown;
  resourceLoader: unknown;
}

export interface AgentRunResult {
  output: string;
  stats: {
    tokens?: { input?: number; output?: number; total?: number };
    cost?: number;
  };
}

/**
 * Contract for the external agent runner (Pi SDK or mock).
 */
export interface AgentRunner {
  run(config: AgentRunConfig): Promise<AgentRunResult>;
}

/**
 * Wraps Pi SDK calls. Receives all deps via constructor (dependency inversion).
 *
 * The Orquestrator calls `piClient.run(...)`, passing itself so that
 * `buildPrompt` can access subtask metadata. The prompt building itself
 * is pure — all chat mutation happens in `applyDecision` after the run completes.
 */
export class PiAgentClient {
  constructor(
    private readonly runner: AgentRunner,
    private readonly systemPromptBase: string,
    private readonly tools: string[],
    private readonly allowedModels: Record<string, { provider: string; modelId: string }>,
    private readonly maxPromptChatMessages: number,
  ) {}

  async run(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    triggerEvents: SwarmEvent[],
  ): Promise<AgentRunResult> {
    const runtimeConfig = orquestrator.resolveRuntimeConfig(task, agent);
    const modelConfig = this.allowedModels[runtimeConfig.model];
    if (!modelConfig) {
      throw new Error(`Modelo alias ${runtimeConfig.model} não encontrado`);
    }

    const metadata = orquestrator.toMetadata(task);
    const taskDir = orquestrator.getTaskDir(task.taskId);
    const systemPrompt = `${agent.role}\n${orquestrator.buildTaskMetadataBlock(task, metadata)}\n\nREGRAS:\n1. Use create_subtask apenas se task exigir delegacao\n2. Se ja ha subtasks, aguarde-as (waiting) em vez de criar novas\n3. Para produzir arquivo, use create_artifact\n4. Retorne APENAS o JSON puro, sem texto antes/depois, sem markdown\n\nFORMATOS (retorne exatamente um destes):\ncompletado: ${JSON.stringify({ status: 'completed', messages: [{ type: 'text', text: 'resultado' }] })}\naguardando: ${JSON.stringify({ status: 'waiting', waitGroups: [{ waitId: 'g1', mode: 'WAIT_ALL', taskIds: ['id1'] }], messages: [{ type: 'text', text: 'motivo' }] })}\nretry: ${JSON.stringify({ status: 'retry', instructions: 'novas instrucoes', messages: [{ type: 'text', text: 'motivo' }] })}`;

    const prompt = buildPrompt(task, metadata, triggerEvents, this.maxPromptChatMessages);

    return this.runner.run({
      cwd: taskDir,
      model: modelConfig,
      thinkingLevel: runtimeConfig.effort,
      tools: this.tools,
      systemPrompt,
      prompt,
      sessionManager: undefined,
      resourceLoader: undefined,
    });
  }

  /**
   * One-shot, tool-less request that turns a user message into a short title.
   * Uses the cheapest model; returns the raw model text (caller sanitizes).
   */
  async generateTitle(message: string): Promise<string> {
    const modelConfig = this.allowedModels.fast ?? Object.values(this.allowedModels)[0];
    if (!modelConfig) throw new Error('Nenhum modelo disponível para gerar título');

    const result = await this.runner.run({
      cwd: process.cwd(),
      model: modelConfig,
      thinkingLevel: 'minimal',
      tools: [],
      systemPrompt:
        'Você gera títulos curtos para tarefas. Dada a mensagem do usuário, responda APENAS com um título conciso de no máximo 8 palavras, no idioma da mensagem, sem aspas e sem pontuação final.',
      prompt: message,
      sessionManager: undefined,
      resourceLoader: undefined,
    });
    return result.output ?? '';
  }
}
