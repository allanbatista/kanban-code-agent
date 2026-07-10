#!/usr/bin/env node
// Fake `codex` CLI para exercitar as rotas de auth sem o binario real.
// Honra CODEX_HOME: `login --with-api-key` le a key do stdin e grava
// auth.json com ela. Nao valida a key (so simula o efeito colateral).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const home = process.env.CODEX_HOME;

if (argv[0] === 'login' && argv.includes('--with-api-key')) {
  let key = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (c) => { key += c; });
  process.stdin.on('end', () => {
    if (!home) { process.exit(1); }
    // Delay opcional para segurar o lock e tornar o teste de concorrência determinístico.
    const delay = Number(process.env.SWARM_FAKE_CODEX_DELAY_MS || 0);
    setTimeout(() => {
      writeFileSync(join(home, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: key.trim() }), { mode: 0o600 });
      process.exit(0);
    }, delay);
  });
} else {
  process.exit(2);
}
