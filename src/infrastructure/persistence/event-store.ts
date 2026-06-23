import { readFileSync, existsSync } from 'node:fs';
import { AtomicWriter } from '../filesystem/atomic-writer.js';
import { PathSandbox } from '../filesystem/sandbox.js';
import type { SwarmEvent } from '../../domain/events.js';

/**
 * Append-only event log in `.swarm/events/current.jsonl`.
 * Each line is a JSON-serialized SwarmEvent.
 * Resilient to truncated last line (e.g. crash during append).
 */

export class EventStore {
  private readonly logPath: string;

  constructor(private readonly sandbox: PathSandbox) {
    this.logPath = this.sandbox.resolve('.swarm/events/current.jsonl');
  }

  /** Append a single event atomically to the JSONL log. */
  append(event: SwarmEvent): void {
    const line = JSON.stringify(event);
    AtomicWriter.appendLine(this.logPath, line);
  }

  /** Read all events from the log. Resilient to truncated last line. */
  loadAll(): SwarmEvent[] {
    return this.readLines().map((line) => JSON.parse(line) as SwarmEvent);
  }

  /** Filter events that target a specific task. */
  getByTaskId(taskId: string): SwarmEvent[] {
    return this.loadAll().filter((e) => e.taskId === taskId);
  }

  /**
   * Most recent event for a task.
   * Returns undefined if no events found for the task.
   */
  getLatestByTaskId(taskId: string): SwarmEvent | undefined {
    const events = this.getByTaskId(taskId);
    return events.length > 0 ? events[events.length - 1] : undefined;
  }

  /** Total number of events in the log. */
  count(): number {
    return this.loadAll().length;
  }

  /** Read all non-empty lines from the JSONL file. resilient to trailing truncation. */
  private readLines(): string[] {
    if (!existsSync(this.logPath)) {
      return [];
    }

    const raw = readFileSync(this.logPath, 'utf-8');
    const lines = raw.split('\n').filter((line) => line.trim() !== '');

    // If last line is not valid JSON, discard it (truncated on crash)
    if (lines.length > 0) {
      try {
        JSON.parse(lines[lines.length - 1]);
      } catch {
        lines.pop();
      }
    }

    return lines;
  }
}
