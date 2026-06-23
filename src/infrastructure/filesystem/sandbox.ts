import { existsSync, lstatSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve } from 'node:path';

/**
 * Sandbox rígido para paths de filesystem.
 * Rejeita path traversal, paths absolutos, symlinks e NUL bytes.
 */

export class PathSandbox {
  constructor(private readonly baseDir: string) {
    this.baseDir = resolve(baseDir);
  }

  resolve(relativePath: string): string {
    this.assertSafeRelativePath(relativePath);
    const target = resolve(this.baseDir, relativePath);
    this.assertInside(target);
    this.assertNoSymlink(target);
    return target;
  }

  resolveSubpath(...segments: string[]): string {
    return this.resolve(join(...segments));
  }

  relativeTo(absolutePath: string): string {
    const normalized = resolve(absolutePath);
    this.assertInside(normalized);
    return relative(this.baseDir, normalized) || '.';
  }

  validateTaskId(taskId: string): void {
    if (!/^[a-zA-Z0-9_.-]+$/.test(taskId)) {
      throw new Error(`Invalid task_id: ${taskId}`);
    }
  }

  assertInside(absolutePath: string): void {
    const normalized = resolve(absolutePath);
    const rel = relative(this.baseDir, normalized);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Path outside allowed directory: ${absolutePath}`);
    }
  }

  assertNoSymlink(absolutePath: string): void {
    const normalized = resolve(absolutePath);
    this.assertInside(normalized);
    const relativeParts = relative(this.baseDir, normalized).split(/[\\/]+/).filter(Boolean);
    let current = this.baseDir;
    for (const part of relativeParts) {
      current = join(current, part);
      if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
        throw new Error(`Symlink not allowed in path: ${current}`);
      }
    }
  }

  assertSafeRelativePath(path: string): void {
    if (!path || path.trim() === '') {
      throw new Error('Path is empty');
    }
    if (path.includes('\0')) {
      throw new Error('Path contains NUL byte');
    }
    if (isAbsolute(path)) {
      throw new Error(`Path cannot be absolute: ${path}`);
    }
    const normalized = normalize(path);
    const pathSep = normalized.includes('\\') ? '\\' : '/';
    if (normalized === '.' || normalized === '..' || normalized.startsWith(`..${pathSep}`)) {
      throw new Error(`Path traversal detected: ${path}`);
    }
  }

  sanitizeOptionalPath(path: string | undefined): string | undefined {
    if (!path) return undefined;
    try {
      this.resolve(path);
      return path;
    } catch {
      return undefined;
    }
  }

  getBaseDir(): string {
    return this.baseDir;
  }
}

export function createPathSandbox(baseDir: string): PathSandbox {
  return new PathSandbox(baseDir);
}
