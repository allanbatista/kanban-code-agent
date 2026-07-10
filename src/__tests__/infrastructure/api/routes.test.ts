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
import { SWARM_EVENT_TYPE, TASK_STATUS } from '../../../domain/types.js';

const MODELS = {
  fast: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'x' },
  balanced: { provider: 'deepseek', modelId: 'deepseek-v4-flash', description: 'y' },
  deep: { provider: 'deepseek', modelId: 'deepseek-v4-pro', description: 'z' },
};
const agent: Agent = { name: 'agent-tester', role: 'Test.', runtimeConfig: { model: 'fast', effort: 'off' }, tools: ['read'] };
const manager: Agent = { name: 'Manager', role: 'Manager.', runtimeConfig: { model: 'fast', effort: 'off' }, tools: ['read'] };

function build(dir: string): { orc: Orquestrator; server: FastifyInstance } {
  const sandbox = new PathSandbox(dir);
  const orc = new Orquestrator({
    eventStore: new EventStore(sandbox),
    snapshotStore: new SnapshotStore(sandbox),
    taskFileStore: new TaskFileStore(sandbox),
    sandbox,
    agents: [agent, manager],
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

  it('accepts a valid runtimeConfig.agent and rejects an unknown one', async () => {
    const ok = await server.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { message: 'com agent', runtimeConfig: { agent: 'codex' } },
    });
    expect(ok.statusCode).toBe(201);

    const bad = await server.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { message: 'agent invalido', runtimeConfig: { agent: 'nope' } },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('creates project-backed tasks and rejects unknown project links', async () => {
    const project = await server.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'App', slug: 'app', gitUrl: 'https://example.com/app.git' },
    });
    expect(project.statusCode).toBe(201);

    const linked = await server.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { message: 'fazer algo', projectIds: ['app'] },
    });
    expect(linked.statusCode).toBe(201);
    expect(linked.json().projectIds).toEqual(['app']);

    const invalid = await server.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { message: 'fazer algo', projectIds: ['missing'] },
    });
    expect(invalid.statusCode).toBe(400);
    expect(orc.events.some((event) => event.type === SWARM_EVENT_TYPE.PROJECT_CREATED)).toBe(true);
    expect(orc.events.some((event) => event.type === SWARM_EVENT_TYPE.TASK_PROJECT_LINKED)).toBe(true);
  });

  it('manual retry re-opens a cancelled task (F8.T2)', async () => {
    const id = orc.createRootTask('Retry me', 'agent-tester').taskId;
    orc.cancelTask(id);
    const res = await server.inject({ method: 'POST', url: `/api/tasks/${id}/retry` });
    expect(res.statusCode).toBe(200);
    expect(['PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'REVIEW']).toContain(res.json().status);
  });

  it('approves and rejects tasks in REVIEW', async () => {
    const approved = orc.addTask({ message: 'Approve me' });
    approved.setStatus(TASK_STATUS.REVIEW, { force: true });
    const approve = await server.inject({ method: 'POST', url: `/api/tasks/${approved.taskId}/approve` });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().status).toBe(TASK_STATUS.COMPLETED);

    const rejected = orc.addTask({ message: 'Reject me' });
    rejected.setStatus(TASK_STATUS.REVIEW, { force: true });
    const reject = await server.inject({
      method: 'POST',
      url: `/api/tasks/${rejected.taskId}/reject`,
      payload: { message: 'corrigir escopo' },
    });
    expect(reject.statusCode).toBe(200);
    expect([TASK_STATUS.PENDING, TASK_STATUS.QUEUED, TASK_STATUS.RUNNING]).toContain(reject.json().status);
    expect(rejected.chat.some((message) => message.text === 'corrigir escopo')).toBe(true);
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

  it('edits text-like artifacts and serves renderable image/pdf types inline', async () => {
    const id = orc.createRootTask('art', 'agent-tester').taskId;
    orc.createArtifact(orc.tasks.get(id)!, 'note.md', '# old', 'note', 'markdown');
    orc.createArtifact(orc.tasks.get(id)!, 'report.pdf', '%PDF-1.4', 'report', 'pdf');

    const update = await server.inject({
      method: 'PUT',
      url: `/api/tasks/${id}/artifacts/note.md`,
      payload: { content: '# new' },
    });
    expect(update.statusCode).toBe(200);

    const markdown = await server.inject({ method: 'GET', url: `/api/tasks/${id}/artifacts/note.md` });
    expect(markdown.body).toBe('# new');

    const pdf = await server.inject({ method: 'GET', url: `/api/tasks/${id}/artifacts/report.pdf` });
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('inline');
  });

  it('rejects editing non-text artifacts', async () => {
    const id = orc.createRootTask('art', 'agent-tester').taskId;
    orc.createArtifact(orc.tasks.get(id)!, 'chart.png', 'png', 'chart', 'png');

    const res = await server.inject({
      method: 'PUT',
      url: `/api/tasks/${id}/artifacts/chart.png`,
      payload: { content: 'not text' },
    });

    expect(res.statusCode).toBe(415);
  });

  it('GET /api/settings returns defaults with masked keys', async () => {
    const res = await server.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.agent).toBe('pi');
    expect(Array.isArray(body.providers)).toBe(true);
  });

  it('PATCH /api/settings persists agent + keys (masked), preserves blank key, applies hot', async () => {
    const patch = await server.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: {
        agent: 'codex',
        providers: [{ name: 'fast', provider: 'deepseek', modelId: 'm', apiKey: 'sk-1234567890abcd', enabled: true }],
      },
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json();
    expect(body.agent).toBe('codex');
    // Key mascarada na resposta, nunca em claro.
    expect(body.providers[0].apiKey).not.toContain('567890');
    expect(body.providers[0].apiKey).toContain('*');
    // Hot-apply do agent default no orquestrator.
    expect(orc.resolveRuntimeConfig(orc.createRootTask('t', 'agent-tester')).agent).toBe('codex');

    // Envio em branco preserva a key existente (persistida sem mascarar).
    const preserve = await server.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { providers: [{ name: 'fast', provider: 'deepseek', modelId: 'm', apiKey: '', enabled: true }] },
    });
    expect(preserve.statusCode).toBe(200);

    // Restart: novo server no mesmo dataDir enxerga o estado persistido.
    const sandbox2 = new PathSandbox(dir);
    const orc2 = new Orquestrator({
      eventStore: new EventStore(sandbox2),
      snapshotStore: new SnapshotStore(sandbox2),
      taskFileStore: new TaskFileStore(sandbox2),
      sandbox: sandbox2,
      agents: [agent, manager],
      piClient: new PiAgentClient(makeRunner([]), '', ['read'], MODELS, 60),
      models: MODELS,
    }, { stopWhenWaiting: true });
    const server2 = buildServer(orc2);
    const reread = await (await server2.inject({ method: 'GET', url: '/api/settings' })).json();
    expect(reread.agent).toBe('codex');
    expect(reread.providers[0].apiKey).toContain('*');
    await server2.close();
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
