import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// F2.2: valida o build do worker bundle montavel. Asserts puros de node no
// bundle (existe/executavel); o smoke em container so roda quando docker esta
// disponivel (mirror do skipIf das validacoes live).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = join(ROOT, 'dist-worker');

function has(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasCodex = has('sh', ['-c', 'command -v codex']);
const hasDocker = has('docker', ['version']);

function isExecutable(path: string): boolean {
  return (statSync(path).mode & 0o111) !== 0;
}

// Roda docker com dist-worker montado read-only em /kca/bin.
function dockerRun(argv: string[]): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(
    'docker',
    ['run', '--rm', '-v', `${OUT}:/kca/bin:ro`, 'debian:bookworm-slim', ...argv],
    { encoding: 'utf-8' },
  );
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

describe('build-worker-bundle', () => {
  beforeAll(() => {
    const env = { ...process.env, ...(hasCodex ? {} : { KCA_SKIP_CODEX: '1' }) };
    execFileSync(process.execPath, [join(ROOT, 'scripts/build-worker-bundle.mjs')], {
      cwd: ROOT,
      env,
      stdio: 'pipe',
    });
  }, 180_000);

  it('emite os bundles single-file executaveis', () => {
    for (const name of ['worker.mjs', 'mcp-bridge.mjs']) {
      const abs = join(OUT, name);
      expect(statSync(abs).size).toBeGreaterThan(0);
    }
  });

  it('copia o binario node executavel', () => {
    const nodeBin = join(OUT, 'bin/node');
    expect(statSync(nodeBin).size).toBeGreaterThan(0);
    expect(isExecutable(nodeBin)).toBe(true);
  });

  it.skipIf(!hasCodex)('copia o binario codex executavel', () => {
    const codexBin = join(OUT, 'bin/codex');
    expect(statSync(codexBin).size).toBeGreaterThan(0);
    expect(isExecutable(codexBin)).toBe(true);
  });

  it('emite manifest.json com sources e entries', () => {
    const manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf-8'));
    expect(manifest.builtAt).toBeTruthy();
    expect(manifest.sources).toContain('src/worker/main.ts');
    const names = manifest.entries.map((e: { name: string }) => e.name);
    expect(names).toContain('worker.mjs');
    expect(names).toContain('bin/node');
  });

  describe.skipIf(!hasDocker)('smoke em container glibc sem node', () => {
    it('roda worker.mjs --help (exit 0, usage)', () => {
      const res = dockerRun(['/kca/bin/bin/node', '/kca/bin/worker.mjs', '--help']);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('kca-worker');
    }, 120_000);

    it('mcp-bridge.mjs sem KCA_TOOLS_SOCKET falha com erro claro', () => {
      const res = dockerRun(['/kca/bin/bin/node', '/kca/bin/mcp-bridge.mjs']);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('KCA_TOOLS_SOCKET');
    }, 120_000);

    it.skipIf(!hasCodex)('codex --version roda (musl static-pie em glibc)', () => {
      const res = dockerRun(['/kca/bin/bin/codex', '--version']);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('codex-cli');
    }, 120_000);
  });
});
