import { existsSync, readFileSync, mkdirSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { AtomicWriter } from '../filesystem/atomic-writer.js';
import { PathSandbox } from '../filesystem/sandbox.js';

// ---------------------------------------------------------------------------
// Project data model
// ---------------------------------------------------------------------------

export interface ProjectData {
  slug: string;
  name: string;
  description: string;
  gitUrl?: string;
  defaultBranch: string;
  autoMerge: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  name: string;
  slug?: string;
  description?: string;
  gitUrl?: string;
  defaultBranch?: string;
  autoMerge?: boolean;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  gitUrl?: string;
  defaultBranch?: string;
  autoMerge?: boolean;
}

// ---------------------------------------------------------------------------
// Project File Store
// Database as filesystem: each project is a JSON file in .swarm/projects/<slug>/
// ---------------------------------------------------------------------------

export class ProjectFileStore {
  private readonly basePath: string;
  private readonly legacyBasePath: string;

  constructor(private readonly sandbox: PathSandbox) {
    this.basePath = this.sandbox.resolve('.swarm/projects');
    this.legacyBasePath = this.sandbox.resolve('.kanban-data/projects');
    this.ensureBaseDir();
    this.migrateLegacyProjects();
  }

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  createProject(input: CreateProjectInput): ProjectData {
    const now = new Date().toISOString();
    const slug = this.ensureUniqueSlug(input.slug ?? input.name);
    const project: ProjectData = {
      slug,
      name: input.name,
      description: input.description ?? '',
      gitUrl: normalizeOptionalString(input.gitUrl),
      defaultBranch: normalizeRequiredString(input.defaultBranch, 'main'),
      autoMerge: input.autoMerge ?? false,
      createdAt: now,
      updatedAt: now,
    };

    this.writeProject(project);
    return { ...project };
  }

  getProject(slug: string): ProjectData | null {
    const path = this.projectPath(slug);
    if (!existsSync(path)) return null;

    try {
      return this.normalizeProject(JSON.parse(readFileSync(path, 'utf-8')));
    } catch {
      return null;
    }
  }

  updateProject(slug: string, input: UpdateProjectInput): ProjectData | null {
    const existing = this.getProject(slug);
    if (!existing) return null;

    const updated: ProjectData = {
      ...existing,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      gitUrl: 'gitUrl' in input ? normalizeOptionalString(input.gitUrl) : existing.gitUrl,
      defaultBranch: normalizeRequiredString(input.defaultBranch, existing.defaultBranch),
      autoMerge: input.autoMerge ?? existing.autoMerge,
      updatedAt: new Date().toISOString(),
    };

    this.writeProject(updated);
    return { ...updated };
  }

  deleteProject(slug: string): boolean {
    const dir = this.projectDir(slug);
    if (!existsSync(dir)) return false;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      return false;
    }
    return true;
  }

  saveProject(project: ProjectData): ProjectData {
    const normalized = this.normalizeProject(project);
    this.writeProject(normalized);
    return { ...normalized };
  }

  listProjects(): ProjectData[] {
    if (!existsSync(this.basePath)) return [];

    const entries = this.readdirSafe(this.basePath);
    const projects: ProjectData[] = [];

    for (const entry of entries) {
      try {
        const path = join(this.basePath, entry, 'project.json');
        if (!existsSync(path)) continue;
        const raw = readFileSync(path, 'utf-8');
        if (!raw) continue;
        projects.push(this.normalizeProject(JSON.parse(raw)));
      } catch {
        // skip corrupt files
      }
    }

    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private projectDir(slug: string): string {
    return this.sandbox.resolveSubpath('.swarm', 'projects', assertProjectSlug(slug));
  }

  private projectPath(slug: string): string {
    return join(this.projectDir(slug), 'project.json');
  }

  private writeProject(project: ProjectData): void {
    const path = this.projectPath(project.slug);
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

  private ensureUniqueSlug(value: string): string {
    const base = slugifyProjectSlug(value);
    let slug = base;
    let suffix = 2;
    while (existsSync(this.projectPath(slug))) {
      slug = `${base}-${suffix++}`;
    }
    return slug;
  }

  private normalizeProject(value: unknown): ProjectData {
    const raw = value as Partial<ProjectData> & { id?: string; taskIds?: string[] };
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string') {
      throw new Error('Invalid project');
    }
    const slug = assertProjectSlug(raw.slug ?? slugifyProjectSlug(raw.name));
    return {
      slug,
      name: raw.name,
      description: typeof raw.description === 'string' ? raw.description : '',
      gitUrl: normalizeOptionalString(raw.gitUrl),
      defaultBranch: normalizeRequiredString(raw.defaultBranch, 'main'),
      autoMerge: raw.autoMerge ?? false,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    };
  }

  private migrateLegacyProjects(): void {
    if (!existsSync(this.legacyBasePath)) return;
    for (const file of this.readdirSafe(this.legacyBasePath)) {
      if (!file.endsWith('.json')) continue;
      const path = join(this.legacyBasePath, file);
      try {
        const raw = readFileSync(path, 'utf-8');
        if (!raw.trim()) {
          unlinkSync(path);
          continue;
        }
        const project = this.normalizeProject(JSON.parse(raw));
        const slug = this.ensureUniqueSlug(project.slug);
        this.writeProject({ ...project, slug });
        unlinkSync(path);
      } catch {
        // Mantem legado corrompido para inspeção manual.
      }
    }
  }
}

export function slugifyProjectSlug(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'project';
}

function assertProjectSlug(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(value)) {
    throw new Error(`Invalid project slug: ${value}`);
  }
  return value;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRequiredString(value: string | undefined, fallback: string): string {
  return normalizeOptionalString(value) ?? fallback;
}
