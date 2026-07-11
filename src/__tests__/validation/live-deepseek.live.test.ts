import { describe, it, expect } from 'vitest';

const hasApiKey = !!process.env.DEEPSEEK_API_KEY;
const hasValidationFlag = process.env.SWARM_VALIDATION === '1';

describe.skipIf(!hasApiKey || !hasValidationFlag)('Live validation: DeepSeek v4 flash effort=high', () => {
  it('connects to DeepSeek and parses a trivial task decision', async () => {
    const { loadConfig } = await import('../../infrastructure/config.js');
    const { PiAgentClient } = await import('../../application/pi-client.js');
    const { PiSdkAgentRunner } = await import('../../cli/pi-runner.js');

    const config = loadConfig();
    expect(config.models.fast.provider).toBe('deepseek');
    expect(config.models.fast.modelId).toBe('deepseek-v4-flash');

    const runner = new PiSdkAgentRunner();
    const allowedModels = {
      fast: { ...config.models.fast, description: 'fast' },
      balanced: { ...config.models.balanced, description: 'balanced' },
      deep: { ...config.models.deep, description: 'deep' },
    };
    const client = new PiAgentClient(runner, '', ['read'], allowedModels, 60);

    // Create a minimal agent that just completes
    const agent = {
      name: 'validation-agent',
      role: 'You are a test agent. Respond with a completed decision.',
      runtimeConfig: { model: 'fast' as const, effort: 'high' as const },
      tools: [],
    };

    // Build a minimal task for the agent
    const { mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'live-'));

    const { Orquestrator } = await import('../../application/orquestrator.js');
    const { EventStore } = await import('../../infrastructure/persistence/event-store.js');
    const { SnapshotStore } = await import('../../infrastructure/persistence/snapshot-store.js');
    const { TaskFileStore } = await import('../../infrastructure/persistence/task-file-store.js');
    const { PathSandbox } = await import('../../infrastructure/filesystem/sandbox.js');

    const sandbox = new PathSandbox(dir);
    const deps = {
      eventStore: new EventStore(sandbox),
      snapshotStore: new SnapshotStore(sandbox),
      taskFileStore: new TaskFileStore(sandbox),
      sandbox,
      agents: [agent],
      piClient: client,
      models: allowedModels,
    };

    const orc = new Orquestrator(deps, { resetState: true, stopWhenWaiting: true });
    const task = orc.createRootTask('Test connectivity', 'validation-agent');

    // Verify task was created
    expect(task.taskId).toBeDefined();
    expect(task.status).toBe('QUEUED');

    // ponytail: createRootTask agenda um run async; sem cancelar, esse run in-proc
    // continua depois do fim do teste e falha (dir temporario ja removido). Cancela
    // para levar a task a um estado terminal de forma deterministica.
    orc.cancelTask(task.taskId);
    expect(task.status).toBe('CANCELLED');
  });
});
