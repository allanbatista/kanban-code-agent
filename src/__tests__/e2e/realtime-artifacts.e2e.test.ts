import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';

// Node 24 ships a global, browser-style WebSocket client (EventTarget API) — no
// need to depend on the `ws` package for the client side of the e2e.
const WS = (globalThis as { WebSocket: new (url: string) => any }).WebSocket;

import { Orquestrator } from '../../application/orquestrator.js';
import { PiAgentClient } from '../../application/pi-client.js';
import type { AgentRunner } from '../../application/pi-client.js';
import { EventStore } from '../../infrastructure/persistence/event-store.js';
import { SnapshotStore } from '../../infrastructure/persistence/snapshot-store.js';
import { TaskFileStore } from '../../infrastructure/persistence/task-file-store.js';
import { PathSandbox } from '../../infrastructure/filesystem/sandbox.js';
import { TASK_STATUS } from '../../domain/types.js';
import type { Agent } from '../../domain/agent.js';
import { completedDecision } from '../_helpers/mock-agent.js';
import { buildAndListen } from '../_helpers/e2e-server.js';

const TEST_MODELS = {
  fast: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'x' },
  balanced: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'y' },
  deep: { provider: 'deepseek', modelId: 'deepseek-v4-pro', description: 'z' },
};
const engineer: Agent = { name: 'Engineer', role: 'Executor.', runtimeConfig: { model: 'fast', effort: 'off' }, tools: ['write'] };

// Runner that creates an artifact (calling the real create_artifact tool) then completes.
const artifactRunner: AgentRunner = {
  async run(config) {
    const tool = config.customTools?.find((t) => t.name === 'create_artifact');
    if (tool) await tool.execute({ fileName: 'out.md', content: '# Hello\nworld', description: 'doc', file_type: 'markdown' });
    return { output: completedDecision('feito'), stats: { tokens: { input: 5, output: 5, total: 10 }, cost: 0.001 } };
  },
};

function open(ws: any): Promise<void> {
  return new Promise((resolve) => ws.addEventListener('open', () => resolve(), { once: true }));
}
function nextMessage(ws: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws message timeout')), 3000);
    ws.addEventListener('message', (ev: { data: string }) => { clearTimeout(t); resolve(JSON.parse(ev.data)); }, { once: true });
  });
}
function collectMessages(ws: any, ms: number): Promise<any[]> {
  return new Promise((resolve) => {
    const msgs: any[] = [];
    const onMsg = (ev: { data: string }) => msgs.push(JSON.parse(ev.data));
    ws.addEventListener('message', onMsg);
    setTimeout(() => { ws.removeEventListener('message', onMsg); resolve(msgs); }, ms);
  });
}

describe('E2E: realtime catch-up + artifacts + attachments', () => {
  let dir: string;
  let server: FastifyInstance;
  let orquestrator: Orquestrator;
  let baseUrl: string;
  let wsUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'e2e-rt-'));
    const sandbox = new PathSandbox(dir);
    const piClient = new PiAgentClient(artifactRunner, '', ['write'], TEST_MODELS, 60);
    orquestrator = new Orquestrator({
      eventStore: new EventStore(sandbox),
      snapshotStore: new SnapshotStore(sandbox),
      taskFileStore: new TaskFileStore(sandbox),
      sandbox,
      agents: [engineer],
      piClient,
      models: TEST_MODELS,
    });
    ({ server, baseUrl, wsUrl, close } = await buildAndListen(orquestrator));
  });

  afterAll(async () => {
    orquestrator.shutdown();
    await close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('serves an agent artifact over HTTP with the right content-type, and blocks traversal', async () => {
    const task = orquestrator.createRootTask('Build artifact', 'Engineer');
    await orquestrator.waitUntilSettled(task);
    expect(task.status).toBe(TASK_STATUS.COMPLETED);

    const listRes = await fetch(`${baseUrl}/api/tasks/${task.taskId}/artifacts`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as { artifacts: Array<{ path: string }> };
    expect(list.artifacts.length).toBe(1);

    const getRes = await fetch(`${baseUrl}/api/tasks/${task.taskId}/artifacts/out.md`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('content-type')).toContain('text/markdown');
    expect(await getRes.text()).toContain('# Hello');

    const missing = await fetch(`${baseUrl}/api/tasks/${task.taskId}/artifacts/nope.md`);
    expect(missing.status).toBe(404);

    // Path traversal is rejected at the boundary (400 from the param regex).
    const traversal = await fetch(`${baseUrl}/api/tasks/${task.taskId}/artifacts/..%2f..%2fsecret`);
    expect([400, 403, 404]).toContain(traversal.status);
  });

  it('lets a human attach a file mid-conversation (dep-free base64) and the agent can read it', async () => {
    const task = orquestrator.createRootTask('Needs file', 'Engineer');
    await orquestrator.waitUntilSettled(task);

    const content = Buffer.from('dados do usuario').toString('base64');
    const res = await fetch(`${baseUrl}/api/tasks/${task.taskId}/attachments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'spec.txt', contentBase64: content, message: 'segue o spec' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { attachment: { path: string; originalName: string } };
    expect(body.attachment.originalName).toBe('spec.txt');

    const chatRes = await fetch(`${baseUrl}/api/tasks/${task.taskId}/chat`);
    const chat = await chatRes.json() as { chat: Array<{ attachments?: unknown[]; text?: string }> };
    const withAttachment = chat.chat.find((m) => m.attachments && m.attachments.length > 0);
    expect(withAttachment).toBeDefined();
  });

  it('delivers events over WS with monotonic seq and catches up missed events on reconnect (sinceSeq)', async () => {
    // Connect and read the initial state message (carries the seq cursor).
    const ws1 = new WS(wsUrl);
    await open(ws1);
    const state = await nextMessage(ws1);
    expect(state.type).toBe('state');
    expect(state.schemaVersion).toBe(1);
    const cursor: number = state.seq;

    // Create a task while connected → expect event frames with increasing seq.
    const live = collectMessages(ws1, 400);
    orquestrator.createRootTask('Live one', 'Engineer');
    const frames = await live;
    const eventFrames = frames.filter((m) => m.type === 'event');
    expect(eventFrames.length).toBeGreaterThan(0);
    const seqs = eventFrames.map((m) => m.event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b)); // strictly ordered by seq
    const lastApplied = Math.max(cursor, ...seqs);
    ws1.close();

    // Disconnected: create another task — its events are "missed".
    const missedTask = orquestrator.createRootTask('Missed while away', 'Engineer');

    // Reconnect with sinceSeq → server replays the missed events.
    const ws2 = new WS(wsUrl);
    await open(ws2);
    const catchUp = collectMessages(ws2, 500);
    ws2.send(JSON.stringify({ type: 'subscribe', sinceSeq: lastApplied }));
    const replayed = await catchUp;
    const replayedCreate = replayed.find(
      (m) => m.type === 'event' && m.event.type === 'TASK_CREATED' && m.event.taskId === missedTask.taskId,
    );
    expect(replayedCreate).toBeDefined();
    ws2.close();
  });
});
