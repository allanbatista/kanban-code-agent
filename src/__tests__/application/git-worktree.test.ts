import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { Orquestrator } from '../../application/orquestrator.js';
import type { AgentRunConfig, AgentRunResult, AgentRunner } from '../../application/pi-client.js';
import { SWARM_EVENT_TYPE, TASK_STATUS } from '../../domain/types.js';
import { completedDecision, waitingDecision } from '../_helpers/mock-agent.js';
import { createDeps, createPiClientWithRunner, getEvents } from '../_helpers/orquestrator-fixture.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

describe('project git worktree', () => {
  let dir = '';
  let orc: Orquestrator | undefined;

  afterEach(() => {
    orc?.shutdown();
    orc = undefined;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('creates a project worktree before running the task', async () => {
    dir = mkdtempSync(join(tmpdir(), 'kca-worktree-'));
    const origin = join(dir, 'origin');
    git(dir, ['init', '--initial-branch=main', origin]);
    git(origin, ['config', 'user.name', 'Test']);
    git(origin, ['config', 'user.email', 'test@example.invalid']);
    writeFileSync(join(origin, 'README.md'), 'base\n');
    git(origin, ['add', 'README.md']);
    git(origin, ['commit', '-m', 'base']);

    let cwd = '';
    const runner: AgentRunner = {
      async run(config: AgentRunConfig): Promise<AgentRunResult> {
        cwd = String(config.cwd);
        return {
          output: completedDecision('done'),
          stats: { tokens: { input: 1, output: 1, total: 2 }, cost: 0 },
        };
      },
    };
    orc = new Orquestrator(createDeps(dir, createPiClientWithRunner(runner)));
    const project = orc.createProject({ name: 'App', slug: 'app', gitUrl: origin, defaultBranch: 'main' });

    const task = orc.createRootTask('Implementar mudança', 'agent-tester', undefined, [], undefined, [project.slug]);

    await vi.waitFor(() => expect(task.status).toBe(TASK_STATUS.COMPLETED));
    const worktreeDir = join(cwd, 'app');
    const created = getEvents(orc).find((event) => event.type === SWARM_EVENT_TYPE.WORKTREE_CREATED);
    expect(cwd).toBe(join(dir, '.swarm', 'tasks', task.taskId, 'workspace'));
    expect(existsSync(join(worktreeDir, '.git'))).toBe(true);
    expect(created?.taskId).toBe(task.taskId);
    expect(created?.payload?.slug).toBe('app');
    expect(created?.payload?.branch).toBe(`kca/${task.taskId}/integration`);
    expect(created?.payload?.baseSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('merges completed subtask branches into the integration branch', async () => {
    dir = mkdtempSync(join(tmpdir(), 'kca-merge-'));
    const origin = join(dir, 'origin');
    git(dir, ['init', '--initial-branch=main', origin]);
    git(origin, ['config', 'user.name', 'Test']);
    git(origin, ['config', 'user.email', 'test@example.invalid']);
    // origin não-bare com main em check-out: aceita o push do default sem mexer no worktree.
    git(origin, ['config', 'receive.denyCurrentBranch', 'ignore']);
    writeFileSync(join(origin, 'README.md'), 'base\n');
    git(origin, ['add', 'README.md']);
    git(origin, ['commit', '-m', 'base']);

    const calls: Record<string, number> = {};
    const runner: AgentRunner = {
      async run(config: AgentRunConfig): Promise<AgentRunResult> {
        const taskId = basename(dirname(String(config.cwd)));
        calls[taskId] = (calls[taskId] ?? 0) + 1;
        if (taskId === 'task_1' && calls[taskId] === 1) {
          const create = config.customTools?.find((tool) => tool.name === 'create_subtask');
          if (!create) throw new Error('create_subtask ausente');
          const a = JSON.parse(await create.execute({ assignedTo: 'Engineer', title: 'A', message: 'A' })).taskId;
          const b = JSON.parse(await create.execute({ assignedTo: 'Engineer', title: 'B', message: 'B' })).taskId;
          return {
            output: waitingDecision([{ waitId: 'g', mode: 'WAIT_ALL', taskIds: [a, b] }]),
            stats: { tokens: { input: 1, output: 1, total: 2 }, cost: 0 },
          };
        }
        if (taskId !== 'task_1') {
          writeFileSync(join(String(config.cwd), 'app', `${taskId}.txt`), `${taskId}\n`);
        }
        return {
          output: completedDecision('done'),
          stats: { tokens: { input: 1, output: 1, total: 2 }, cost: 0 },
        };
      },
    };
    const agents = [
      { name: 'Manager', role: 'mgr', runtimeConfig: { model: 'fast' as const, effort: 'off' as const }, tools: ['read'] },
      { name: 'Engineer', role: 'eng', runtimeConfig: { model: 'fast' as const, effort: 'off' as const }, tools: ['read'] },
    ];
    orc = new Orquestrator(createDeps(dir, createPiClientWithRunner(runner), agents));
    const project = orc.createProject({ name: 'App', slug: 'app', gitUrl: origin, defaultBranch: 'main' });

    const task = orc.createRootTask('Implementar mudança', 'Manager', undefined, [], undefined, [project.slug]);

    await vi.waitFor(() => expect(task.status).toBe(TASK_STATUS.REVIEW));
    const mirror = join(dir, '.swarm', 'projects', 'app', 'repo.git');
    const branch = `kca/${task.taskId}/integration`;
    expect(git(dir, [`--git-dir=${mirror}`, 'show', `${branch}:task_2.txt`])).toBe('task_2');
    expect(git(dir, [`--git-dir=${mirror}`, 'show', `${branch}:task_3.txt`])).toBe('task_3');
    const merges = getEvents(orc).filter((event) => event.type === SWARM_EVENT_TYPE.BRANCH_MERGED);
    expect(merges.map((event) => event.payload?.from)).toEqual([
      `kca/${task.taskId}/task_2`,
      `kca/${task.taskId}/task_3`,
    ]);

    orc.completeTaskByUser(task.taskId);
    expect(task.status).toBe(TASK_STATUS.COMPLETED);
    expect(git(dir, [`--git-dir=${mirror}`, 'show', 'main:task_2.txt'])).toBe('task_2');
    expect(git(dir, [`--git-dir=${mirror}`, 'show', 'main:task_3.txt'])).toBe('task_3');
    // Regressão do bug "push sem caller": o merge precisa chegar ao remote real, não só ao mirror.
    expect(git(origin, ['show', 'main:task_2.txt'])).toBe('task_2');
    expect(git(origin, ['show', 'main:task_3.txt'])).toBe('task_3');
    const finalMerge = getEvents(orc).find((event) =>
      event.type === SWARM_EVENT_TYPE.BRANCH_MERGED && event.payload?.into === 'main');
    expect(finalMerge?.payload?.from).toBe(branch);

    orc.archiveByStatus(TASK_STATUS.COMPLETED);
    expect(existsSync(join(dir, '.swarm', 'tasks', '_archived', task.taskId, 'workspace', 'app'))).toBe(false);
    expect(existsSync(join(dir, '.swarm', 'tasks', '_archived', 'task_2', 'workspace', 'app'))).toBe(false);
    expect(existsSync(join(dir, '.swarm', 'tasks', '_archived', 'task_3', 'workspace', 'app'))).toBe(false);
  });

  it('auto-merges Manager root when every linked project has autoMerge=true', async () => {
    dir = mkdtempSync(join(tmpdir(), 'kca-automerge-'));
    const origin = join(dir, 'origin');
    git(dir, ['init', '--initial-branch=main', origin]);
    git(origin, ['config', 'user.name', 'Test']);
    git(origin, ['config', 'user.email', 'test@example.invalid']);
    // origin não-bare com main em check-out: aceita o push do default sem mexer no worktree.
    git(origin, ['config', 'receive.denyCurrentBranch', 'ignore']);
    writeFileSync(join(origin, 'README.md'), 'base\n');
    git(origin, ['add', 'README.md']);
    git(origin, ['commit', '-m', 'base']);

    const runner: AgentRunner = {
      async run(): Promise<AgentRunResult> {
        return {
          output: completedDecision('done'),
          stats: { tokens: { input: 1, output: 1, total: 2 }, cost: 0 },
        };
      },
    };
    const agents = [
      { name: 'Manager', role: 'mgr', runtimeConfig: { model: 'fast' as const, effort: 'off' as const }, tools: ['read'] },
    ];
    orc = new Orquestrator(createDeps(dir, createPiClientWithRunner(runner), agents));
    const project = orc.createProject({ name: 'App', slug: 'app', gitUrl: origin, defaultBranch: 'main', autoMerge: true });

    const task = orc.createRootTask('Pequena mudança', 'Manager', undefined, [], undefined, [project.slug]);

    await vi.waitFor(() => expect(task.status).toBe(TASK_STATUS.COMPLETED));
    expect(getEvents(orc).some((event) => event.type === SWARM_EVENT_TYPE.TASK_REVIEW && event.taskId === task.taskId)).toBe(true);
    expect(getEvents(orc).some((event) =>
      event.type === SWARM_EVENT_TYPE.TASK_COMPLETED && event.taskId === task.taskId && event.payload?.autoMerge === true,
    )).toBe(true);
  });

  it('turns merge conflict into a resolver subtask', async () => {
    dir = mkdtempSync(join(tmpdir(), 'kca-conflict-'));
    const origin = join(dir, 'origin');
    git(dir, ['init', '--initial-branch=main', origin]);
    git(origin, ['config', 'user.name', 'Test']);
    git(origin, ['config', 'user.email', 'test@example.invalid']);
    writeFileSync(join(origin, 'README.md'), 'base\n');
    git(origin, ['add', 'README.md']);
    git(origin, ['commit', '-m', 'base']);

    const calls: Record<string, number> = {};
    const runner: AgentRunner = {
      async run(config: AgentRunConfig): Promise<AgentRunResult> {
        const taskId = basename(dirname(String(config.cwd)));
        calls[taskId] = (calls[taskId] ?? 0) + 1;
        if (taskId === 'task_1' && calls[taskId] === 1) {
          const create = config.customTools?.find((tool) => tool.name === 'create_subtask');
          if (!create) throw new Error('create_subtask ausente');
          const a = JSON.parse(await create.execute({ assignedTo: 'Engineer', title: 'A', message: 'A' })).taskId;
          const b = JSON.parse(await create.execute({ assignedTo: 'Engineer', title: 'B', message: 'B' })).taskId;
          return {
            output: waitingDecision([{ waitId: 'g', mode: 'WAIT_ALL', taskIds: [a, b] }]),
            stats: { tokens: { input: 1, output: 1, total: 2 }, cost: 0 },
          };
        }
        if (taskId === 'task_2' || taskId === 'task_3') {
          writeFileSync(join(String(config.cwd), 'app', 'same.txt'), `${taskId}\n`);
          return {
            output: completedDecision('done'),
            stats: { tokens: { input: 1, output: 1, total: 2 }, cost: 0 },
          };
        }
        if (taskId === 'task_1') {
          return {
            output: completedDecision('done'),
            stats: { tokens: { input: 1, output: 1, total: 2 }, cost: 0 },
          };
        }
        return new Promise<AgentRunResult>(() => {});
      },
    };
    const agents = [
      { name: 'Manager', role: 'mgr', runtimeConfig: { model: 'fast' as const, effort: 'off' as const }, tools: ['read'] },
      { name: 'Engineer', role: 'eng', runtimeConfig: { model: 'fast' as const, effort: 'off' as const }, tools: ['read'] },
    ];
    orc = new Orquestrator(createDeps(dir, createPiClientWithRunner(runner), agents));
    const project = orc.createProject({ name: 'App', slug: 'app', gitUrl: origin, defaultBranch: 'main' });

    const task = orc.createRootTask('Implementar mudança', 'Manager', undefined, [], undefined, [project.slug]);

    await vi.waitFor(() => {
      const blocked = getEvents(orc!).find((event) => event.type === SWARM_EVENT_TYPE.MERGE_BLOCKED);
      expect(blocked?.payload?.reason).toBe('conflict');
    });
    const resolver = [...orc.tasks.values()].find((candidate) => candidate.title === 'Resolver conflito app');
    expect(task.status).toBe(TASK_STATUS.WAITING);
    expect(resolver?.parentId).toBe(task.taskId);
  });

  it('surfaces a push failure and does not complete the task', async () => {
    dir = mkdtempSync(join(tmpdir(), 'kca-pushfail-'));
    const origin = join(dir, 'origin');
    git(dir, ['init', '--initial-branch=main', origin]);
    git(origin, ['config', 'user.name', 'Test']);
    git(origin, ['config', 'user.email', 'test@example.invalid']);
    writeFileSync(join(origin, 'README.md'), 'base\n');
    git(origin, ['add', 'README.md']);
    git(origin, ['commit', '-m', 'base']);

    const runner: AgentRunner = {
      async run(): Promise<AgentRunResult> {
        return {
          output: completedDecision('done'),
          stats: { tokens: { input: 1, output: 1, total: 2 }, cost: 0 },
        };
      },
    };
    const agents = [
      { name: 'Manager', role: 'mgr', runtimeConfig: { model: 'fast' as const, effort: 'off' as const }, tools: ['read'] },
    ];
    orc = new Orquestrator(createDeps(dir, createPiClientWithRunner(runner), agents));
    const project = orc.createProject({ name: 'App', slug: 'app', gitUrl: origin, defaultBranch: 'main' });

    const task = orc.createRootTask('Pequena mudança', 'Manager', undefined, [], undefined, [project.slug]);

    await vi.waitFor(() => expect(task.status).toBe(TASK_STATUS.REVIEW));
    // Quebra o remote real do mirror: o merge local ainda vai, mas o push falha.
    const mirror = join(dir, '.swarm', 'projects', 'app', 'repo.git');
    git(dir, [`--git-dir=${mirror}`, 'remote', 'set-url', 'origin', join(dir, 'nao-existe.git')]);

    expect(() => orc!.completeTaskByUser(task.taskId)).toThrow();
    // Falha de push não pode passar silenciosa e não pode concluir a task.
    expect(task.status).toBe(TASK_STATUS.REVIEW);
    const blocked = getEvents(orc).find((event) =>
      event.type === SWARM_EVENT_TYPE.MERGE_BLOCKED && event.payload?.reason === 'push');
    expect(blocked?.payload?.into).toBe('main');
    expect(getEvents(orc).some((event) =>
      event.type === SWARM_EVENT_TYPE.TASK_COMPLETED && event.taskId === task.taskId)).toBe(false);
  });
});
