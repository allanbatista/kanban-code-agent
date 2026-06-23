import { appendFileSync, existsSync, lstatSync, mkdirSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Atomic file writer: write to temp file, then rename.
 * Prevents partial writes and corruption on crash.
 */

export class AtomicWriter {
  /**
   * Write content atomically: write to .tmp file, then rename to target.
   * If target is a symlink, reject.
   */
  static write(targetPath: string, content: string): void {
    const dir = dirname(targetPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Reject symlinks
    if (existsSync(targetPath) && lstatSync(targetPath).isSymbolicLink()) {
      throw new Error(`Cannot write to symlink: ${targetPath}`);
    }

    const tmpPath = `${targetPath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmpPath, content, 'utf-8');
      renameSync(tmpPath, targetPath);
    } catch (error) {
      // Cleanup temp file on failure
      try {
        if (existsSync(tmpPath)) {
          unlinkSync(tmpPath);
        }
      } catch {
        // Best effort cleanup
      }
      throw error;
    }
  }

  /**
   * Append a line atomically to a JSONL file.
   * For append-only logs, we use appendFileSync directly
   * since atomic rename on every line would be too expensive.
   * The file is considered append-only and corruption-resistant
   * because truncated last line is recoverable.
   */
  static appendLine(targetPath: string, line: string): void {
    const dir = dirname(targetPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(targetPath, line + '\n', 'utf-8');
  }

  /**
   * Write a JSON object atomically.
   */
  static writeJson(targetPath: string, data: unknown): void {
    this.write(targetPath, JSON.stringify(data, null, 2));
  }

  /**
   * Backup a file before overwriting.
   * Renames current file to .bak, then writes new content.
   */
  static writeWithBackup(targetPath: string, content: string): void {
    const bakPath = `${targetPath}.bak`;
    if (existsSync(targetPath)) {
      // Remove old backup first
      try {
        if (existsSync(bakPath)) {
          unlinkSync(bakPath);
        }
      } catch {
        // Old backup may not exist
      }
      renameSync(targetPath, bakPath);
    }
    this.write(targetPath, content);
  }
}


