import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
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
    const project = store.createProject({ name: 'Test Project', description: 'A test' });

    expect(project.name).toBe('Test Project');
    expect(project.description).toBe('A test');
    expect(project.id).toBeDefined();

    const retrieved = store.getProject(project.id);
    expect(retrieved).toEqual(project);
  });

  it('persists projects across store instances (filesystem, not memory)', () => {
    const sandbox = new PathSandbox(dir);
    const store1 = new ProjectFileStore(sandbox);
    const project = store1.createProject({ name: 'Persistent' });

    // New store instance — must read from filesystem
    const store2 = new ProjectFileStore(sandbox);
    const retrieved = store2.getProject(project.id);
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

    const updated = store.updateProject(project.id, { name: 'Updated' });
    expect(updated!.name).toBe('Updated');
    expect(updated!.id).toBe(project.id);

    // Verify persistence
    const store2 = new ProjectFileStore(sandbox);
    expect(store2.getProject(project.id)!.name).toBe('Updated');
  });

  it('deletes a project', () => {
    const sandbox = new PathSandbox(dir);
    const store = new ProjectFileStore(sandbox);
    const project = store.createProject({ name: 'ToDelete' });

    const deleted = store.deleteProject(project.id);
    expect(deleted).toBe(true);

    // After delete, getProject returns null (empty file marker)
    const store2 = new ProjectFileStore(sandbox);
    expect(store2.getProject(project.id)).toBeNull();
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
});
