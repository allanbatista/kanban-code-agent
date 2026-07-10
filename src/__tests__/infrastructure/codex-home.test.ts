import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureCodexHome, codexHomePath, MCP_SERVER_NAME } from '../../infrastructure/security/codex-home.js';

describe('ensureCodexHome', () => {
  const dirs: string[] = [];
  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'codex-home-'));
    dirs.push(dir);
    return dir;
  }
  afterEach(() => {
    while (dirs.length) {
      try {
        rmSync(dirs.pop()!, { recursive: true, force: true });
      } catch {
        /* noop */
      }
    }
  });

  it('cria o dir 0700 e um config.toml que registra o MCP bridge', () => {
    const dataDir = tempDir();
    const home = ensureCodexHome(dataDir, { nodeBin: '/usr/bin/node', bridgeEntry: '/app/mcp-bridge.ts' });

    expect(home).toBe(codexHomePath(dataDir));
    expect(statSync(home).mode & 0o777).toBe(0o700);

    const toml = readFileSync(join(home, 'config.toml'), 'utf-8');
    expect(toml).toContain(`[mcp_servers.${MCP_SERVER_NAME}]`);
    expect(toml).toContain('command = "/usr/bin/node"');
    expect(toml).toContain('args = ["--import", "tsx", "/app/mcp-bridge.ts"]');
    expect(toml).toContain('env_vars = ["KCA_TOOLS_SOCKET"]');
  });

  it('e idempotente e nunca toca o auth.json vizinho', () => {
    const dataDir = tempDir();
    const home = ensureCodexHome(dataDir, { nodeBin: '/usr/bin/node', bridgeEntry: '/app/mcp-bridge.ts' });

    // Login grava auth.json no mesmo dir; ensureCodexHome nao pode mexer nele.
    const authPath = join(home, 'auth.json');
    writeFileSync(authPath, '{"token":"secreto"}', 'utf-8');
    const firstToml = readFileSync(join(home, 'config.toml'), 'utf-8');

    ensureCodexHome(dataDir, { nodeBin: '/usr/bin/node', bridgeEntry: '/app/mcp-bridge.ts' });

    expect(readFileSync(authPath, 'utf-8')).toBe('{"token":"secreto"}');
    expect(readFileSync(join(home, 'config.toml'), 'utf-8')).toBe(firstToml);
    expect(statSync(home).mode & 0o777).toBe(0o700);
  });

  it('escapa backslash e aspas nos paths do TOML', () => {
    const dataDir = tempDir();
    const home = ensureCodexHome(dataDir, { nodeBin: 'C:\\node.exe', bridgeEntry: '/a"b/bridge.ts' });
    const toml = readFileSync(join(home, 'config.toml'), 'utf-8');
    expect(toml).toContain('command = "C:\\\\node.exe"');
    expect(toml).toContain('"/a\\"b/bridge.ts"');
  });

  // (a) Sem bridgeEntry/useTsx explicitos, o default vem de import.meta.url. Sob
  // vitest (roda via tsx) o modulo e .ts, entao resolve p/ src/worker/mcp-bridge.ts
  // + tsx — espelhando o comportamento dev/inproc.
  it('defaults derivam src/worker/mcp-bridge.ts + tsx sob tsx (import.meta.url .ts)', () => {
    const dataDir = tempDir();
    const home = ensureCodexHome(dataDir);
    const toml = readFileSync(join(home, 'config.toml'), 'utf-8');
    expect(toml).toContain('src/worker/mcp-bridge.ts');
    expect(toml).toContain('args = ["--import", "tsx", ');
  });

  // (b) O modo compilado (deploy dist) e simulado passando o entry .js + useTsx=false
  // explicito (o mesmo caminho que executor.ts usa p/ o bundle): node puro roda o
  // dist direto, sem --import tsx.
  it('modo compilado (entry explicito + useTsx=false) roda o entry direto, sem tsx', () => {
    const dataDir = tempDir();
    const home = ensureCodexHome(dataDir, {
      nodeBin: '/usr/bin/node',
      bridgeEntry: '/app/dist/worker/mcp-bridge.js',
      useTsx: false,
    });
    const toml = readFileSync(join(home, 'config.toml'), 'utf-8');
    expect(toml).toContain('args = ["/app/dist/worker/mcp-bridge.js"]');
    expect(toml).not.toContain('tsx');
  });

  // (c) Regerar preserva secoes estranhas (ex. [projects] que o codex CLI append em
  // runtime) e substitui um bloco kca_tools estale.
  it('preserva secao estrangeira e substitui bloco kca_tools estale ao regerar', () => {
    const dataDir = tempDir();
    // Cria o dir 0700 antes de escrever o config falso (regravar exige o home).
    const home = ensureCodexHome(dataDir, { nodeBin: '/old/node', bridgeEntry: '/old/bridge.ts' });
    const configPath = join(home, 'config.toml');
    // Simula o estado no servidor: bloco kca antigo + secao [projects] do codex.
    writeFileSync(
      configPath,
      [
        '[mcp_servers.kca_tools]',
        'command = "/old/node"',
        'args = ["--import", "tsx", "/old/bridge.ts"]',
        'env_vars = ["KCA_TOOLS_SOCKET"]',
        '',
        '[projects."/srv/repo"]',
        'trust_level = "trusted"',
        '',
      ].join('\n'),
      'utf-8',
    );

    ensureCodexHome(dataDir, { nodeBin: '/new/node', bridgeEntry: '/new/bridge.ts' });
    const toml = readFileSync(configPath, 'utf-8');

    // Secao estrangeira sobrevive.
    expect(toml).toContain('[projects."/srv/repo"]');
    expect(toml).toContain('trust_level = "trusted"');
    // Bloco kca estale foi substituido pelo fresco (novos paths, um so bloco).
    expect(toml).toContain('command = "/new/node"');
    expect(toml).toContain('/new/bridge.ts');
    expect(toml).not.toContain('/old/node');
    expect(toml).not.toContain('/old/bridge.ts');
    expect(toml.match(/\[mcp_servers\.kca_tools\]/g)).toHaveLength(1);

    // Idempotente mesmo com secao estrangeira: re-rodar nao altera os bytes.
    const before = readFileSync(configPath, 'utf-8');
    ensureCodexHome(dataDir, { nodeBin: '/new/node', bridgeEntry: '/new/bridge.ts' });
    expect(readFileSync(configPath, 'utf-8')).toBe(before);
  });
});
