import { spawn, type ChildProcess } from 'node:child_process';
import { RunCancelledError, type AgentRunConfig, type AgentRunResult } from '../application/pi-client.js';

// ---------------------------------------------------------------------------
// Cliente JSON-RPC 2.0 sobre stdio para o processo `codex app-server`.
// Protocolo: https://learn.chatgpt.com/docs/app-server (newline-delimited JSON).
// Handshake initialize/initialized -> thread/start -> turn/start; o turno
// termina via notificacao turn/completed (nao pela resposta do turn/start).
// Cada chamada gerencia UM processo do inicio ao fim (spawn -> kill), mantendo
// tasks paralelas isoladas. ponytail: reusar a mesma thread entre run e
// repairInvalidOutput pouparia um handshake; a sessao por chamada evita estado
// compartilhado entre runs concorrentes.
// ---------------------------------------------------------------------------

export const DEFAULT_CODEX_BIN = 'codex';
// ponytail: modelo unico configuravel; o alias fast/balanced/deep e ignorado
// para codex neste corte (upgrade: modelos codex por-alias quando necessario).
export const DEFAULT_CODEX_MODEL = 'gpt-5-codex';

export type CodexSandboxPolicy = 'workspaceWrite' | 'externalSandbox';
export type CodexEffort = 'low' | 'medium' | 'high';

const CLIENT_INFO = { name: 'kanban-code-agent', title: 'Kanban Code Agent', version: '0.1.0' };

export interface CodexRunnerOptions {
  /** CODEX_HOME: dir de auth/config compartilhado. F1.2 cria o dir; aqui so recebemos o path. */
  codexHome: string;
  /** Binario do app-server. Env SWARM_CODEX_BIN vence; default 'codex'. */
  bin?: string;
  /** Injecao para testes (fake app-server via process.execPath). */
  spawn?: typeof spawn;
}

export interface CodexTurnParams {
  cwd: string;
  model: string;
  effort: CodexEffort;
  sandboxPolicy: CodexSandboxPolicy;
  outputSchema?: Record<string, unknown>;
  /** System prompt dobra no input: o app-server nao expoe campo proprio. */
  systemPrompt?: string;
  prompt: string;
  /** Socket UDS do tool-callback deste run; vira env KCA_TOOLS_SOCKET no app-server. */
  toolsSocket?: string;
  signal?: AbortSignal;
}

export interface CodexUsage {
  input?: number;
  output?: number;
  cache?: number;
  total?: number;
}

export interface CodexTurnResult {
  output: string;
  usage: CodexUsage;
}

// ---------------------------------------------------------------------------
// Peca reusavel de "rodar um turno" a partir de um AgentRunConfig serializado.
// Compartilhada pelo CodexAgentClient (inproc) e pelo worker out-of-process
// (docker) — ambos so tem o config + um socket de tools, sem Orquestrator.
// DECISION_OUTPUT_SCHEMA/mapEffort moram aqui (nivel-runner) e o CodexAgentClient
// os reexporta para manter a superficie publica.
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

export interface RunCodexTurnOptions {
  model: string;
  sandboxPolicy: CodexSandboxPolicy;
  outputSchema?: Record<string, unknown>;
  /** Socket UDS do tool-callback deste run (vira KCA_TOOLS_SOCKET no app-server). */
  toolsSocket?: string;
  signal?: AbortSignal;
}

/**
 * Roda um turno do Codex a partir do config serializado e devolve o AgentRunResult.
 * Nao sobe o tool-server nem cria o CODEX_HOME — o chamador (client inproc ou
 * worker docker) cuida disso e passa o socket em `toolsSocket`.
 */
export async function runCodexTurn(
  runner: CodexRunner,
  config: Pick<AgentRunConfig, 'cwd' | 'thinkingLevel' | 'systemPrompt' | 'prompt'>,
  opts: RunCodexTurnOptions,
): Promise<AgentRunResult> {
  const result = await runner.runTurn({
    cwd: config.cwd,
    model: opts.model,
    effort: mapEffort(config.thinkingLevel),
    sandboxPolicy: opts.sandboxPolicy,
    outputSchema: opts.outputSchema ?? DECISION_OUTPUT_SCHEMA,
    systemPrompt: config.systemPrompt,
    prompt: config.prompt,
    toolsSocket: opts.toolsSocket,
    signal: opts.signal,
  });
  // ponytail: cost=0 — o app-server nao reporta preco por token (so contagem).
  return { output: result.output, stats: { tokens: result.usage, cost: 0 } };
}

