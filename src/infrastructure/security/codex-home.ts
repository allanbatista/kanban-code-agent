import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AtomicWriter } from '../filesystem/atomic-writer.js';

// ---------------------------------------------------------------------------
// CODEX_HOME compartilhado: <dataDir>/.swarm/auth/codex/ (0700). Guarda dois
// arquivos: auth.json (login do Codex — NUNCA tocado por este modulo) e
// config.toml (registra o MCP bridge das tools do Master). config.toml e
// regravado idempotentemente via AtomicWriter, preservando o que nao e nosso: so
// o bloco [mcp_servers.kca_tools] (e sua sub-tabela .env) e substituido; secoes
// que o codex CLI append em runtime (ex. [projects."..."] trust_level) sobrevivem.
//
// O socket do tool-callback muda por-run e e injetado no bridge via a sub-tabela
// [mcp_servers.kca_tools.env] (KCA_TOOLS_SOCKET = "<path>"). BUG DE PRODUCAO
// corrigido aqui: o codex 0.144.1 NAO tem a chave `env_vars` no config do MCP —
// o formato real e uma TABELA `env` (verificado via `codex mcp add --env`). Com
// `env_vars` o app-server spawnava o bridge SEM KCA_TOOLS_SOCKET, ele saia 1
// ("obrigatorio") e o Codex ficava sem tools. Como o socket difere por-run e o
// config e compartilhado, o caller inproc serializa [escreve config -> spawn ->
// handshake] sob mutex (ver codex-client.ts). ponytail: merge line-based (ver
// mergeConfigToml); trocar por parser TOML real se o config crescer alem do nosso.
// ---------------------------------------------------------------------------

export const MCP_SERVER_NAME = 'kca_tools';

export interface EnsureCodexHomeOptions {
  /** Node que executa o bridge (default process.execPath). */
  nodeBin?: string;
  /** Entry do bridge. Default derivado de import.meta.url (mesmo layout deste
   *  modulo): src/worker/mcp-bridge.ts em dev/tsx, dist/worker/mcp-bridge.js
   *  compilado. F2 (worker docker) passa o bundle .mjs explicito. */
  bridgeEntry?: string;
  /** Roda o bridge via `--import <tsx> <entry>`. Default derivado do formato deste
   *  modulo: true sob .ts (dev/tsx), false sob .js compilado (node puro roda o
   *  dist direto). O bundle .mjs (docker) passa useTsx=false explicito. */
  useTsx?: boolean;
  /** Especificador do `tsx` para `--import` (so quando useTsx=true). Default: 'tsx'
   *  resolvido para caminho ABSOLUTO. Necessario porque o app-server spawna o bridge
   *  com cwd = workspace da task (NAO o repo); o `tsx` bare daria ERR_MODULE_NOT_FOUND
   *  (nao ha node_modules la). Testes pinam isto p/ assertions deterministicas. */
  tsxImport?: string;
  /** Socket UDS do tool-callback deste run. Quando presente, renderiza a sub-tabela
   *  [mcp_servers.kca_tools.env] com KCA_TOOLS_SOCKET — e assim que o app-server
   *  injeta o socket no bridge (o codex 0.144.1 nao tem `env_vars`; o env e uma
   *  tabela). Ausente: sem tabela env (turno sem tools, ex. generateTitle). */
  toolsSocket?: string;
}

export function codexHomePath(dataDir: string): string {
  return join(dataDir, '.swarm', 'auth', 'codex');
}

/**
 * Garante o CODEX_HOME (dir 0700 + config.toml do MCP bridge) e devolve o path.
 * Idempotente; nunca escreve/remove auth.json.
 */
export function ensureCodexHome(dataDir: string, options: EnsureCodexHomeOptions = {}): string {
  return ensureCodexHomeAt(codexHomePath(dataDir), options);
}

/**
 * Como `ensureCodexHome`, mas recebe o path do CODEX_HOME direto. O worker docker
 * o usa com process.env.CODEX_HOME (path do container, do mount compartilhado)
 * para regravar o config.toml apontando o bridge para paths do container.
 */
