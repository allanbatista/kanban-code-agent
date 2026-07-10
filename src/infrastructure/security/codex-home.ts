import { chmodSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AtomicWriter } from '../filesystem/atomic-writer.js';

// ---------------------------------------------------------------------------
// CODEX_HOME compartilhado: <dataDir>/.swarm/auth/codex/ (0700). Guarda dois
// arquivos: auth.json (login do Codex — NUNCA tocado por este modulo) e
// config.toml (registra o MCP bridge das tools do Master). config.toml e
// regenerado idempotentemente via AtomicWriter; o socket do tool-callback muda
// por-run e chega pelo env KCA_TOOLS_SOCKET (encaminhado via env_vars), por isso
// nao entra no arquivo. ponytail: config.toml e de nossa propriedade neste
// corte; se surgir config codex do usuario (modelo, etc), fazer merge do TOML.
// ---------------------------------------------------------------------------

export const MCP_SERVER_NAME = 'kca_tools';

export interface EnsureCodexHomeOptions {
  /** Node que executa o bridge (default process.execPath). */
  nodeBin?: string;
  /** Entry do bridge (default src/worker/mcp-bridge.ts; F2 troca pelo bundle). */
  bridgeEntry?: string;
  /** true (default): roda o bridge via `--import tsx <entry>` (dev/inproc/source
   *  no container). false: o entry e um bundle .mjs executado direto (sem tsx). */
  useTsx?: boolean;
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
  // ponytail: em dev/inproc roda o bridge via tsx, espelhando worker-supervisor
  // (nodeBin --import tsx <entry>); o bundle esbuild (docker) passa useTsx=false.
  const bridgeEntry = options.bridgeEntry ?? resolve('src/worker/mcp-bridge.ts');
  AtomicWriter.write(join(home, 'config.toml'), renderConfigToml(nodeBin, bridgeEntry, options.useTsx ?? true));
  return home;
}

function renderConfigToml(nodeBin: string, bridgeEntry: string, useTsx: boolean): string {
  const args = useTsx ? ['--import', 'tsx', bridgeEntry] : [bridgeEntry];
  return [
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    `command = ${tomlString(nodeBin)}`,
    `args = [${args.map(tomlString).join(', ')}]`,
    // O socket por-run vem no env do app-server; env_vars o encaminha ao bridge.
    'env_vars = ["KCA_TOOLS_SOCKET"]',
    '',
  ].join('\n');
}

function tomlString(value: string): string {
  // TOML basic string: escapa backslash e aspas.
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
