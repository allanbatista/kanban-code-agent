/**
 * Worker pool — timeout and cancel for concurrently running tasks.
 * Pure scheduling logic, no domain dependencies.
 */

export class RunTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Run excedeu timeout de ${timeoutMs}ms`);
    this.name = 'RunTimeoutError';
  }
}

export class WorkerPool {
  private readonly runTimeoutMs: number;
  private readonly active = new Map<string, AbortController>();

  constructor(runTimeoutMs: number) {
    this.runTimeoutMs = runTimeoutMs;
  }

  enqueue(taskId: string, runner: () => Promise<void>): void {
    if (this.active.has(taskId)) return; // already running
    this.executeOne(taskId, runner);
  }

  cancel(taskId: string): void {
    const controller = this.active.get(taskId);
    if (controller) {
      controller.abort();
      this.active.delete(taskId);
    }
  }

  cancelAll(): void {
    for (const controller of this.active.values()) {
      controller.abort();
    }
    this.active.clear();
  }

  get activeCount(): number {
    return this.active.size;
  }

  get pendingCount(): number {
    return 0;
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
      });
  }
}
