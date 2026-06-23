import { AtomicWriter } from '../filesystem/atomic-writer';
import type { Logger } from './logger';

/**
 * Audit trail for all system actions.
 * Writes append-only JSONL to `.swarm/logs/audit.jsonl`.
 */

interface AuditEntry {
  timestamp: string;
  action: string;
  actor: string;
  target?: string;
  details?: Record<string, unknown>;
  result?: 'success' | 'failure';
  error?: string;
}

export class AuditTrail {
  private logPath: string;

  constructor(
    private readonly baseDir: string,
    private readonly logger: Logger,
  ) {
    this.logPath = `${baseDir}/.swarm/logs/audit.jsonl`;
  }

  record(
    action: string,
    actor: string,
    options?: {
      target?: string;
      details?: Record<string, unknown>;
      result?: 'success' | 'failure';
      error?: string;
    },
  ): void {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      action,
      actor,
      ...(options?.target ? { target: options.target } : {}),
      ...(options?.details ? { details: options.details } : {}),
      ...(options?.result ? { result: options.result } : {}),
      ...(options?.error ? { error: options.error } : {}),
    };

    try {
      AtomicWriter.appendLine(this.logPath, JSON.stringify(entry));
      this.logger.debug(`Audit: ${action}`, { actor, target: options?.target });
    } catch (err) {
      this.logger.error('Failed to write audit entry', err);
    }
  }

  recordSuccess(action: string, actor: string, target?: string, details?: Record<string, unknown>): void {
    this.record(action, actor, { target, details, result: 'success' });
  }

  recordFailure(action: string, actor: string, error: string, target?: string): void {
    this.record(action, actor, { target, result: 'failure', error });
  }
}

export function createAuditTrail(baseDir: string, logger: Logger): AuditTrail {
  return new AuditTrail(baseDir, logger);
}
