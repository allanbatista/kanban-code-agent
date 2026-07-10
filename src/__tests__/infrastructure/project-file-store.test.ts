import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectFileStore } from '../../infrastructure/persistence/project-file-store.js';
import { PathSandbox } from '../../infrastructure/filesystem/sandbox.js';

describe('ProjectFileStore', () => {
  let dir: string;
  let cleanup: () => void;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'proj-'));
    cleanup = () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('creates and retrieves a project', () => {
    const sandbox = new PathSandbox(dir);
    const store = new ProjectFileStore(sandbox);
    const project = store.createProject({
      name: 'Test Project',
      description: 'A test',
      gitUrl: 'https://github.com/acme/test.git',
    });

    expect(project.slug).toBe('test-project');
    expect(project.name).toBe('Test Project');
    expect(project.description).toBe('A test');
    expect(project.gitUrl).toBe('https://github.com/acme/test.git');
    expect(project.defaultBranch).toBe('main');
    expect(project.autoMerge).toBe(false);
    expect(existsSync(join(dir, '.swarm/projects/test-project/project.json'))).toBe(true);

    const retrieved = store.getProject(project.slug);
    expect(retrieved).toEqual(project);
  });

  it('persists projects across store instances (filesystem, not memory)', () => {
    const sandbox = new PathSandbox(dir);
    const store1 = new ProjectFileStore(sandbox);
    const project = store1.createProject({ name: 'Persistent' });

    // New store instance — must read from filesystem
    const store2 = new ProjectFileStore(sandbox);
    const retrieved = store2.getProject(project.slug);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe('Persistent');
  });

  it('lists all projects', () => {
    const sandbox = new PathSandbox(dir);
    const store = new ProjectFileStore(sandbox);
    store.createProject({ name: 'A' });
    store.createProject({ name: 'B' });

    const list = store.listProjects();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.name)).toContain('A');
    expect(list.map((p) => p.name)).toContain('B');
  });

  it('updates a project', () => {
    const sandbox = new PathSandbox(dir);
    const store = new ProjectFileStore(sandbox);
    const project = store.createProject({ name: 'Original' });

    const updated = store.updateProject(project.slug, {
      name: 'Updated',
      defaultBranch: 'trunk',
      autoMerge: true,
    });
    expect(updated!.name).toBe('Updated');
    expect(updated!.slug).toBe(project.slug);
    expect(updated!.defaultBranch).toBe('trunk');
    expect(updated!.autoMerge).toBe(true);

    // Verify persistence
    const store2 = new ProjectFileStore(sandbox);
    expect(store2.getProject(project.slug)!.name).toBe('Updated');
  });

  it('deletes a project', () => {
    const sandbox = new PathSandbox(dir);
    const store = new ProjectFileStore(sandbox);
    const project = store.createProject({ name: 'ToDelete' });

    const deleted = store.deleteProject(project.slug);
    expect(deleted).toBe(true);

    const store2 = new ProjectFileStore(sandbox);
    expect(store2.getProject(project.slug)).toBeNull();
  });

  it('returns null for non-existent project', () => {
    const sandbox = new PathSandbox(dir);
    const store = new ProjectFileStore(sandbox);
    expect(store.getProject('nonexistent')).toBeNull();
  });

  it('returns empty list when no projects exist', () => {
    const sandbox = new PathSandbox(dir);
    const store = new ProjectFileStore(sandbox);
    expect(store.listProjects()).toEqual([]);
  });

  it('deduplicates generated slugs', () => {
    const sandbox = new PathSandbox(dir);
    const store = new ProjectFileStore(sandbox);

    const first = store.createProject({ name: 'My App' });
    const second = store.createProject({ name: 'My App' });

    expect(first.slug).toBe('my-app');
    expect(second.slug).toBe('my-app-2');
  });

  it('round-trips devcontainerPath and clears it on update', () => {
    const sandbox = new PathSandbox(dir);
    const store = new ProjectFileStore(sandbox);
    const project = store.createProject({
      name: 'Dev',
      devcontainerPath: '.devcontainer/devcontainer.json',
    });
    expect(project.devcontainerPath).toBe('.devcontainer/devcontainer.json');

    // Sobrevive a uma nova instancia (filesystem)
    const store2 = new ProjectFileStore(sandbox);
    expect(store2.getProject(project.slug)!.devcontainerPath).toBe('.devcontainer/devcontainer.json');

    // Update sem o campo preserva; null/'' limpa
    const kept = store2.updateProject(project.slug, { name: 'Dev2' });
    expect(kept!.devcontainerPath).toBe('.devcontainer/devcontainer.json');
    const cleared = store2.updateProject(project.slug, { devcontainerPath: null });
    expect(cleared!.devcontainerPath).toBeUndefined();
  });

  it('rejects devcontainerPath traversal and absolute paths', () => {
    const sandbox = new PathSandbox(dir);
    const store = new ProjectFileStore(sandbox);
    expect(() => store.createProject({ name: 'T1', devcontainerPath: '../etc/passwd' })).toThrow(/traversal/);
    expect(() => store.createProject({ name: 'T2', devcontainerPath: '/etc/passwd' })).toThrow(/relative/);
    expect(() => store.createProject({ name: 'T3', devcontainerPath: 'a/../../b' })).toThrow(/traversal/);
  });

  it('migrates legacy UUID projects into slug folders', () => {
    const legacyDir = join(dir, '.kanban-data/projects');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(
      join(legacyDir, 'f37f839d-d8e4-4700-988a-3a2e4e683531.json'),
      JSON.stringify({
        id: 'f37f839d-d8e4-4700-988a-3a2e4e683531',
        name: 'Legacy Project',
        description: 'old',
        taskIds: ['task_1'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );

    const store = new ProjectFileStore(new PathSandbox(dir));
    const migrated = store.getProject('legacy-project');
    const stored = JSON.parse(readFileSync(join(dir, '.swarm/projects/legacy-project/project.json'), 'utf-8'));

    expect(migrated?.slug).toBe('legacy-project');
    expect(stored.taskIds).toBeUndefined();
  });
});
