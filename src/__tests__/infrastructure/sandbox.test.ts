import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PathSandbox } from '../../infrastructure/filesystem/sandbox.js';

function createSandbox(prefix = 'sb-'): { sandbox: PathSandbox; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { sandbox: new PathSandbox(dir), dir };
}

function cleanup(dir: string) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

describe('PathSandbox', () => {
  describe('assertSafeRelativePath', () => {
    it('rejects empty path', () => {
      const { sandbox, dir } = createSandbox();
      expect(() => sandbox.resolve('')).toThrow('Path is empty');
      cleanup(dir);
    });

    it('rejects whitespace-only path', () => {
      const { sandbox, dir } = createSandbox();
      expect(() => sandbox.resolve('   ')).toThrow('Path is empty');
      cleanup(dir);
    });

    it('rejects path traversal with ../', () => {
      const { sandbox, dir } = createSandbox();
      expect(() => sandbox.resolve('../etc/passwd')).toThrow('Path traversal');
      cleanup(dir);
    });

    it('rejects path traversal with ..\\', () => {
      const { sandbox, dir } = createSandbox();
      expect(() => sandbox.resolve('..\\windows\\system32')).toThrow('Path traversal');
      cleanup(dir);
    });

    it('rejects deep path traversal', () => {
      const { sandbox, dir } = createSandbox();
      expect(() => sandbox.resolve('a/../../etc/passwd')).toThrow('Path traversal');
      cleanup(dir);
    });

    it('rejects absolute paths', () => {
      const { sandbox, dir } = createSandbox();
      expect(() => sandbox.resolve('/etc/passwd')).toThrow('Path cannot be absolute');
      cleanup(dir);
    });

    it('rejects NUL byte in path', () => {
      const { sandbox, dir } = createSandbox();
      expect(() => sandbox.resolve('valid\0evil')).toThrow('NUL byte');
      cleanup(dir);
    });

    it('rejects standalone dot-dot', () => {
      const { sandbox, dir } = createSandbox();
      expect(() => sandbox.resolve('..')).toThrow('Path traversal');
      cleanup(dir);
    });

    it('allows valid relative paths', () => {
      const { sandbox, dir } = createSandbox();
      const resolved = sandbox.resolve('swarm/events/log.jsonl');
      expect(resolved).toContain(dir);
      expect(resolved.endsWith('swarm/events/log.jsonl')).toBe(true);
      cleanup(dir);
    });

    it('allows single dot segment', () => {
      const { sandbox, dir } = createSandbox();
      const resolved = sandbox.resolve('./tasks/t1/task.yml');
      expect(resolved).toContain(dir);
      expect(resolved.endsWith('tasks/t1/task.yml')).toBe(true);
      cleanup(dir);
    });
  });

  describe('assertNoSymlink', () => {
    it('rejects symlinks', () => {
      const { sandbox, dir } = createSandbox();
      writeFileSync(join(dir, 'real.txt'), 'data');
      symlinkSync(join(dir, 'real.txt'), join(dir, 'link.txt'));
      expect(() => sandbox.resolve('link.txt')).toThrow('Symlink');
      cleanup(dir);
    });

    it('rejects symlinks in subdirectories', () => {
      const { sandbox, dir } = createSandbox();
      const sub = join(dir, 'sub');
      const { mkdirSync } = require('node:fs');
      mkdirSync(sub, { recursive: true });
      writeFileSync(join(dir, 'real.txt'), 'data');
      symlinkSync(join(dir, 'real.txt'), join(sub, 'evil.txt'));
      expect(() => sandbox.resolve('sub/evil.txt')).toThrow('Symlink');
      cleanup(dir);
    });
  });

  describe('assertInside', () => {
    it('accepts paths inside base directory', () => {
      const { sandbox, dir } = createSandbox();
      const resolved = sandbox.resolve('data/file.json');
      expect(resolved.startsWith(dir)).toBe(true);
      cleanup(dir);
    });
  });

  describe('validateTaskId', () => {
    let sandbox: PathSandbox;
    let dir: string;

    beforeAll(() => {
      const s = createSandbox();
      sandbox = s.sandbox;
      dir = s.dir;
    });

    afterAll(() => cleanup(dir));

    it('accepts alphanumeric task ID', () => {
      expect(() => sandbox.validateTaskId('task_abc123')).not.toThrow();
    });

    it('accepts task ID with dots, underscores, hyphens', () => {
      expect(() => sandbox.validateTaskId('task.name_test-1')).not.toThrow();
    });

    it('rejects task ID with slashes', () => {
      expect(() => sandbox.validateTaskId('task/evil')).toThrow('Invalid task_id');
    });

    it('rejects task ID with spaces', () => {
      expect(() => sandbox.validateTaskId('task evil')).toThrow('Invalid task_id');
    });

    it('rejects task ID with special characters', () => {
      expect(() => sandbox.validateTaskId('task@evil')).toThrow('Invalid task_id');
    });
  });

  describe('sanitizeOptionalPath', () => {
    it('returns undefined for undefined input', () => {
      const { sandbox, dir } = createSandbox();
      expect(sandbox.sanitizeOptionalPath(undefined)).toBeUndefined();
      cleanup(dir);
    });

    it('returns undefined for empty string', () => {
      const { sandbox, dir } = createSandbox();
      expect(sandbox.sanitizeOptionalPath('')).toBeUndefined();
      cleanup(dir);
    });

    it('returns path for valid input', () => {
      const { sandbox, dir } = createSandbox();
      expect(sandbox.sanitizeOptionalPath('data.json')).toBe('data.json');
      cleanup(dir);
    });

    it('returns undefined for path traversal', () => {
      const { sandbox, dir } = createSandbox();
      expect(sandbox.sanitizeOptionalPath('../evil')).toBeUndefined();
      cleanup(dir);
    });
  });

  describe('resolveSubpath', () => {
    it('joins segments and resolves', () => {
      const { sandbox, dir } = createSandbox();
      const resolved = sandbox.resolveSubpath('.swarm', 'tasks', 't1', 'task.yml');
      expect(resolved).toContain(dir);
      expect(resolved.endsWith('.swarm/tasks/t1/task.yml')).toBe(true);
      cleanup(dir);
    });
  });

  describe('relativeTo', () => {
    it('returns relative path from baseDir', () => {
      const { sandbox, dir } = createSandbox();
      const absPath = sandbox.resolve('foo/bar.txt');
      const rel = sandbox.relativeTo(absPath);
      expect(rel).toBe('foo/bar.txt');
      cleanup(dir);
    });

    it('returns dot for baseDir itself', () => {
      const { sandbox, dir } = createSandbox();
      const rel = sandbox.relativeTo(dir);
      expect(rel).toBe('.');
      cleanup(dir);
    });
  });

  describe('getBaseDir', () => {
    it('returns the base directory', () => {
      const { sandbox, dir } = createSandbox();
      expect(sandbox.getBaseDir()).toBe(dir);
      cleanup(dir);
    });
  });
});
