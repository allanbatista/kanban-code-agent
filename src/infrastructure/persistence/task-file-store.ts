import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AtomicWriter } from '../filesystem/atomic-writer.js';
import { PathSandbox } from '../filesystem/sandbox.js';
import type { TaskChatMessage, TaskArtifact, SerializedTask } from '../../domain/task.js';

/**
 * Per-task file management under `.swarm/tasks/{taskId}/`.
 *
 * Directory structure:
 *   .swarm/tasks/{taskId}/
 *     task.yml          — task metadata (JSON format)
 *     chat.jsonl        — append-only chat messages
 *     session.jsonl     — session execution lines
 *     artifacts.yaml    — artifact manifest (JSON format)
 *     attachments/      — copied attachment files (UUID-prefixed)
 *
 * All path operations go through PathSandbox.
 * All writes use AtomicWriter for crash safety.
 */

export class TaskFileStore {
  constructor(private readonly sandbox: PathSandbox) {}

  // ---------------------------------------------------------------------------
  // Task YAML
  // ---------------------------------------------------------------------------

  /** Write task metadata as JSON to task.yml. */
  saveTaskYaml(taskId: string, task: SerializedTask): void {
    this.assertSandbox();
    const path = this.taskPath(taskId, 'task.yml');
    AtomicWriter.writeJson(path, task);
  }

  /** Read task metadata from task.yml. Returns null if missing or corrupt. */
  loadTaskYaml(taskId: string): SerializedTask | null {
    this.assertSandbox();
    const path = this.taskPath(taskId, 'task.yml');
    return this.readJsonFile<SerializedTask>(path);
  }

  // ---------------------------------------------------------------------------
  // Chat JSONL
  // ---------------------------------------------------------------------------

  /**
   * Persist the full chat as chat.jsonl (atomic overwrite).
   *
   * Callers always pass the complete, in-memory chat history, so the file is
   * rewritten rather than appended — appending the whole array on every flush
   * would duplicate every message once per persist.
   */
  saveChat(taskId: string, messages: TaskChatMessage[]): void {
    this.assertSandbox();
    const path = this.taskPath(taskId, 'chat.jsonl');
    const content = messages.map((msg) => JSON.stringify(msg)).join('\n');
    AtomicWriter.write(path, content.length ? content + '\n' : '');
  }

  /** Read all chat messages from chat.jsonl. Resilient to truncated last line. */
  loadChat(taskId: string): TaskChatMessage[] {
    this.assertSandbox();
    const path = this.taskPath(taskId, 'chat.jsonl');
    return this.readJsonlFile<TaskChatMessage>(path);
  }

  // ---------------------------------------------------------------------------
  // Session JSONL
  // ---------------------------------------------------------------------------

  /** Write session execution lines to session.jsonl. */
  saveSession(taskId: string, lines: string[]): void {
    this.assertSandbox();
    const path = this.taskPath(taskId, 'session.jsonl');
    for (const line of lines) {
      AtomicWriter.appendLine(path, line);
    }
  }

  // ---------------------------------------------------------------------------
  // Artifacts YAML
  // ---------------------------------------------------------------------------

  /** Write artifact manifest as JSON to artifacts.yaml. */
  saveArtifacts(taskId: string, artifacts: TaskArtifact[]): void {
    this.assertSandbox();
    const path = this.taskPath(taskId, 'artifacts.yaml');
    AtomicWriter.writeJson(path, artifacts);
  }

  /**
   * Write a generated artifact file under the task's artifacts/ directory.
   * Returns the sandbox-relative path. Rejects path traversal via PathSandbox.
   */
  writeArtifactFile(taskId: string, fileName: string, content: string): string {
    this.assertSandbox();
    const path = this.sandbox.resolveSubpath('.swarm', 'tasks', taskId, 'artifacts', fileName);
    AtomicWriter.write(path, content);
    return this.sandbox.relativeTo(path);
  }

  // ---------------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------------

  /**
   * Copy an attachment file into the task's attachments/ directory
   * with a UUID prefix to avoid name collisions.
   * Returns the relative path to the copied file.
   */
  copyAttachment(taskId: string, sourcePath: string): string {
    this.assertSandbox();
    const attachmentsDir = this.taskPath(taskId, 'attachments');
    this.ensureDir(attachmentsDir);

    const originalName = basename(sourcePath);
    const prefixedName = `${randomUUID()}_${originalName}`;
    const destPath = join(attachmentsDir, prefixedName);

    copyFileSync(sourcePath, destPath);
    return this.sandbox.relativeTo(destPath);
  }

  // ---------------------------------------------------------------------------
  // Directory bootstrap
  // ---------------------------------------------------------------------------

  /** Create the full task directory structure if it does not exist. */
  ensureTaskDir(taskId: string): void {
    this.assertSandbox();
    const taskDir = this.taskDir(taskId);
    const attachmentsDir = join(taskDir, 'attachments');

    this.ensureDir(taskDir);
    this.ensureDir(attachmentsDir);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Resolve a path relative to the task's directory. */
  private taskPath(taskId: string, filename: string): string {
    return this.sandbox.resolveSubpath('.swarm', 'tasks', taskId, filename);
  }

  /** Resolve the task's root directory. */
  private taskDir(taskId: string): string {
    return this.sandbox.resolveSubpath('.swarm', 'tasks', taskId);
  }

  /** Read and parse a JSON file. Returns null if missing or corrupt. */
  private readJsonFile<T>(path: string): T | null {
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as T;
    } catch {
      return null;
    }
  }

  /** Read a JSONL file into an array of typed objects. Resilient to truncated last line. */
  private readJsonlFile<T>(path: string): T[] {
    if (!existsSync(path)) return [];

    const raw = readFileSync(path, 'utf-8');
    const lines = raw.split('\n').filter((line) => line.trim() !== '');
    const result: T[] = [];

    // Validate last line; discard if truncated
    const lastIdx = lines.length - 1;
    if (lastIdx >= 0) {
      try {
        JSON.parse(lines[lastIdx]);
      } catch {
        lines.pop();
      }
    }

    for (const line of lines) {
      try {
        result.push(JSON.parse(line) as T);
      } catch {
        // Skip corrupt individual lines
      }
    }

    return result;
  }

  /** Create a directory if it does not exist. */
  private ensureDir(path: string): void {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  }

  /** Ensure PathSandbox rejections propagate — PathSandbox validates on resolve(). */
  private assertSandbox(): void {
    // PathSandbox already validates on every resolve() call.
    // This method exists as a documentation hook for future sandbox policy checks.
  }
}
