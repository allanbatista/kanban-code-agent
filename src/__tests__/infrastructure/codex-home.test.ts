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
    // tsxImport pinado p/ assertion deterministica (o default resolve p/ path absoluto).
    const home = ensureCodexHome(dataDir, { nodeBin: '/usr/bin/node', bridgeEntry: '/app/mcp-bridge.ts', tsxImport: 'tsx' });

    expect(home).toBe(codexHomePath(dataDir));
    expect(statSync(home).mode & 0o777).toBe(0o700);

    const toml = readFileSync(join(home, 'config.toml'), 'utf-8');
    expect(toml).toContain(`[mcp_servers.${MCP_SERVER_NAME}]`);
    expect(toml).toContain('command = "/usr/bin/node"');
    expect(toml).toContain('args = ["--import", "tsx", "/app/mcp-bridge.ts"]');
    // Sem toolsSocket: nada de tabela env. E o formato quebrado `env_vars` (bug de
    // producao: o codex 0.144.1 nao o reconhece) NUNCA e emitido.
    expect(toml).not.toContain('env_vars');
    expect(toml).not.toContain(`[mcp_servers.${MCP_SERVER_NAME}.env]`);
  });

  // O app-server spawna o bridge com cwd = workspace da task; `--import tsx` bare
  // daria ERR_MODULE_NOT_FOUND. O default resolve o tsx p/ um caminho ABSOLUTO.
  it('por padrao resolve o tsx para caminho absoluto (bridge spawna de qualquer cwd)', () => {
    const dataDir = tempDir();
    const home = ensureCodexHome(dataDir, { nodeBin: '/usr/bin/node', bridgeEntry: '/app/mcp-bridge.ts' });
    const toml = readFileSync(join(home, 'config.toml'), 'utf-8');
    // A 2a entrada de args (o especificador do --import) e um path absoluto do tsx,
    // nao o bare 'tsx'.
    const args = toml.match(/args = \[(.*)\]/)![1];
    const specifier = args.split(', ')[1].replace(/^"|"$/g, '');
    expect(specifier.startsWith('/')).toBe(true);
    expect(specifier).toContain('tsx');
    expect(toml).not.toContain('"--import", "tsx"');
  });

  it('com toolsSocket injeta a tabela [mcp_servers.kca_tools.env] com KCA_TOOLS_SOCKET (nao env_vars)', () => {
    const dataDir = tempDir();
    const home = ensureCodexHome(dataDir, {
      nodeBin: '/usr/bin/node',
      bridgeEntry: '/app/mcp-bridge.ts',
      toolsSocket: '/tmp/kca-abc/t.sock',
    });
    const toml = readFileSync(join(home, 'config.toml'), 'utf-8');
    // Formato REAL do codex 0.144.1: tabela env, uma chave por linha.
    expect(toml).toContain(`[mcp_servers.${MCP_SERVER_NAME}.env]`);
    expect(toml).toContain('KCA_TOOLS_SOCKET = "/tmp/kca-abc/t.sock"');
    // Nunca o formato quebrado que causou o bug (bridge spawnado sem o socket).
    expect(toml).not.toContain('env_vars');
    // Sub-tabela vem apos as chaves do bloco pai (ordem TOML valida).
    const parentIdx = toml.indexOf(`[mcp_servers.${MCP_SERVER_NAME}]`);
    const envIdx = toml.indexOf(`[mcp_servers.${MCP_SERVER_NAME}.env]`);
    expect(parentIdx).toBeGreaterThanOrEqual(0);
    expect(envIdx).toBeGreaterThan(parentIdx);
  });

  it('regen troca a tabela .env estale pelo novo socket e preserva secao estrangeira (idempotente)', () => {
    const dataDir = tempDir();
    const home = ensureCodexHome(dataDir, {
      nodeBin: '/n',
      bridgeEntry: '/b.ts',
      toolsSocket: '/tmp/kca-old/t.sock',
    });
    const configPath = join(home, 'config.toml');
    // Injeta uma secao estrangeira que o codex CLI append em runtime.
    writeFileSync(configPath, `${readFileSync(configPath, 'utf-8')}\n[projects."/srv"]\ntrust_level = "trusted"\n`, 'utf-8');

    ensureCodexHome(dataDir, { nodeBin: '/n', bridgeEntry: '/b.ts', toolsSocket: '/tmp/kca-new/t.sock' });
    const toml = readFileSync(configPath, 'utf-8');

    // Socket estale substituido; secao estrangeira sobrevive; um so bloco e uma so .env.
    expect(toml).toContain('KCA_TOOLS_SOCKET = "/tmp/kca-new/t.sock"');
    expect(toml).not.toContain('/tmp/kca-old/t.sock');
    expect(toml).toContain('[projects."/srv"]');
    expect(toml.match(/\[mcp_servers\.kca_tools\]/g)).toHaveLength(1);
    expect(toml.match(/\[mcp_servers\.kca_tools\.env\]/g)).toHaveLength(1);

    // Idempotente: re-rodar com o mesmo socket nao altera os bytes.
    const before = readFileSync(configPath, 'utf-8');
    ensureCodexHome(dataDir, { nodeBin: '/n', bridgeEntry: '/b.ts', toolsSocket: '/tmp/kca-new/t.sock' });
    expect(readFileSync(configPath, 'utf-8')).toBe(before);
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
  // + tsx (path absoluto) — espelhando o comportamento dev/inproc.
  it('defaults derivam src/worker/mcp-bridge.ts + tsx absoluto sob tsx (import.meta.url .ts)', () => {
    const dataDir = tempDir();
    const home = ensureCodexHome(dataDir);
    const toml = readFileSync(join(home, 'config.toml'), 'utf-8');
    expect(toml).toContain('src/worker/mcp-bridge.ts');
    // --import com tsx resolvido p/ path absoluto (nao o bare 'tsx'), p/ o bridge
    // spawnar de qualquer cwd.
    expect(toml).toMatch(/args = \["--import", "\/[^"]*tsx[^"]*", ".*src\/worker\/mcp-bridge\.ts"\]/);
    expect(toml).not.toContain('"--import", "tsx"');
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