export function ensureCodexHomeAt(home: string, options: EnsureCodexHomeOptions = {}): string {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700); // reforca 0700 mesmo se o dir ja existia (umask/pre-existente).
  const nodeBin = options.nodeBin ?? process.execPath;
  // import.meta.url deste modulo termina em .ts (dev/tsx) ou .js (compilado em
  // dist). Deriva o entry irmao do bridge no MESMO layout: ../../worker/mcp-bridge
  // resolve p/ src/worker/mcp-bridge.ts (dev) ou dist/worker/mcp-bridge.js (deploy),
  // que sempre existem. Sob .ts roda via tsx; sob .js, node puro roda o dist direto
  // (o container deploy nao tem src/ nem tsx). Opcoes explicitas ainda sobrescrevem:
  // o worker docker passa bridgeEntry/useTsx do bundle .mjs — nao quebrar isso.
  const compiled = import.meta.url.endsWith('.js');
  const bridgeEntry =
    options.bridgeEntry ?? fileURLToPath(new URL(`../../worker/mcp-bridge${compiled ? '.js' : '.ts'}`, import.meta.url));
  const useTsx = options.useTsx ?? !compiled;
  // Resolve o `tsx` p/ caminho absoluto so quando useTsx=true (o bundle .mjs nao usa
  // tsx). O bare 'tsx' quebra pq o app-server spawna o bridge com cwd = workspace da task.
  const tsxImport = options.tsxImport ?? (useTsx ? resolveTsxImport() : 'tsx');

  // Preserva o config.toml existente EXCETO nosso bloco kca_tools (o codex CLI
  // append secoes proprias em runtime, ex. [projects."..."] trust_level; regerar
  // tudo as apagaria). ponytail: merge line-based (tira nosso bloco, re-anexa o
  // fresco); trocar por parser TOML real se o config crescer alem disto.
  const configPath = join(home, 'config.toml');
  const fresh = renderConfigToml(nodeBin, bridgeEntry, useTsx, options.toolsSocket, tsxImport);
  AtomicWriter.write(configPath, mergeConfigToml(readIfExists(configPath), fresh));
  return home;
}

/** Le o arquivo se existir; undefined se ausente (config.toml de primeira vez). */
function readIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined; // ENOENT (ou ilegivel): trata como sem config previo.
  }
}

/**
 * Junta o conteudo preservado (config existente sem nosso bloco) com o bloco
 * kca_tools fresco. Line-based, sem parser TOML. Idempotente: re-rodar sobre o
 * proprio output rende bytes identicos (o bloco kca sempre e removido e re-anexado).
 */
function mergeConfigToml(existing: string | undefined, freshBlock: string): string {
  if (existing === undefined) return freshBlock;
  const preserved = stripKcaBlock(existing).replace(/\s+$/, ''); // tira blank lines finais
  return preserved === '' ? freshBlock : `${preserved}\n\n${freshBlock}`;
}

/**
 * Remove nosso bloco `[mcp_servers.kca_tools]` E sua sub-tabela `.env`: de cada
 * header nosso (na coluna 0) ate o proximo header estrangeiro na coluna 0 ou o
 * EOF. Preserva todo o resto. O `.env` conta como nosso (prefixo
 * `[mcp_servers.kca_tools.`), senao o regen orfanaria a tabela env estale.
 */
function stripKcaBlock(existing: string): string {
  const ourHeader = `[mcp_servers.${MCP_SERVER_NAME}]`;
  const ourSubPrefix = `[mcp_servers.${MCP_SERVER_NAME}.`; // ex.: [...kca_tools.env]
  const out: string[] = [];
  let skipping = false;
  for (const line of existing.split('\n')) {
    if (line.startsWith('[')) {
      // Header de tabela na coluna 0: (re)avalia se e nosso (normaliza espacos).
      const norm = line.replace(/\s+/g, '');
      skipping = norm === ourHeader || norm.startsWith(ourSubPrefix);
    }
    if (!skipping) out.push(line);
  }
  return out.join('\n');
}

/**
 * Resolve o especificador do `tsx` para caminho ABSOLUTO. O codex app-server spawna
 * o MCP bridge com cwd = workspace da task (nao o repo), entao `--import tsx` (bare)
 * falha com ERR_MODULE_NOT_FOUND — nao ha node_modules no cwd da task. O caminho
 * absoluto carrega de qualquer cwd. Usa createRequire (resolver CJS do Node), que
 * funciona sob tsx, node compilado E vitest — ao contrario de import.meta.resolve,
 * que o vite intercepta e faz lancar. So chamado quando useTsx=true (rodando sob
 * tsx => tsx instalado); fallback p/ bare em caso raro.
 */
function resolveTsxImport(): string {
  try {
    return createRequire(import.meta.url).resolve('tsx');
  } catch {
    return 'tsx';
  }
}

function renderConfigToml(nodeBin: string, bridgeEntry: string, useTsx: boolean, toolsSocket: string | undefined, tsxImport: string): string {
  const args = useTsx ? ['--import', tsxImport, bridgeEntry] : [bridgeEntry];
  const lines = [
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    `command = ${tomlString(nodeBin)}`,
    `args = [${args.map(tomlString).join(', ')}]`,
  ];
  if (toolsSocket) {
    // Formato real do codex 0.144.1: tabela `env` (NAO `env_vars`). E assim que o
    // KCA_TOOLS_SOCKET chega ao bridge spawnado pelo app-server. Sub-tabela vem
    // apos as chaves do bloco pai (ordem TOML).
    lines.push('', `[mcp_servers.${MCP_SERVER_NAME}.env]`, `KCA_TOOLS_SOCKET = ${tomlString(toolsSocket)}`);
  }
  lines.push('');
  return lines.join('\n');
}

function tomlString(value: string): string {
  // TOML basic string: escapa backslash e aspas.
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
