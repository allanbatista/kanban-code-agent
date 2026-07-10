#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-worker-bundle (F2.2): monta um diretorio auto-contido, montavel
// read-only em /kca/bin de QUALQUER container glibc. Fornece:
//   bin/node        -> o proprio process.execPath (node do host)
//   bin/codex       -> binario nativo do codex (static-pie musl, roda em glibc)
//   worker.mjs      -> bundle single-file do worker (src/worker/main.ts)
//   mcp-bridge.mjs  -> bundle single-file do MCP bridge (src/worker/mcp-bridge.ts)
//   manifest.json   -> {builtAt, node, entries: [{name, size, mtime}]} p/ cache/debug
//
// Bundling: esbuild embute TUDO (inclusive @earendil-works/pi-coding-agent).
// Risco conhecido (plano, risco 1): SDK do Pi com require dinamico. Verificado
// em 2026-07: os dois bundles carregam sem crash de import (worker.mjs imprime o
// erro de --socket, mcp-bridge o de KCA_TOOLS_SOCKET). Se um upgrade do SDK
// quebrar o bundle, o fallback e marcar os pacotes como external e copia-los
// para dist-worker/node_modules (estilo `pnpm deploy`) — nao foi necessario.
//
// ponytail: so o binario nativo do codex e copiado; os helpers irmaos do npm
// (rg, bwrap, zsh, codex-code-mode-host) ficam de fora — o handshake e os turnos
// do app-server nao dependem deles (verificado). Upgrade: copiar codex-path/rg e
// codex-resources/ se algum tool de busca/shell precisar da copia bundlada em vez
// da do container.
// ---------------------------------------------------------------------------
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist-worker');
const BIN = join(OUT, 'bin');

// mesma tabela do launcher codex.js (bin/codex.js do @openai/codex).
const CODEX_TARGET_BY_ARCH = {
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
};
const CODEX_PACKAGE_BY_TARGET = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
};

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(BIN, { recursive: true });

  await bundle(join(ROOT, 'src/worker/main.ts'), join(OUT, 'worker.mjs'));
  await bundle(join(ROOT, 'src/worker/mcp-bridge.ts'), join(OUT, 'mcp-bridge.mjs'));

  // node do host: copia (nao symlink) para o mount funcionar sem o host montado.
  const nodeDest = join(BIN, 'node');
  copyFileSync(process.execPath, nodeDest);
  chmodSync(nodeDest, 0o755);

  copyCodex();

  writeManifest();
  console.log(`bundle pronto em ${OUT}`);
}

async function bundle(entry, outfile) {
  await build({
    entryPoints: [entry],
    outfile,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    bundle: true,
    logLevel: 'warning',
  });
  console.log(`  bundle ${outfile} (${size(outfile)})`);
}

function copyCodex() {
  const dest = join(BIN, 'codex');
  const native = resolveCodexNativeBinary();
  if (!native) {
    if (process.env.KCA_SKIP_CODEX === '1') {
      console.warn('  codex ausente e KCA_SKIP_CODEX=1: pulando (bundle sem codex)');
      return;
    }
    throw new Error(
      'binario nativo do codex nao encontrado no PATH; instale @openai/codex ou rode com KCA_SKIP_CODEX=1',
    );
  }
  copyFileSync(native, dest);
  chmodSync(dest, 0o755);
  console.log(`  codex ${dest} (${size(dest)}) <- ${native}`);
}

// Resolve o binario nativo do codex espelhando bin/codex.js: acha o launcher no
// PATH, sobe ao package root e resolve o pacote de plataforma <triple>/bin/codex.
function resolveCodexNativeBinary() {
  let launcher;
  try {
    const [cmd, args] =
      process.platform === 'win32' ? ['where', ['codex']] : ['sh', ['-c', 'command -v codex']];
    launcher = execFileSync(cmd, args, { encoding: 'utf-8' }).split('\n')[0].trim();
  } catch {
    return undefined;
  }
  if (!launcher) return undefined;

  const target = CODEX_TARGET_BY_ARCH[`${process.platform}-${process.arch}`];
  const platformPkg = target && CODEX_PACKAGE_BY_TARGET[target];
  if (!platformPkg) return undefined;

  // launcher (via realpath) = <pkgRoot>/bin/codex.js; resolve o pacote de
  // plataforma a partir do package root, como o require.resolve do codex.js.
  const pkgRoot = resolve(dirname(realpathSync(launcher)), '..');
  const require = createRequire(join(pkgRoot, 'package.json'));
  try {
    const pj = require.resolve(`${platformPkg}/package.json`);
    return join(dirname(pj), 'vendor', target, 'bin', 'codex');
  } catch {
    return undefined;
  }
}

function writeManifest() {
  const entries = ['worker.mjs', 'mcp-bridge.mjs', 'bin/node', 'bin/codex']
    .map((name) => {
      const abs = join(OUT, name);
      try {
        const st = statSync(abs);
        return { name, size: st.size, mtime: st.mtime.toISOString() };
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
  const manifest = {
    builtAt: new Date().toISOString(),
    node: process.version,
    sources: ['src/worker/main.ts', 'src/worker/mcp-bridge.ts'],
    entries,
  };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

function size(path) {
  const bytes = statSync(path).size;
  return bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)}M` : `${(bytes / (1 << 10)).toFixed(0)}K`;
}

await main();
