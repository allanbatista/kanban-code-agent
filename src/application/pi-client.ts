import type { Agent } from '../domain/agent.js';
import type { Task } from '../domain/task.js';
import type { SwarmEvent } from '../domain/events.js';
import type { Orquestrator } from './orquestrator.js';
import { buildPrompt } from './prompt-builder.js';
import type { ScopeSpecItem, ProgressLogEntry, EnvResume } from '../infrastructure/persistence/task-file-store.js';

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
    tokens?: { input?: number; output?: number; cache?: number; total?: number };
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
    continuity?: {
      scopeSpec?: ScopeSpecItem[];
      progressLog?: ProgressLogEntry[];
      envResume?: EnvResume | null;
    },
  ): Promise<AgentRunResult> {
    return this.runner.run(this.buildRunConfig(agent, task, orquestrator, triggerEvents, signal, continuity));
  }

  buildRunConfig(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    triggerEvents: SwarmEvent[],
    signal?: AbortSignal,
    continuity?: {
      scopeSpec?: ScopeSpecItem[];
      progressLog?: ProgressLogEntry[];
      envResume?: EnvResume | null;
    },
  ): AgentRunConfig {
    const runtimeConfig = orquestrator.resolveRuntimeConfig(task, agent);
    const modelConfig = this.allowedModels[runtimeConfig.model];
    if (!modelConfig) {
      throw new Error(`Modelo alias ${runtimeConfig.model} não encontrado`);
    }

    const metadata = orquestrator.toMetadata(task);
    const taskWorkspaceDir = orquestrator.getTaskWorkspaceDir(task.taskId);

    // Any task with remaining delegation budget can become the parent of its own
    // subtasks. Depth/subtask ceilings still bound runaway nesting.
    const canDelegate = metadata.canCreateSubtasks && orquestrator.isOrchestrator(task);

    const guardrailBlock = agent.mustNot?.length
      ? `\nVOCE NAO DEVE (guardrails do papel):\n${agent.mustNot.map((g) => `- ${g}`).join('\n')}`
      : '';

    const commonHeader = [
      agent.role + guardrailBlock,
      orquestrator.buildTaskMetadataBlock(task, metadata),
      '',
      'COMO VOCE SE COMUNICA',
      '- O titulo da task e gerado separadamente e e curto e direto. NUNCA trate suas mensagens como titulo nem repita o titulo como resposta.',
      '- Assim que comecar, use a tool post_message para dizer em 1 linha o que vai fazer; e use-a novamente a cada passo relevante (decisao, delegacao, espera, consolidacao). Sao mensagens informativas e NAO finalizam a task.',
      '- Toda finalizacao de uma task e SEMPRE uma resposta sua: o campo messages da sua decisao e a mensagem de conclusao entregue ao usuario.',
    ];

    const roleBlock = canDelegate
      ? [
          '',
          'SEU PAPEL: ORQUESTRADOR',
          '- Voce NAO faz o trabalho final de outro agente: voce decompoe e delega.',
          '- Se a tarefa pede itens distintos (ex.: uma saudacao por idioma, um arquivo por modulo), voce DEVE criar UMA subtask por item via create_subtask e NUNCA responder direto.',
          '- Passe a cada subtask apenas a instrucao minima e auto-contida para o item dela (sem contexto das outras).',
          '- Se uma subtask entregar resultado vazio, generico ou invalido, NAO crie outra subtask de retry. Use request_subtask_validation na taskId original explicando o problema.',
          '- Depois de validar uma subtask, use continue_subtask para mandar continuar, accept_subtask para aceitar ou cancel_subtask para cancelar.',
          '',
          'FLUXO DE DELEGACAO',
          '1. post_message dizendo quantas subtasks vai criar e por que.',
          '2. Chame create_subtask para CADA item (ela retorna o taskId).',
          '3. Retorne status waiting com waitGroups usando os taskIds retornados (WAIT_ALL aguarda todas; ON_DEMAND entrega uma a uma). NUNCA responda completed no mesmo turno em que criou subtasks.',
          '4. As conclusoes das subtasks chegam como eventos no proximo turno. Valide cada entrega na subtask original e so entao consolide ou retorne waiting aguardando as mesmas taskIds.',
          '5. So responda completed com a mensagem final ao usuario depois de validar e consolidar as subtasks.',
          '',
          'QUANDO PARAR (decisao final)',
          '- CONCLUIDA: todas as subtasks terminaram e voce consolidou o resultado. -> status completed.',
          '- PRECISA DE RESPOSTA: bloqueado, precisa de decisao do usuario. -> status completed com a pergunta clara em messages.',
        ]
      : [
          '',
          'SEU PAPEL: EXECUTOR',
          '- Execute a tarefa diretamente e retorne o resultado final. NAO delegue, NAO crie subtasks.',
          '- Para produzir arquivos use create_artifact. Para feedback de progresso use post_message.',
          '',
          'QUANDO PARAR (decisao final)',
          '- CONCLUIDA: o trabalho foi entregue. Coloque o resultado final em messages. -> status completed.',
          '- PRECISA DE RESPOSTA: bloqueado, precisa de decisao do usuario. -> status completed com a pergunta clara em messages.',
        ];

    const outputBlock = [
      '',
      'FORMATO DE SAIDA',
      'Sua decisao final e UM unico objeto JSON do contrato (campo status), sem nenhum texto fora dele e sem cercas de codigo.',
      'O campo messages[].text e a SUA mensagem ao usuario em linguagem natural (markdown) — escreva como falaria com uma pessoa. NUNCA coloque JSON, o proprio contrato, nem estruturas internas (step/scope/checklist/etc.) dentro de text; o usuario nao pediu JSON.',
      'Exatamente um destes:',
      `completado: ${JSON.stringify({ status: 'completed', messages: [{ type: 'text', text: 'conclusao ao usuario em linguagem natural (markdown)' }] })}`,
      ...(canDelegate
        ? [`aguardando: ${JSON.stringify({ status: 'waiting', waitGroups: [{ waitId: 'g1', mode: 'WAIT_ALL', taskIds: ['<taskId-retornado-por-create_subtask>'] }], messages: [{ type: 'text', text: 'motivo' }] })}`]
        : []),
      `retry: ${JSON.stringify({ status: 'retry', instructions: 'novas instrucoes', messages: [{ type: 'text', text: 'motivo' }] })}`,
    ];

    const systemPrompt = [...commonHeader, ...roleBlock, ...outputBlock].join('\n');

    const prompt = buildPrompt(task, metadata, triggerEvents, this.maxPromptChatMessages, continuity);

    // post_message + create_artifact go to every agent; create_subtask only when
    // depth/subtask ceilings allow another delegation layer.
    const customTools = orquestrator.buildAgentTools(task, canDelegate);
    // Use agent-specific tools (from definition) + custom orchestration tools
    const tools = [...agent.tools, ...customTools.map((tool) => tool.name)];

    return {
      cwd: taskWorkspaceDir,
      model: modelConfig,
      thinkingLevel: runtimeConfig.effort,
      tools,
      systemPrompt,
      prompt,
      customTools,
      sessionManager: undefined,
      resourceLoader: undefined,
      signal,
    };
  }

  async repairInvalidOutput(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    errorMessage: string,
    invalidOutput: string,
    signal?: AbortSignal,
  ): Promise<AgentRunResult> {
    return this.runner.run(this.buildRepairRunConfig(agent, task, orquestrator, errorMessage, invalidOutput, signal));
  }

  buildRepairRunConfig(
    agent: Agent,
    task: Task,
    orquestrator: Orquestrator,
    errorMessage: string,
    invalidOutput: string,
    signal?: AbortSignal,
  ): AgentRunConfig {
    const runtimeConfig = orquestrator.resolveRuntimeConfig(task, agent);
    const modelConfig = this.allowedModels[runtimeConfig.model];
    if (!modelConfig) {
      throw new Error(`Modelo alias ${runtimeConfig.model} não encontrado`);
    }

    const prompt = [
      'A resposta anterior nao respeitou o contrato JSON.',
      `Erro: ${errorMessage}`,
      'Corrija a resposta anterior e retorne SOMENTE um objeto JSON valido, sem texto fora dele e sem cercas de codigo.',
      `Contrato: ${JSON.stringify({ status: 'completed', messages: [{ type: 'text', text: 'mensagem final ao usuario' }] })}`,
      `Saida anterior:\n${invalidOutput.slice(0, 4000)}`,
    ].join('\n\n');

    return {
      cwd: orquestrator.getTaskWorkspaceDir(task.taskId),
      model: modelConfig,
      thinkingLevel: runtimeConfig.effort,
      tools: [],
      systemPrompt: 'Voce corrige somente o formato da resposta final para JSON valido no contrato pedido.',
      prompt,
      customTools: [],
      sessionManager: undefined,
      resourceLoader: undefined,
      signal,
    };
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
