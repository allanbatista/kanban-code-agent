#!/usr/bin/env node
import { createWorkerServer, listenWorkerServer } from './server.js';
import { createWorkerExecutor } from './executor.js';

// Fast-path --help/--version: usado pelo smoke do bundle esbuild (F2.2) para
// provar que o binario node + worker.mjs rodam num container glibc sem node.
if (process.argv.some((arg) => arg === '--help' || arg === '-h' || arg === '--version')) {
  process.stdout.write('kca-worker: node /kca/bin/worker.mjs --socket <path>\n');
  process.exit(0);
}

const socketArgIndex = process.argv.indexOf('--socket');
const socketPath =
  socketArgIndex >= 0 ? process.argv[socketArgIndex + 1] : process.env.SWARM_WORKER_SOCKET;

if (!socketPath) {
  console.error('SWARM_WORKER_SOCKET ou --socket e obrigatorio');
  process.exit(1);
}

// Seleciona Pi ou Codex por run (campo `agent` do payload); ver executor.ts.
const worker = createWorkerServer(createWorkerExecutor());

process.on('SIGTERM', () => {
  void worker.close().finally(() => process.exit(0));
});

await listenWorkerServer(worker, socketPath);
