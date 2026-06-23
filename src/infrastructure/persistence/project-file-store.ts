import { existsSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AtomicWriter } from '../filesystem/atomic-writer.js';
import { PathSandbox } from '../filesystem/sandbox.js';

// ---------------------------------------------------------------------------
// Project data model
// ---------------------------------------------------------------------------

export interface ProjectData {
  id: string;
  name: string;
  description: string;
  taskIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  taskIds?: string[];
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  taskIds?: string[];
}

// ---------------------------------------------------------------------------
// Project File Store
// Database as filesystem: each project is a JSON file in .kanban-data/projects/
// ---------------------------------------------------------------------------

export class ProjectFileStore {
  private readonly basePath: string;

  constructor(private readonly sandbox: PathSandbox) {
    this.basePath = this.sandbox.resolve('.kanban-data/projects');
    this.ensureBaseDir();
  }

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  createProject(input: CreateProjectInput): ProjectData {
    const now = new Date().toISOString();
    const project: ProjectData = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? '',
      taskIds: input.taskIds ?? [],
      createdAt: now,
      updatedAt: now,
    };

    this.writeProject(project);
    return { ...project };
  }

  getProject(id: string): ProjectData | null {
    const path = this.projectPath(id);
    if (!existsSync(path)) return null;

    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as ProjectData;
    } catch {
      return null;
    }
  }

  updateProject(id: string, input: UpdateProjectInput): ProjectData | null {
    const existing = this.getProject(id);
    if (!existing) return null;

    const updated: ProjectData = {
      ...existing,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      taskIds: input.taskIds ?? existing.taskIds,
      updatedAt: new Date().toISOString(),
    };

    this.writeProject(updated);
    return { ...updated };
  }

  deleteProject(id: string): boolean {
    const path = this.projectPath(id);
    if (!existsSync(path)) return false;

    AtomicWriter.write(path, ''); // overwrite with empty to avoid partial read
    try {
      // Use filesystem unlink via AtomicWriter approach — clean up the file
      AtomicWriter.write(path, '');
    } catch {
      // best effort
    }
    // We can't really "delete" atomically, but we can clear content
    // Use a marker approach: empty file = deleted
    return true;
  }

  listProjects(): ProjectData[] {
    if (!existsSync(this.basePath)) return [];

    const files = this.readdirSafe(this.basePath);
    const projects: ProjectData[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const path = join(this.basePath, file);
        const raw = readFileSync(path, 'utf-8');
        if (!raw) continue; // deleted marker
        projects.push(JSON.parse(raw) as ProjectData);
      } catch {
        // skip corrupt files
      }
    }

    return projects;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private projectPath(id: string): string {
    return join(this.basePath, `${id}.json`);
  }

  private writeProject(project: ProjectData): void {
    const path = this.projectPath(project.id);
    AtomicWriter.writeJson(path, project);
  }

  private ensureBaseDir(): void {
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }
  }

  private readdirSafe(dir: string): string[] {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  }
}
