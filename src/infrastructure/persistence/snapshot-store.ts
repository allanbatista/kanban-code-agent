import { readFileSync, existsSync } from 'node:fs';
import { AtomicWriter } from '../filesystem/atomic-writer.js';
import { PathSandbox } from '../filesystem/sandbox.js';
import type { SwarmEvent } from '../../domain/events.js';
import type { SerializedTask, Task } from '../../domain/task.js';

/**
 * Persisted snapshot state.
 * Version field for future migration support.
 */

export interface SnapshotData {
  tasks: SerializedTask[];
  rootTaskIds: string[];
  nextSeq: number;
  version: number;
  timestamp: string;
  // The event log is the append-only source of truth (events.jsonl); the
  // snapshot no longer embeds it. Kept optional only to read legacy snapshots.
  events?: SwarmEvent[];
}

/**
 * Snapshot persistence in `.swarm/state.snapshot.json`.
 * Uses atomic write with backup for safety.
 */

const CURRENT_VERSION = 1;

export class SnapshotStore {
  private readonly snapshotPath: string;

  constructor(private readonly sandbox: PathSandbox) {
    this.snapshotPath = this.sandbox.resolve('.swarm/state.snapshot.json');
  }

  /**
   * Serialize swarm state (tasks + roots + counters) to a snapshot file.
   * The event log is NOT embedded — it lives append-only in events.jsonl — so a
   * save is O(tasks) instead of O(tasks + every event ever recorded).
   */
  saveSnapshot(
    tasks: Map<string, Task>,
    rootTaskIds: string[],
    nextSeq: number,
  ): void {
    const serializedTasks: SerializedTask[] = [];
    for (const task of tasks.values()) {
      serializedTasks.push(task.serialize());
    }

    const snapshot: SnapshotData = {
      tasks: serializedTasks,
      rootTaskIds,
      nextSeq,
      version: CURRENT_VERSION,
      timestamp: new Date().toISOString(),
    };

    const content = JSON.stringify(snapshot, null, 2);
    AtomicWriter.writeWithBackup(this.snapshotPath, content);
  }

  /**
   * Load and validate the current snapshot.
   * Returns null if no snapshot exists or it is corrupted.
   */
  loadSnapshot(): SnapshotData | null {
    if (!existsSync(this.snapshotPath)) {
      return null;
    }

    try {
      const raw = readFileSync(this.snapshotPath, 'utf-8');
      const data = JSON.parse(raw) as SnapshotData;

      // Basic structural validation
      if (!Array.isArray(data.tasks)) return null;
      if (!Array.isArray(data.rootTaskIds)) return null;
      if (typeof data.nextSeq !== 'number') return null;
      if (typeof data.version !== 'number') return null;
      if (typeof data.timestamp !== 'string') return null;

      return data;
    } catch {
      return null;
    }
  }

  /**
   * Manually trigger a backup of the current snapshot.
   * Renames current snapshot to .bak, preserving it before next save.
   */
  backup(): void {
    if (!existsSync(this.snapshotPath)) {
      return;
    }

    const raw = readFileSync(this.snapshotPath, 'utf-8');
    AtomicWriter.writeWithBackup(this.snapshotPath, raw);
  }
}
