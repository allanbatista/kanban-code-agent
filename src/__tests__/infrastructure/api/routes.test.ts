import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';

import { Orquestrator } from '../../../application/orquestrator.js';
import { PiAgentClient } from '../../../application/pi-client.js';
import { EventStore } from '../../../infrastructure/persistence/event-store.js';
import { SnapshotStore } from '../../../infrastructure/persistence/snapshot-store.js';
import { TaskFileStore } from '../../../infrastructure/persistence/task-file-store.js';
import { PathSandbox } from '../../../infrastructure/filesystem/sandbox.js';
import type { Agent } from '../../../domain/agent.js';
import { makeRunner } from '../../_helpers/mock-agent.js';
import { buildServer } from '../../_helpers/e2e-server.js';

const MODELS = {
  fast: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'x' },
  balanced: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'y' },
  deep: { provider: 'deepseek', modelId: 'deepseek-v4-pro', description: 'z' },
};
const agent: Agent = { name: 'agent-tester', role: 'Test.', runtimeConfig: { model: 'fast', effort: 'off' }, tools: ['read'] };

function build(dir: string): { orc: Orquestrator; server: FastifyInstance } {
  const sandbox = new PathSandbox(dir);
  const orc = new Orquestrator({
    eventStore: new EventStore(sandbox),
    snapshotStore: new SnapshotStore(sandbox),
    taskFileStore: new TaskFileStore(sandbox),
    sandbox,
    agents: [agent],
    piClient: new PiAgentClient(makeRunner([]), '', ['read'], MODELS, 60),
    models: MODELS,
  }, { stopWhenWaiting: true });
  return { orc, server: buildServer(orc) };
}

describe('API route integration (F8.T1/T2)', () => {
  let dir: string;
  let server: FastifyInstance;
  let orc: Orquestrator;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'api-'));
    ({ orc, server } = build(dir));
  });
  afterEach(async () => {
    await server.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('GET /health returns operational telemetry', async () => {
    const res = await server.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.operations).toBeDefined();
    expect(typeof body.operations.queueDepth).toBe('number');
  });

  it('creates, lists, gets and cancels a task', async () => {
    const create = await server.inject({ method: 'POST', url: '/api/tasks', payload: { message: 'fazer algo' } });
    expect(create.statusCode).toBe(201);
    const id = create.json().taskId;

    expect((await server.inject({ method: 'GET', url: '/api/tasks' })).json().total).toBeGreaterThanOrEqual(1);
    expect((await server.inject({ method: 'GET', url: `/api/tasks/${id}` })).statusCode).toBe(200);

    const del = await server.inject({ method: 'DELETE', url: `/api/tasks/${id}` });
    expect(del.statusCode).toBe(200);
    expect(del.json().status).toBe('CANCELLED');
  });

  it('manual retry re-opens a cancelled task (F8.T2)', async () => {
    const id = orc.createRootTask('Retry me', 'agent-tester').taskId;
    orc.cancelTask(id);
    const res = await server.inject({ method: 'POST', url: `/api/tasks/${id}/retry` });
    expect(res.statusCode).toBe(200);
    expect(['PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'REVIEW']).toContain(res.json().status);
  });

  it('rejects malformed / oversized payloads at the boundary (fuzz)', async () => {
    // Oversized message → zod max(10000) → 400.
    const big = await server.inject({ method: 'POST', url: '/api/tasks', payload: { message: 'x'.repeat(10001) } });
    expect(big.statusCode).toBe(400);
    // Empty message → 400.
    const empty = await server.inject({ method: 'POST', url: '/api/tasks', payload: { message: '' } });
    expect(empty.statusCode).toBe(400);
    // Unknown task → 404.
    expect((await server.inject({ method: 'GET', url: '/api/tasks/task_nope' })).statusCode).toBe(404);
    // Artifact filename traversal → 400 (strict regex).
    const id = orc.createRootTask('t', 'agent-tester').taskId;
    const trav = await server.inject({ method: 'GET', url: `/api/tasks/${id}/artifacts/..%2f..%2fetc` });
    expect([400, 404]).toContain(trav.statusCode);
    // Oversized attachment → 413.
    const huge = Buffer.alloc(6 * 1024 * 1024).toString('base64');
    const att = await server.inject({ method: 'POST', url: `/api/tasks/${id}/attachments`, payload: { fileName: 'big.bin', contentBase64: huge } });
    expect(att.statusCode).toBe(413);
  });

  it('serves the safe artifact endpoint with hardening headers', async () => {
    const id = orc.createRootTask('art', 'agent-tester').taskId;
    orc.createArtifact(orc.tasks.get(id)!, 'page.html', '<script>alert(1)</script>', 'evil', 'html');
    const res = await server.inject({ method: 'GET', url: `/api/tasks/${id}/artifacts/page.html` });
    expect(res.statusCode).toBe(200);
    // HTML is NOT served inline as text/html (stored-XSS guard).
    expect(res.headers['content-type']).toContain('application/octet-stream');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('API auth (F8.T2, opt-in)', () => {
  let dir: string;
  let server: FastifyInstance;
  const saved = process.env.SWARM_AUTH_TOKEN;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'api-auth-'));
    process.env.SWARM_AUTH_TOKEN = 'secret-123';
    ({ server } = build(dir));
  });
  afterEach(async () => {
    await server.close();
    if (saved === undefined) delete process.env.SWARM_AUTH_TOKEN; else process.env.SWARM_AUTH_TOKEN = saved;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('blocks /api without a valid bearer token and allows it with one; /health stays open', async () => {
    expect((await server.inject({ method: 'GET', url: '/api/tasks' })).statusCode).toBe(401);
    expect((await server.inject({ method: 'GET', url: '/api/tasks', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
    const ok = await server.inject({ method: 'GET', url: '/api/tasks', headers: { authorization: 'Bearer secret-123' } });
    expect(ok.statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});
