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
});
