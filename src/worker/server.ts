import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { rmSync } from 'node:fs';

export interface WorkerExecutor {
  run(input: unknown, signal: AbortSignal): Promise<unknown>;
}

export interface WorkerServer {
  server: Server;
  close(): Promise<void>;
}

export function createWorkerServer(executor: WorkerExecutor): WorkerServer {
  const controllers = new Map<string, AbortController>();
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === 'GET' && request.url === '/events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        response.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
        return;
      }

      if (request.method === 'POST' && request.url === '/cancel') {
        const body = await readJson(request);
        const runId = readRunId(body);
        const controller = controllers.get(runId);
        if (controller) {
          controller.abort();
          controllers.delete(runId);
        }
        sendJson(response, 200, { ok: true, cancelled: Boolean(controller) });
        return;
      }

      if (request.method === 'POST' && request.url === '/run') {
        const body = await readJson(request);
        const runId = readRunId(body);
        const controller = new AbortController();
        controllers.set(runId, controller);
        try {
          const result = await executor.run(body, controller.signal);
          sendJson(response, 200, { ok: true, result });
        } finally {
          controllers.delete(runId);
        }
        return;
      }

      sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  return {
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export function listenWorkerServer(worker: WorkerServer, socketPath: string): Promise<void> {
  rmSync(socketPath, { force: true });
  return new Promise((resolve, reject) => {
    worker.server.once('error', reject);
    worker.server.listen(socketPath, () => {
      worker.server.off('error', reject);
      resolve();
    });
  });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function readRunId(body: unknown): string {
  if (body && typeof body === 'object' && typeof (body as { runId?: unknown }).runId === 'string') {
    return (body as { runId: string }).runId;
  }
  return 'default';
}
