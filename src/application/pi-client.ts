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
  // When aborted, the runner stops the in-flight agent session promptly.
  signal?: AbortSignal;
  // Extra agent tools (e.g. create_subtask, create_artifact). The runner turns
  // these into Pi SDK tools; the application layer stays free of Pi imports.
  customTools?: CustomToolSpec[];
}

/** Plain description of an agent tool, independent of the Pi SDK. */
export interface CustomToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<string>;
}

/** Thrown when an in-flight agent run is aborted (pause/move/cancel). */
export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelado');
    this.name = 'RunCancelledError';
  }
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
    signal?: AbortSignal,
  ): Promise<AgentRunResult> {
    const runtimeConfig = orquestrator.resolveRuntimeConfig(task, agent);
    const modelConfig = this.allowedModels[runtimeConfig.model];
    if (!modelConfig) {
      throw new Error(`Modelo alias ${runtimeConfig.model} não encontrado`);
    }

    const metadata = orquestrator.toMetadata(task);
    const taskDir = orquestrator.getTaskDir(task.taskId);
    const systemPrompt = [
      agent.role,
      orquestrator.buildTaskMetadataBlock(task, metadata),
      '',
      'COMO VOCE SE COMUNICA',
      '- O titulo da task e gerado separadamente e e curto e direto. NUNCA trate suas mensagens como titulo nem repita o titulo como resposta.',
      '- Durante a execucao, use a tool post_message para dar feedback ao usuario sobre o que esta fazendo (progresso, decisao tomada, proximo passo). Sao mensagens informativas e NAO finalizam a task.',
      '- Toda finalizacao de uma task e SEMPRE uma resposta sua: o campo messages da sua decisao e a mensagem de conclusao entregue ao usuario.',
      '',
      'QUANDO PARAR (decisao final)',
      'Ao decidir parar, retorne uma mensagem de conclusao deixando claro um dos casos:',
      '- CONCLUIDA: o trabalho foi entregue. Resuma o resultado/entregaveis. -> status completed.',
      '- PRECISA DE RESPOSTA: voce esta bloqueado e precisa de informacao/decisao do usuario. Faca a pergunta de forma objetiva. -> status completed com a pergunta clara em messages (a task vai para revisao aguardando o usuario).',
      '',
      'DELEGACAO (subtasks)',
      '1. Use create_subtask para delegar a outro agente (Produto, Architecture, Engineer, Code Reviewer, QA, Generic) quando a task exigir o trabalho final desse agente. Voce orquestra; nao faca o trabalho final de outro agente.',
      '2. Apos criar subtasks, retorne status waiting com waitGroups contendo os taskIds retornados pela tool (WAIT_ALL aguarda todas; ON_DEMAND processa uma a uma). NUNCA responda completed no mesmo turno em que criou subtasks.',
      '3. Os resultados (conclusoes) das subtasks chegam como input nos eventos recebidos no proximo turno. Consolide essas conclusoes e so entao responda completed com a mensagem final ao usuario.',
      '',
      'ARTEFATOS',
      '- Para produzir arquivos use create_artifact.',
      '',
      'FORMATO DE SAIDA',
      'Retorne APENAS o JSON puro do contrato (campo status), sem texto antes/depois, sem markdown. Exatamente um destes:',
      `completado: ${JSON.stringify({ status: 'completed', messages: [{ type: 'text', text: 'conclusao ou pergunta ao usuario' }] })}`,
      `aguardando: ${JSON.stringify({ status: 'waiting', waitGroups: [{ waitId: 'g1', mode: 'WAIT_ALL', taskIds: ['id1'] }], messages: [{ type: 'text', text: 'motivo' }] })}`,
      `retry: ${JSON.stringify({ status: 'retry', instructions: 'novas instrucoes', messages: [{ type: 'text', text: 'motivo' }] })}`,
    ].join('\n');

    const prompt = buildPrompt(task, metadata, triggerEvents, this.maxPromptChatMessages);

    // Only tasks that may still create subtasks get the orchestration tools.
    const customTools = metadata.canCreateSubtasks ? orquestrator.buildAgentTools(task) : [];
    const tools = [...this.tools, ...customTools.map((tool) => tool.name)];

    return this.runner.run({
      cwd: taskDir,
      model: modelConfig,
      thinkingLevel: runtimeConfig.effort,
      tools,
      systemPrompt,
      prompt,
      customTools,
      sessionManager: undefined,
      resourceLoader: undefined,
      signal,
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
