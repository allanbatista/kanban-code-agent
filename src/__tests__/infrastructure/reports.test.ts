import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerReportRoutes } from '../../infrastructure/api/routes/reports.js';
import { Orquestrator } from '../../application/orquestrator.js';
import { PiAgentClient } from '../../application/pi-client.js';
import { EventStore } from '../../infrastructure/persistence/event-store.js';
import { SnapshotStore } from '../../infrastructure/persistence/snapshot-store.js';
import { TaskFileStore } from '../../infrastructure/persistence/task-file-store.js';
import { PathSandbox } from '../../infrastructure/filesystem/sandbox.js';
import type { Agent } from '../../domain/agent.js';

function createOrquestrator(dir: string): Orquestrator {
  const sandbox = new PathSandbox(dir);
  const allowedModels = {
    fast: { provider: 'test', modelId: 'test-fast' },
    balanced: { provider: 'test', modelId: 'test-balanced' },
    deep: { provider: 'test', modelId: 'test-deep' },
  };
  const runner = {
    async run() {
      return { output: '{"status":"completed","messages":[{"type":"text","text":"done"}]}', stats: { tokens: { input: 0, output: 0, total: 0 }, cost: 0 } };
    },
  };
  const piClient = new PiAgentClient(runner, '', ['read'], allowedModels, 60);
  const agents: Agent[] = [{ name: 'test', role: 'test', runtimeConfig: { model: 'fast', effort: 'off' }, tools: ['read'] }];
  const deps = {
    eventStore: new EventStore(sandbox),
    snapshotStore: new SnapshotStore(sandbox),
    taskFileStore: new TaskFileStore(sandbox),
    sandbox,
    agents,
    piClient,
  };
  return new Orquestrator(deps);
}

describe('Report routes', () => {
  let fastify: FastifyInstance;
  let orquestrator: Orquestrator;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reports-'));
    orquestrator = createOrquestrator(dir);
    fastify = Fastify();
    registerReportRoutes(fastify, orquestrator);
  });

  afterEach(async () => {
    await fastify.close();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  describe('GET /api/report/summary', () => {
    it('returns execution summary with counts', async () => {
      const response = await fastify.inject({ method: 'GET', url: '/api/report/summary' });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('totalTasks');
      expect(body).toHaveProperty('completedTasks');
      expect(body).toHaveProperty('failedTasks');
      expect(body).toHaveProperty('runningTasks');
      expect(body).toHaveProperty('pendingTasks');
    });

    it('returns zero counts for empty orchestrator', async () => {
      const response = await fastify.inject({ method: 'GET', url: '/api/report/summary' });
      const body = JSON.parse(response.body);

      expect(body.totalTasks).toBe(0);
      expect(body.completedTasks).toBe(0);
      expect(body.failedTasks).toBe(0);
    });
  });

  describe('GET /api/report/graph', () => {
    it('returns graph data with nodes and edges', async () => {
      const response = await fastify.inject({ method: 'GET', url: '/api/report/graph' });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('nodes');
      expect(body).toHaveProperty('edges');
      expect(Array.isArray(body.nodes)).toBe(true);
      expect(Array.isArray(body.edges)).toBe(true);
    });
  });
});
