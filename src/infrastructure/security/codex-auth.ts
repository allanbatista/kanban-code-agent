import { spawn as nodeSpawn } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { codexHomePath, ensureCodexHome } from './codex-home.js';
import { JsonRpcStdioSession } from '../../cli/codex-runner.js';

// ---------------------------------------------------------------------------
// Auth compartilhada do Codex (plan-agents-and-container-isolation.md §8). Vive
// UMA vez no CODEX_HOME compartilhado (<dataDir>/.swarm/auth/codex/auth.json) e
// todos os runs/containers reusam. O Master e o unico escritor do auth.json, por
// isso serializamos login (um por vez) via flag em memoria. Segredos (key/token)
// nunca aparecem em log, resposta ou evento.
//
// - login apiKey: `codex login --with-api-key` com a key SO por stdin (nunca argv).
// - login deviceCode: app-server JSON-RPC account/login/start {type:chatgptDeviceCode}
//   -> {loginId, verificationUrl, userCode}; completa via account/login/completed.
// - status: leitura do auth.json compartilhado (fonte da verdade) — polling de
//   status nao justifica subir um app-server. Nunca devolve tokens.
// - logout: remocao do auth.json (o Master e dono do dir).
// ---------------------------------------------------------------------------

const CLIENT_INFO = { name: 'kanban-code-agent', title: 'Kanban Code Agent', version: '0.1.0' };
// ponytail: janela de vida do app-server enquanto o device-code nao completa;
// evita processo orfao se o usuario abandonar o login.
const DEVICE_LOGIN_TIMEOUT_MS = 15 * 60_000;

/** Binario ausente (SWARM_CODEX_BIN nao instalado) -> rota responde 503. */
export class CodexBinaryMissingError extends Error {
  constructor(bin: string) {
    super(`Codex CLI nao encontrado: ${bin}`);
    this.name = 'CodexBinaryMissingError';
  }
}

/** Login concorrente -> rota responde 409 (um login por vez, plan §8). */
export class LoginBusyError extends Error {
  constructor() {
    super('Ja existe um login do Codex em andamento.');
    this.name = 'LoginBusyError';
  }
}

export interface CodexAuthStatus {
  loggedIn: boolean;
  method?: 'apiKey' | 'chatgpt';
  email?: string;
  plan?: string;
}

export interface DeviceCodeLogin {
  loginId: string;
  verificationUrl: string;
  userCode: string;
}

export interface CodexAuthOptions {
  /** Binario do codex. Env SWARM_CODEX_BIN vence; default 'codex'. */
  bin?: string;
  /** Injecao para testes. */
  spawn?: typeof nodeSpawn;
}

export class CodexAuthManager {
  private readonly bin: string;
  private readonly spawnImpl: typeof nodeSpawn;
  private readonly home: string;
  // ponytail: lock em memoria basta enquanto o Master e o unico escritor do
  // auth.json; upgrade: lock file se surgir corrida entre processos distintos.
  private loginInFlight = false;
  private device?: DeviceSession;

  constructor(private readonly dataDir: string, options: CodexAuthOptions = {}) {
    this.bin = options.bin ?? process.env.SWARM_CODEX_BIN ?? 'codex';
    this.spawnImpl = options.spawn ?? nodeSpawn;
    this.home = codexHomePath(dataDir);
  }

  private authPath(): string {
    return join(this.home, 'auth.json');
  }

  /** `codex login --with-api-key`: a key vai SO por stdin, nunca por argv/log. */
  async loginWithApiKey(apiKey: string): Promise<void> {
    if (this.loginInFlight) throw new LoginBusyError();
    this.loginInFlight = true;
    try {
      ensureCodexHome(this.dataDir); // garante o dir 0700 antes do codex gravar auth.json
      await this.runApiKeyLogin(apiKey);
      this.hardenAuthFile();
    } finally {
      this.loginInFlight = false;
    }
  }

  /** Inicia o device-code via app-server; o processo segue vivo ate completar. */
  async startDeviceCodeLogin(): Promise<DeviceCodeLogin> {
    if (this.loginInFlight) throw new LoginBusyError();
    this.loginInFlight = true;
    try {
      ensureCodexHome(this.dataDir);
      const session = new DeviceSession(this.spawnImpl, this.bin, this.home);
      const info = await session.start();
      this.device = session;
      // Ao completar (ou timeout/erro) endurece o auth.json e libera o lock.
      session.onDone((success) => {
        if (success) this.hardenAuthFile();
        if (this.device === session) this.device = undefined;
        this.loginInFlight = false;
      });
      return info;
    } catch (err) {
      this.loginInFlight = false;
      throw err;
    }
  }

