import { spawn, type ChildProcess } from 'node:child_process';
import { RunCancelledError } from '../application/pi-client.js';

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
// Sessao: um processo app-server + transporte JSON-RPC.
// ---------------------------------------------------------------------------

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

class CodexSession {
  private readonly child: ChildProcess;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private buffer = '';
  private deltas = '';
  private lastAgentMessage?: string;
  private readonly usage: CodexUsage = {};
  private turnResolve?: (result: CodexTurnResult) => void;
  private turnReject?: (reason: unknown) => void;
  private threadId?: string;
  private turnId?: string;
  private aborted = false;
  private disposed = false;
  private abortKillTimer?: ReturnType<typeof setTimeout>;

  constructor(
    spawnImpl: typeof spawn,
    bin: string,
    codexHome: string,
    toolsSocket?: string,
  ) {
    const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: codexHome };
    if (toolsSocket) env.KCA_TOOLS_SOCKET = toolsSocket;
    this.child = spawnImpl(bin, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], env });
    this.child.stdout?.setEncoding('utf-8');
    this.child.stdout?.on('data', (chunk: string) => this.onData(chunk));
    this.child.on('error', (error) => this.failAll(error));
    this.child.on('exit', (code, signal) => {
      if (this.disposed) return;
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
      sandbox: params.sandboxPolicy === 'externalSandbox' ? 'dangerFullAccess' : 'workspaceWrite',
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
    if (this.disposed) return;
    this.disposed = true;
    if (this.abortKillTimer) clearTimeout(this.abortKillTimer);
    this.child.stdout?.removeAllListeners();
    try {
      this.child.stdin?.end();
    } catch {
      // stdin pode ja estar fechado.
    }
    this.kill();
  }

  private kill(): void {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      try {
        this.child.kill('SIGKILL');
      } catch {
        // processo pode ja ter saido.
      }
    }
  }

  private interrupt(): void {
    if (!this.threadId) return;
    // turn/interrupt e uma request; fire-and-forget (o interessa e a notificacao
    // turn/completed status interrupted que segue).
    this.send({ jsonrpc: '2.0', id: this.nextId++, method: 'turn/interrupt', params: { threadId: this.threadId, turnId: this.turnId } });
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

    // Request server->client (id + method): responde.
    if (hasId && hasMethod) {
      this.handleServerRequest(message.id as number, message.method as string);
      return;
    }

    // Notificacao (method sem id).
    if (hasMethod) this.handleNotification(message.method as string, (message.params ?? {}) as Record<string, unknown>);
  }

  private handleServerRequest(id: number, method: string): void {
    // approvalPolicy 'never' nao deveria disparar approvals; declina defensivamente.
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      this.send({ jsonrpc: '2.0', id, result: 'decline' });
      return;
    }
    this.send({ jsonrpc: '2.0', id, error: { code: -32601, message: `metodo nao suportado: ${method}` } });
  }

  private handleNotification(method: string, params: Record<string, unknown>): void {
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
      case 'thread/tokenUsage/updated':
        this.mergeUsage((params.usage ?? params) as Record<string, unknown>);
        break;
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
    // ponytail: shape de tokens do app-server e experimental; mapeamos os campos
    // conhecidos, senao ficam zerados (sem cost — nao ha preco por token aqui).
    const input = num(usage.inputTokens ?? usage.input ?? usage.promptTokens);
    const output = num(usage.outputTokens ?? usage.output ?? usage.completionTokens);
    const total = num(usage.totalTokens ?? usage.total);
    const cache = num(usage.cachedTokens ?? usage.cache);
    if (input !== undefined) this.usage.input = input;
    if (output !== undefined) this.usage.output = output;
    if (total !== undefined) this.usage.total = total;
    if (cache !== undefined) this.usage.cache = cache;
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private send(message: Record<string, unknown>): void {
    if (this.disposed) return;
    try {
      this.child.stdin?.write(JSON.stringify(message) + '\n');
    } catch (error) {
      this.failAll(error);
    }
  }

  private failAll(error: unknown): void {
    const finalError = this.aborted ? new RunCancelledError() : error;
    for (const pending of this.pending.values()) pending.reject(finalError);
    this.pending.clear();
    this.turnReject?.(finalError);
    this.turnResolve = undefined;
    this.turnReject = undefined;
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
