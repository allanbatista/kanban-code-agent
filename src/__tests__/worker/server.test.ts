import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkerServer, listenWorkerServer, type WorkerServer } from '../../worker/server.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unixJson<T>(socketPath: string, method: string, path: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        socketPath,
        method,
        path,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('worker UDS server', () => {
  let dir: string | undefined;
  let worker: WorkerServer | undefined;

  afterEach(async () => {
    await worker?.close().catch(() => undefined);
    if (dir) rmSync(dir, { recursive: true, force: true });
    worker = undefined;
    dir = undefined;
  });

  async function start(executor: Parameters<typeof createWorkerServer>[0]): Promise<string> {
    dir = mkdtempSync(join(tmpdir(), 'kca-worker-'));
    const socketPath = join(dir, 'worker.sock');
    worker = createWorkerServer(executor);
    await listenWorkerServer(worker, socketPath);
    return socketPath;
  }

  it('responde /health e /run', async () => {
    const socketPath = await start({
      async run(input) {
        return input;
      },
    });

    await expect(unixJson(socketPath, 'GET', '/health')).resolves.toEqual({ ok: true });
    await expect(unixJson(socketPath, 'POST', '/run', { runId: 'r1', value: 1 })).resolves.toEqual({
      ok: true,
      result: { runId: 'r1', value: 1 },
    });
  });

  it('cancela uma run ativa', async () => {
    const socketPath = await start({
      async run(_input, signal) {
        return new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve({ aborted: true }), { once: true });
        });
      },
    });

    const run = unixJson(socketPath, 'POST', '/run', { runId: 'r2' });
    await delay(20);
    await expect(unixJson(socketPath, 'POST', '/cancel', { runId: 'r2' })).resolves.toEqual({
      ok: true,
      cancelled: true,
    });
    await expect(run).resolves.toEqual({ ok: true, result: { aborted: true } });
  });

  it('abre stream /events com evento ready', async () => {
    const socketPath = await start({
      async run() {
        return {};
      },
    });

    const firstChunk = await new Promise<string>((resolve, reject) => {
      const req = request({ socketPath, method: 'GET', path: '/events' }, (res) => {
        res.once('data', (chunk: Buffer) => {
          resolve(chunk.toString('utf-8'));
          req.destroy();
        });
      });
      req.on('error', reject);
      req.end();
    });

    expect(firstChunk).toContain('event: ready');
  });
});