  /** Status a partir do auth.json compartilhado. Nunca devolve tokens/keys. */
  readStatus(): CodexAuthStatus {
    const path = this.authPath();
    if (!existsSync(path)) return { loggedIn: false };
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    } catch {
      return { loggedIn: false };
    }
    const tokens = raw.tokens as Record<string, unknown> | undefined;
    const method: CodexAuthStatus['method'] = raw.OPENAI_API_KEY ? 'apiKey' : tokens ? 'chatgpt' : undefined;
    if (!method) return { loggedIn: false };
    // ponytail: email/plan best-effort do id_token (JWT nao verificado, so display);
    // ausencia nao invalida o login. O token em si nunca sai daqui.
    const claims = typeof tokens?.id_token === 'string' ? decodeJwtClaims(tokens.id_token) : undefined;
    return { loggedIn: true, method, email: claims?.email, plan: claims?.plan };
  }

  /** Remove o auth.json compartilhado. ponytail: sem revogar o token no servidor
   * (account/logout via app-server) — desnecessario para o corte atual. */
  logout(): void {
    if (this.device) {
      this.device.cancel();
      this.device = undefined;
      this.loginInFlight = false;
    }
    rmSync(this.authPath(), { force: true });
  }

  private hardenAuthFile(): void {
    // Defensivo: o codex ja grava 0600, mas reforca (auth.json nunca world-readable).
    try {
      if (existsSync(this.authPath())) chmodSync(this.authPath(), 0o600);
    } catch {
      // permissao ja restrita ou dir removido; nao ha o que corrigir.
    }
  }

  private runApiKeyLogin(apiKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.spawnImpl(this.bin, ['login', '--with-api-key'], {
        stdio: ['pipe', 'ignore', 'pipe'],
        env: { ...process.env, CODEX_HOME: this.home },
      });
      let stderr = '';
      child.stderr?.setEncoding('utf-8');
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.stdin?.on('error', () => undefined); // EPIPE se o processo morrer antes do write
      child.on('error', (err: NodeJS.ErrnoException) => {
        reject(err.code === 'ENOENT' ? new CodexBinaryMissingError(this.bin) : err);
      });
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`codex login falhou (code=${code})${stderr ? `: ${stderr.trim()}` : ''}`));
      });
      // A key vai SO pelo stdin — nunca em argv, nunca logada.
      child.stdin?.end(apiKey);
    });
  }
}

// ---------------------------------------------------------------------------
// DeviceSession: fluxo device-code sobre o transporte JSON-RPC compartilhado
// (JsonRpcStdioSession, em codex-runner). Lifecycle distinto do CodexSession: o
// processo fica vivo aguardando a notificacao account/login/completed.
// ponytail: partes account/* do app-server sao experimentais; fixamos o binario
// no bundle (F2) e cobrimos o handshake por teste de contrato.
// ---------------------------------------------------------------------------

class DeviceSession extends JsonRpcStdioSession {
  private doneCb?: (success: boolean) => void;
  private settled = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly spawnImpl: typeof nodeSpawn,
    private readonly bin: string,
    private readonly home: string,
  ) {
    super();
  }

  async start(): Promise<DeviceCodeLogin> {
    const child = this.spawnImpl(this.bin, ['app-server'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, CODEX_HOME: this.home },
    });
    this.bindChild(child);
    child.stdin?.on('error', () => undefined);

    const failed = new Promise<never>((_, reject) => {
      child.on('error', (err: NodeJS.ErrnoException) => {
        reject(err.code === 'ENOENT' ? new CodexBinaryMissingError(this.bin) : err);
      });
      child.on('exit', () => {
        this.finish(false);
        reject(new Error('codex app-server encerrou antes de iniciar o login'));
      });
    });

    const flow = (async () => {
      await this.request('initialize', { clientInfo: CLIENT_INFO, capabilities: {} });
      this.notify('initialized', {});
      const res = (await this.request('account/login/start', { type: 'chatgptDeviceCode' })) as Record<string, unknown>;
      this.timer = setTimeout(() => this.finish(false), DEVICE_LOGIN_TIMEOUT_MS);
      return {
        loginId: String(res.loginId ?? ''),
        verificationUrl: String(res.verificationUrl ?? ''),
        userCode: String(res.userCode ?? ''),
      };
    })();

    return Promise.race([flow, failed]);
  }

  onDone(cb: (success: boolean) => void): void {
    this.doneCb = cb;
  }

  cancel(): void {
    this.finish(false);
  }

  // Unica notificacao de interesse do device-code; as demais sao ignoradas.
  protected override handleNotification(method: string, params: Record<string, unknown>): void {
    if (method === 'account/login/completed') {
      this.finish(Boolean((params as { success?: boolean }).success));
    }
  }

  private finish(success: boolean): void {
    if (this.settled) return;
    this.settled = true;
    if (this.timer) clearTimeout(this.timer);
    const cb = this.doneCb;
    try {
      this.child?.stdin?.end();
    } catch {
      // stdin pode ja estar fechado.
    }
    this.kill();
    cb?.(success);
  }
}

function decodeJwtClaims(jwt: string): { email?: string; plan?: string } | undefined {
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return undefined;
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as Record<string, unknown>;
    const auth = json['https://api.openai.com/auth'] as Record<string, unknown> | undefined;
    const email = typeof json.email === 'string' ? json.email : undefined;
    const plan = typeof auth?.chatgpt_plan_type === 'string' ? (auth.chatgpt_plan_type as string) : undefined;
    return { email, plan };
  } catch {
    return undefined;
  }
}
