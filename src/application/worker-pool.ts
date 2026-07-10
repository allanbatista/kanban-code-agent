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

type WorkerRunner = (signal: AbortSignal) => Promise<void>;
type ErrorHandler = (error: unknown) => void;

interface PendingRun {
  taskId: string;
  runner: WorkerRunner;
  onError?: ErrorHandler;
}

interface ActiveRun {
  controller: AbortController;
  timeoutId: ReturnType<typeof setTimeout>;
}

export class WorkerPool {
  private readonly runTimeoutMs: number;
  private readonly maxConcurrent: number;
  private readonly active = new Map<string, ActiveRun>();
  private readonly pending: PendingRun[] = [];

  constructor(runTimeoutMs: number, maxConcurrent = Number.MAX_SAFE_INTEGER) {
    this.runTimeoutMs = runTimeoutMs;
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  enqueue(taskId: string, runner: WorkerRunner, onError?: ErrorHandler): void {
    if (this.has(taskId)) return;
    this.pending.push({ taskId, runner, onError });
    this.drain();
  }

  cancel(taskId: string): void {
    const pendingIndex = this.pending.findIndex((run) => run.taskId === taskId);
    if (pendingIndex >= 0) {
      this.pending.splice(pendingIndex, 1);
      return;
    }

    const active = this.active.get(taskId);
    if (active) {
      active.controller.abort();
      clearTimeout(active.timeoutId);
      this.active.delete(taskId);
      this.drain();
    }
  }

  cancelAll(): void {
    this.pending.length = 0;
    for (const run of this.active.values()) {
      run.controller.abort();
      clearTimeout(run.timeoutId);
    }
    this.active.clear();
  }

  get activeCount(): number {
    return this.active.size;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  has(taskId: string): boolean {
    return this.active.has(taskId) || this.pending.some((run) => run.taskId === taskId);
  }

  private drain(): void {
    while (this.active.size < this.maxConcurrent && this.pending.length > 0) {
      const next = this.pending.shift();
      if (next) this.executeOne(next);
    }
  }

  private executeOne(run: PendingRun): void {
    const controller = new AbortController();
    let timeoutId!: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new RunTimeoutError(this.runTimeoutMs));
        controller.abort();
      }, this.runTimeoutMs);
    });
    this.active.set(run.taskId, { controller, timeoutId });

    const runnerPromise = run.runner(controller.signal);
    runnerPromise.catch(() => undefined);

    Promise.race([runnerPromise, timeout])
      .catch((_error) => {
        run.onError?.(_error);
      })
      .finally(() => {
        clearTimeout(timeoutId);
        this.active.delete(run.taskId);
        this.drain();
      });
  }
}
