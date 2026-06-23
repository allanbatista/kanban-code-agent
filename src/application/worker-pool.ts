/**
 * Worker pool — concurrency control, timeout, cancel.
 * Pure scheduling logic, no domain dependencies.
 */

export class RunTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Run excedeu timeout de ${timeoutMs}ms`);
    this.name = 'RunTimeoutError';
  }
}

export class WorkerPool {
  private readonly maxConcurrency: number;
  private readonly runTimeoutMs: number;
  private readonly active = new Map<string, AbortController>();
  private readonly pending: Array<{ taskId: string; runner: () => Promise<void> }> = [];

  constructor(maxConcurrency: number, runTimeoutMs: number) {
    this.maxConcurrency = maxConcurrency;
    this.runTimeoutMs = runTimeoutMs;
  }

  enqueue(taskId: string, runner: () => Promise<void>): void {
    if (this.active.has(taskId)) return; // already running
    if (
      this.pending.some((entry) => entry.taskId === taskId) ||
      this.pending.length === 0
    ) {
      // will be handled by pump
    }
    this.pending.push({ taskId, runner });
    this.pump();
  }

  cancel(taskId: string): void {
    const controller = this.active.get(taskId);
    if (controller) {
      controller.abort();
      this.active.delete(taskId);
    }
    // Remove from pending
    const idx = this.pending.findIndex((entry) => entry.taskId === taskId);
    if (idx !== -1) this.pending.splice(idx, 1);
  }

  cancelAll(): void {
    for (const controller of this.active.values()) {
      controller.abort();
    }
    this.active.clear();
    this.pending.length = 0;
  }

  get activeCount(): number {
    return this.active.size;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  private pump(): void {
    while (this.active.size < this.maxConcurrency && this.pending.length > 0) {
      const entry = this.pending.shift();
      if (!entry) break;
      this.executeOne(entry.taskId, entry.runner);
    }
  }

  private executeOne(taskId: string, runner: () => Promise<void>): void {
    const controller = new AbortController();
    this.active.set(taskId, controller);

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.runTimeoutMs);

    runner()
      .catch((_error) => {
        // Caller handles error via promise chain; worker pool just cleans up
      })
      .finally(() => {
        clearTimeout(timeoutId);
        this.active.delete(taskId);
        // Pump next pending
        process.nextTick(() => this.pump());
      });
  }
}
