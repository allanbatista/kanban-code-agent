import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createServer } from '../../infrastructure/api/http-server.js';
import { createLogger } from '../../infrastructure/logging/logger.js';
import { Orquestrator } from '../../application/orquestrator.js';
import { TASK_STATUS, SWARM_EVENT_TYPE } from '../../domain/types.js';
import { createDeps, createPiClient } from '../_helpers/orquestrator-fixture.js';
import { completedDecision } from '../_helpers/mock-agent.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function parseWsMessage(data: unknown): Record<string, unknown> {
  if (typeof data === 'string') return JSON.parse(data) as Record<string, unknown>;
  if (data instanceof ArrayBuffer) return JSON.parse(Buffer.from(data).toString()) as Record<string, unknown>;
  return JSON.parse(String(data)) as Record<string, unknown>;
}

describe('WebSocket event stream', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pushes each recorded task event immediately with current task metadata', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-'));
    dirs.push(dir);
    const orc = new Orquestrator(createDeps(dir, createPiClient([completedDecision('done')])));
    const app = createServer(orc, createLogger('test', 'fatal'));
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: Array<Record<string, unknown>> = [];

    ws.addEventListener('message', (event) => {
      messages.push(parseWsMessage(event.data));
    });

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('WebSocket error')), { once: true });
    });

    await expect.poll(() => messages.some((message) => message.type === 'state')).toBe(true);
    const createdEvent = new Promise<Record<string, unknown>>((resolve) => {
      ws.addEventListener('message', (event) => {
        const message = parseWsMessage(event.data) as { type?: string; event?: { type?: string } };
        if (message.type === 'event' && message.event?.type === SWARM_EVENT_TYPE.TASK_CREATED) {
          resolve(message as unknown as Record<string, unknown>);
        }
      });
    });

    const task = orc.createRootTask('WS task', 'agent-tester');
    const message = await createdEvent;

    expect((message.event as { taskId?: string }).taskId).toBe(task.taskId);
    expect((message.task as { status?: string }).status).toBe(TASK_STATUS.PENDING);

    ws.close();
    await app.close();
  });
});