export function mapEffort(level: string): CodexEffort {
  // Codex aceita low|medium|high; mapeia a escala do Pi (off..xhigh).
  // ponytail: mapeamento grosso; efforts por-alias do codex quando necessario.
  if (level === 'high' || level === 'xhigh') return 'high';
  if (level === 'medium') return 'medium';
  return 'low';
}

export class CodexRunner {
  private readonly bin: string;
  private readonly spawnImpl: typeof spawn;

  constructor(private readonly options: CodexRunnerOptions) {
    this.bin = options.bin ?? process.env.SWARM_CODEX_BIN ?? DEFAULT_CODEX_BIN;
    this.spawnImpl = options.spawn ?? spawn;
  }

  async runTurn(params: CodexTurnParams): Promise<CodexTurnResult> {
    if (params.signal?.aborted) throw new RunCancelledError();
    const session = new CodexSession(this.spawnImpl, this.bin, this.options.codexHome, params.toolsSocket);
    try {
      return await session.execute(params);
    } finally {
      session.dispose();
    }
  }
}

// ---------------------------------------------------------------------------
// Transporte JSON-RPC 2.0 newline-delimited sobre o stdio de um ChildProcess:
// correlaciona request/response por id, entrega notificacoes e requests
// server->client via hooks sobrescreviveis, e rejeita os pendentes em erro/kill.
// O ciclo de vida (spawn, error/exit, quando encerrar) fica nas subclasses:
// CodexSession (turno, aqui) e DeviceSession (device-code login, em codex-auth.ts).
// ---------------------------------------------------------------------------

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class JsonRpcStdioSession {
  protected child?: ChildProcess;
  private nextId = 1;
  protected readonly pending = new Map<number, Pending>();
  private buffer = '';
  // Enquanto true, send() vira no-op (processo descartado/encerrado).
  protected closed = false;

  // Liga o stdio do processo ao parser newline-delimited. Subclasses chamam
  // quando ja tem o ChildProcess (spawn no construtor ou lazy no start()).
  protected bindChild(child: ChildProcess): void {
    this.child = child;
    child.stdout?.setEncoding('utf-8');
    child.stdout?.on('data', (chunk: string) => this.onData(chunk));
  }

  protected request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  protected notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  /** id para requests fire-and-forget que nao registram pendente (ex.: turn/interrupt). */
  protected nextRequestId(): number {
    return this.nextId++;
  }

  protected send(message: Record<string, unknown>): void {
    if (this.closed) return;
    try {
      this.child?.stdin?.write(JSON.stringify(message) + '\n');
    } catch (error) {
      this.onSendError(error);
    }
  }

  /** SIGKILL se o processo ainda estiver vivo. */
  protected kill(): void {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      try {
        this.child.kill('SIGKILL');
      } catch {
        // processo pode ja ter saido.
      }
    }
  }

  /** Rejeita todos os pendentes (erro de transporte / processo encerrado). */
  protected failAll(error: unknown): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      this.dispatch(message);
    }
  }

  private dispatch(message: Record<string, unknown>): void {
    const hasId = message.id !== undefined && message.id !== null;
    const hasMethod = typeof message.method === 'string';

    // Resposta a uma request nossa (id + result/error, sem method).
    if (hasId && !hasMethod) {
      const pending = this.pending.get(message.id as number);
      if (!pending) return;
      this.pending.delete(message.id as number);
      if (message.error) {
        const err = message.error as { message?: string };
        pending.reject(new Error(err.message ?? JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    const params = (message.params ?? {}) as Record<string, unknown>;
    // Request server->client (id + method): delega ao hook.
    if (hasId && hasMethod) {
      this.handleServerRequest(message.id as number, message.method as string, params);
      return;
    }
    // Notificacao (method sem id): delega ao hook.
    if (hasMethod) this.handleNotification(message.method as string, params);
  }

  // Hooks — no-op por default; subclasses sobrescrevem conforme o protocolo delas.
  protected handleServerRequest(_id: number, _method: string, _params: Record<string, unknown>): void {}
  protected handleNotification(_method: string, _params: Record<string, unknown>): void {}
  protected onSendError(_error: unknown): void {}
}

// ---------------------------------------------------------------------------
// Sessao de turno: um processo app-server sobre o transporte acima. Lifecycle
// proprio: notificacoes de turno, decline defensivo de approvals, abort->kill.
// ---------------------------------------------------------------------------

class CodexSession extends JsonRpcStdioSession {
  private deltas = '';
  private lastAgentMessage?: string;
  private readonly usage: CodexUsage = {};
  private turnResolve?: (result: CodexTurnResult) => void;
  private turnReject?: (reason: unknown) => void;
  private threadId?: string;
  private turnId?: string;
  private aborted = false;
  private abortKillTimer?: ReturnType<typeof setTimeout>;

  constructor(
    spawnImpl: typeof spawn,
    bin: string,
    codexHome: string,
    toolsSocket?: string,
  ) {
    super();
    const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: codexHome };
    if (toolsSocket) env.KCA_TOOLS_SOCKET = toolsSocket;
    const child = spawnImpl(bin, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], env });
    this.bindChild(child);
    child.on('error', (error) => this.failAll(error));
    child.on('exit', (code, signal) => {
      if (this.closed) return;
      this.failAll(new Error(`codex app-server encerrou (code=${code} signal=${signal})`));
    });
  }

  async execute(params: CodexTurnParams): Promise<CodexTurnResult> {
    await this.request('initialize', {
      clientInfo: CLIENT_INFO,
      capabilities: { experimentalApi: false, optOutNotificationMethods: [], requestAttestation: false },
    });
    this.notify('initialized', {});

    const started = (await this.request('thread/start', {
      model: params.model,
      cwd: params.cwd,
      approvalPolicy: 'never',
      // codex app-server (0.144.1) espera o enum kebab-case; camelCase e rejeitado
      // ("unknown variant"). externalSandbox -> danger-full-access (o container e o
      // sandbox); senao workspace-write (dev/inproc).
      sandbox: params.sandboxPolicy === 'externalSandbox' ? 'danger-full-access' : 'workspace-write',
    })) as { thread?: { id?: string } };
    this.threadId = started.thread?.id;

    // O turno so encerra via notificacao turn/completed; prepara a promise antes
    // de enviar turn/start para nao perder um completed rapido.
    const turnDone = new Promise<CodexTurnResult>((resolve, reject) => {
      this.turnResolve = resolve;
      this.turnReject = reject;
    });
    // turn/completed pode chegar no mesmo chunk que (ou antes de) a resposta do
    // turn/start, rejeitando turnDone antes de alcancarmos `await turnDone`.
    // Marca a rejeicao como tratada para nao virar unhandledRejection; o
    // `await turnDone` abaixo continua observando o erro normalmente.
    turnDone.catch(() => undefined);

    const onAbort = () => {
      this.aborted = true;
      this.interrupt();
      // Kill forcado se o app-server nao emitir interrupted em tempo.
      this.abortKillTimer = setTimeout(() => this.kill(), 500);
    };
    if (params.signal?.aborted) {
      onAbort();
    } else {
      params.signal?.addEventListener('abort', onAbort);
    }

    try {
      const turn = (await this.request('turn/start', {
        threadId: this.threadId,
        input: buildInput(params),
        cwd: params.cwd,
        model: params.model,
        effort: params.effort,
        approvalPolicy: 'never',
        sandboxPolicy: buildSandboxPolicy(params),
        outputSchema: params.outputSchema,
      })) as { turn?: { id?: string } };
      this.turnId = turn.turn?.id;
      if (this.aborted) this.interrupt();
      return await turnDone;
    } finally {
      params.signal?.removeEventListener('abort', onAbort);
    }
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.abortKillTimer) clearTimeout(this.abortKillTimer);
    this.child?.stdout?.removeAllListeners();
    try {
      this.child?.stdin?.end();
    } catch {
      // stdin pode ja estar fechado.
    }
    this.kill();
  }

  private interrupt(): void {
    if (!this.threadId) return;
    // turn/interrupt e uma request; fire-and-forget (o interessa e a notificacao
    // turn/completed status interrupted que segue).
    this.send({ jsonrpc: '2.0', id: this.nextRequestId(), method: 'turn/interrupt', params: { threadId: this.threadId, turnId: this.turnId } });
  }

  protected override handleServerRequest(id: number, method: string): void {
    // approvalPolicy 'never' nao deveria disparar approvals; declina defensivamente.
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      this.send({ jsonrpc: '2.0', id, result: 'decline' });
      return;
    }
    this.send({ jsonrpc: '2.0', id, error: { code: -32601, message: `metodo nao suportado: ${method}` } });
  }

  protected override handleNotification(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case 'item/agentMessage/delta': {
        const delta = params.textDelta;
        if (typeof delta === 'string') this.deltas += delta;
        break;
      }
      case 'item/completed': {
        const item = params.item as { type?: string; text?: string } | undefined;
        if (item?.type === 'agentMessage' && typeof item.text === 'string') this.lastAgentMessage = item.text;
        break;
      }
      case 'thread/tokenUsage/updated': {
        // Shape real (schema v2): params.tokenUsage.total e um TokenUsageBreakdown cumulativo.
        const tokenUsage = params.tokenUsage as { total?: Record<string, unknown> } | undefined;
        this.mergeUsage(tokenUsage?.total);
        break;
      }
      case 'turn/completed':
        this.completeTurn((params.turn ?? {}) as Record<string, unknown>);
        break;
    }
  }

  private completeTurn(turn: Record<string, unknown>): void {
    this.mergeUsage(turn.usage as Record<string, unknown> | undefined);
    const status = turn.status;
    if (status === 'completed') {
      const structured = extractStructured(turn);
      const output = structured ?? this.lastAgentMessage ?? this.deltas;
      this.turnResolve?.({ output: output ?? '', usage: this.usage });
    } else if (status === 'interrupted') {
      // Mirror do PiAgentClient: cancelamento vira RunCancelledError.
      this.turnReject?.(new RunCancelledError());
    } else {
      const error = turn.error as { message?: string } | undefined;
      this.turnReject?.(new Error(`Codex turn falhou: ${error?.message ?? status}`));
    }
    this.turnResolve = undefined;
    this.turnReject = undefined;
  }

  private mergeUsage(usage: Record<string, unknown> | undefined): void {
    if (!usage || typeof usage !== 'object') return;
    // Campos reais do TokenUsageBreakdown (codex app-server 0.144.1, schema v2:
    // ThreadTokenUsageUpdatedNotification -> ThreadTokenUsage -> TokenUsageBreakdown).
    const input = num(usage.inputTokens);
    const output = num(usage.outputTokens);
    const total = num(usage.totalTokens);
    const cache = num(usage.cachedInputTokens);
    if (input !== undefined) this.usage.input = input;
    if (output !== undefined) this.usage.output = output;
    if (total !== undefined) this.usage.total = total;
    if (cache !== undefined) this.usage.cache = cache;
  }

  // Aborto do turno vira RunCancelledError (espelha o PiAgentClient) tanto nos
  // pendentes quanto na promise do turno; erro de write tambem cai aqui.
  protected override failAll(error: unknown): void {
    const finalError = this.aborted ? new RunCancelledError() : error;
    super.failAll(finalError);
    this.turnReject?.(finalError);
    this.turnResolve = undefined;
    this.turnReject = undefined;
  }

  protected override onSendError(error: unknown): void {
    this.failAll(error);
  }
}

function buildInput(params: CodexTurnParams): Array<{ type: 'text'; text: string }> {
  const items: Array<{ type: 'text'; text: string }> = [];
  if (params.systemPrompt && params.systemPrompt.trim().length > 0) {
    items.push({ type: 'text', text: params.systemPrompt });
  }
  items.push({ type: 'text', text: params.prompt });
  return items;
}

function buildSandboxPolicy(params: CodexTurnParams): Record<string, unknown> {
  // externalSandbox: o container e o sandbox (F2 passa isso). workspaceWrite: dev/inproc.
  if (params.sandboxPolicy === 'externalSandbox') {
    return { type: 'externalSandbox', networkAccess: 'enabled' };
  }
  return { type: 'workspaceWrite', writableRoots: [params.cwd], networkAccess: true };
}

function extractStructured(turn: Record<string, unknown>): string | undefined {
  const raw = turn.output ?? turn.result;
  if (raw === undefined || raw === null) return undefined;
  return typeof raw === 'string' ? raw : JSON.stringify(raw);
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
