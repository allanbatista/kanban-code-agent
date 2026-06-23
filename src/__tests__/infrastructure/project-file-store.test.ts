import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectFileStore } from '../../infrastructure/persistence/project-file-store.js';
import { PathSandbox } from '../../infrastructure/filesystem/sandbox.js';

function createStore(): { store: ProjectFileStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pfs-'));
  const sandbox = new PathSandbox(dir);
  return { store: new ProjectFileStore(sandbox), dir };
}

function cleanup(dir: string) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

describe('ProjectFileStore', () => {
  describe('CRUD operations', () => {
    it('creates and retrieves a project', () => {
      const { store, dir } = createStore();

      const project = store.createProject({ name: 'Test Project', description: 'A test' });

      expect(project.id).toBeTruthy();
      expect(project.name).toBe('Test Project');
      expect(project.description).toBe('A test');
      expect(project.taskIds).toEqual([]);
      expect(project.createdAt).toBeTruthy();
      expect(project.updatedAt).toBe(project.createdAt);

      const loaded = store.getProject(project.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe('Test Project');

      cleanup(dir);
    });

    it('returns null for nonexistent project', () => {
      const { store, dir } = createStore();
      expect(store.getProject('nonexistent')).toBeNull();
      cleanup(dir);
    });

    it('updates project fields', () => {
      const { store, dir } = createStore();

      const project = store.createProject({ name: 'Original', description: 'Original desc' });
      const updated = store.updateProject(project.id, { name: 'Updated', description: 'Updated desc' });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated');
      expect(updated!.description).toBe('Updated desc');
      expect(updated!.updatedAt).toBeTruthy();
      expect(new Date(updated!.updatedAt).getTime()).not.toBeNaN();

      const loaded = store.getProject(project.id);
      expect(loaded!.name).toBe('Updated');

      cleanup(dir);
    });

    it('returns null when updating nonexistent project', () => {
      const { store, dir } = createStore();
      expect(store.updateProject('nonexistent', { name: 'Nope' })).toBeNull();
      cleanup(dir);
    });

    it('deletes a project', () => {
      const { store, dir } = createStore();

      const project = store.createProject({ name: 'Delete Me' });
      expect(store.getProject(project.id)).not.toBeNull();

      const deleted = store.deleteProject(project.id);
      expect(deleted).toBe(true);
      expect(store.getProject(project.id)).toBeNull();

      cleanup(dir);
    });

    it('returns false when deleting nonexistent project', () => {
      const { store, dir } = createStore();
      expect(store.deleteProject('nonexistent')).toBe(false);
      cleanup(dir);
    });

    it('lists all projects', () => {
      const { store, dir } = createStore();

      store.createProject({ name: 'Project A' });
      store.createProject({ name: 'Project B' });
      store.createProject({ name: 'Project C' });

      const list = store.listProjects();
      expect(list).toHaveLength(3);
      expect(list.map((p) => p.name).sort()).toEqual(['Project A', 'Project B', 'Project C']);

      cleanup(dir);
    });

    it('persists data to disk (database as filesystem)', () => {
      const { store, dir } = createStore();

      const project = store.createProject({ name: 'Persist Test', taskIds: ['task_1', 'task_2'] });

      // Read the file directly from disk
      const filePath = join(dir, '.kanban-data', 'projects', `${project.id}.json`);
      expect(existsSync(filePath)).toBe(true);

      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(raw.name).toBe('Persist Test');
      expect(raw.taskIds).toEqual(['task_1', 'task_2']);

      cleanup(dir);
    });
  });
});
