import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AtomicWriter } from '../../infrastructure/filesystem/atomic-writer.js';

function createTempDir(prefix = 'aw-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanup(dir: string) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

describe('AtomicWriter', () => {
  describe('write', () => {
    it('writes content atomically — no partial file before rename', () => {
      const dir = createTempDir();
      const target = join(dir, 'output.txt');

      AtomicWriter.write(target, 'hello world');

      expect(existsSync(target)).toBe(true);
      expect(readFileSync(target, 'utf-8')).toBe('hello world');

      // No .tmp files left behind
      const files = require('node:fs').readdirSync(dir);
      expect(files.filter((f: string) => f.endsWith('.tmp'))).toHaveLength(0);

      cleanup(dir);
    });

    it('creates parent directories if missing', () => {
      const dir = createTempDir();
      const target = join(dir, 'deep/nested/file.txt');

      AtomicWriter.write(target, 'data');

      expect(existsSync(target)).toBe(true);
      expect(readFileSync(target, 'utf-8')).toBe('data');
      cleanup(dir);
    });

    it('rejects symlink target', () => {
      const dir = createTempDir();
      const realPath = join(dir, 'real.txt');
      writeFileSync(realPath, 'original');
      const linkPath = join(dir, 'link.txt');
      symlinkSync(realPath, linkPath);

      expect(() => AtomicWriter.write(linkPath, 'new content')).toThrow('Cannot write to symlink');
      cleanup(dir);
    });

    it('overwrites existing file', () => {
      const dir = createTempDir();
      const target = join(dir, 'file.txt');

      AtomicWriter.write(target, 'first');
      AtomicWriter.write(target, 'second');

      expect(readFileSync(target, 'utf-8')).toBe('second');
      cleanup(dir);
    });
  });

  describe('writeWithBackup', () => {
    it('creates .bak file from original', () => {
      const dir = createTempDir();
      const target = join(dir, 'data.json');

      AtomicWriter.write(target, 'v1');
      AtomicWriter.writeWithBackup(target, 'v2');

      expect(readFileSync(target, 'utf-8')).toBe('v2');
      expect(existsSync(target + '.bak')).toBe(true);
      expect(readFileSync(target + '.bak', 'utf-8')).toBe('v1');
      cleanup(dir);
    });

    it('replaces existing .bak on subsequent backups', () => {
      const dir = createTempDir();
      const target = join(dir, 'data.json');

      AtomicWriter.write(target, 'v1');
      AtomicWriter.writeWithBackup(target, 'v2');
      AtomicWriter.writeWithBackup(target, 'v3');

      expect(readFileSync(target, 'utf-8')).toBe('v3');
      expect(readFileSync(target + '.bak', 'utf-8')).toBe('v2');
      cleanup(dir);
    });

    it('works when no existing file (no backup created)', () => {
      const dir = createTempDir();
      const target = join(dir, 'fresh.json');

      AtomicWriter.writeWithBackup(target, 'new');
      expect(readFileSync(target, 'utf-8')).toBe('new');
      expect(existsSync(target + '.bak')).toBe(false);
      cleanup(dir);
    });
  });

  describe('writeJson', () => {
    it('writes valid JSON', () => {
      const dir = createTempDir();
      const target = join(dir, 'obj.json');

      AtomicWriter.writeJson(target, { key: 'value', num: 42, arr: [1, 2, 3] });

      const content = readFileSync(target, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toEqual({ key: 'value', num: 42, arr: [1, 2, 3] });
      cleanup(dir);
    });

    it('JSON is pretty-printed', () => {
      const dir = createTempDir();
      const target = join(dir, 'pretty.json');

      AtomicWriter.writeJson(target, { a: 1 });

      const content = readFileSync(target, 'utf-8');
      expect(content).toContain('\n');
      expect(content).toContain('  ');
      cleanup(dir);
    });
  });

  describe('appendLine', () => {
    it('appends lines to file', () => {
      const dir = createTempDir();
      const target = join(dir, 'log.jsonl');

      AtomicWriter.appendLine(target, 'line1');
      AtomicWriter.appendLine(target, 'line2');
      AtomicWriter.appendLine(target, 'line3');

      const content = readFileSync(target, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toEqual(['line1', 'line2', 'line3']);
      cleanup(dir);
    });

    it('creates parent directories', () => {
      const dir = createTempDir();
      const target = join(dir, 'deep/log/app.jsonl');

      AtomicWriter.appendLine(target, 'entry');

      expect(existsSync(target)).toBe(true);
      cleanup(dir);
    });
  });
});
