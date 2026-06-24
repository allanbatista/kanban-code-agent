/**
 * Error thrown when token or cost budget is exceeded.
 */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

/**
 * Per-task token and cost usage record.
 */
export interface TaskTokenUsage {
  input: number;
  output: number;
  total: number;
  cost: number;
}

/**
 * Aggregate budget summary.
 */
export interface BudgetSummary {
  totalTokens: number;
  totalCost: number;
  taskCount: number;
  exceeded: boolean;
}

/**
 * Per-card ceiling configuration.
 */
export interface CardCeiling {
  maxCost?: number;
  maxActiveMs?: number;
}

/**
 * Check if a task's metrics exceed its per-card ceiling.
 * Returns the reason if exceeded, null otherwise.
 */
export function checkCardCeiling(
  metrics: { cost: number; durationMs: number },
  ceiling: CardCeiling,
): 'ceiling' | null {
  if (ceiling.maxCost !== undefined && ceiling.maxCost > 0 && metrics.cost > ceiling.maxCost) {
    return 'ceiling';
  }
  if (ceiling.maxActiveMs !== undefined && ceiling.maxActiveMs > 0 && metrics.durationMs > ceiling.maxActiveMs) {
    return 'ceiling';
  }
  return null;
}

/**
 * Check if a task's metrics are approaching the ceiling (80% threshold).
 * Returns true if warning threshold reached.
 */
export function isApproachingCeiling(
  metrics: { cost: number; durationMs: number },
  ceiling: CardCeiling,
  warningRatio = 0.8,
): boolean {
  if (ceiling.maxCost !== undefined && ceiling.maxCost > 0 && metrics.cost > ceiling.maxCost * warningRatio) {
    return true;
  }
  if (ceiling.maxActiveMs !== undefined && ceiling.maxActiveMs > 0 && metrics.durationMs > ceiling.maxActiveMs * warningRatio) {
    return true;
  }
  return false;
}

/**
 * Tracks token usage and cost across all tasks in a swarm run.
 *
 * Thread-safe for callers that sequence calls (no internal locks needed).
 */
export class BudgetTracker {
  private readonly maxTokens: number;
  private readonly maxCost: number;
  private readonly tasks = new Map<string, TaskTokenUsage>();

  private totalTokens = 0;
  private totalCost = 0;

  /**
   * @param maxTokens  Maximum total input+output tokens allowed. 0 disables the limit.
   * @param maxCost    Maximum total cost in USD allowed. 0 disables the limit.
   */
  constructor(maxTokens: number, maxCost: number) {
    this.maxTokens = Math.max(0, maxTokens);
    this.maxCost = Math.max(0, maxCost);
  }

  /**
   * Record token usage and cost for a specific task invocation.
   */
  trackUsage(taskId: string, inputTokens: number, outputTokens: number, cost: number): void {
    const total = inputTokens + outputTokens;
    const existing = this.tasks.get(taskId);
    if (existing) {
      existing.input += inputTokens;
      existing.output += outputTokens;
      existing.total += total;
      existing.cost += cost;
    } else {
      this.tasks.set(taskId, { input: inputTokens, output: outputTokens, total, cost });
    }

    this.totalTokens += total;
    this.totalCost += cost;
  }

  /**
   * Aggregate token counts across all tracked tasks.
   */
  getTotalTokens(): { input: number; output: number; total: number } {
    let input = 0;
    let output = 0;
    for (const t of this.tasks.values()) {
      input += t.input;
      output += t.output;
    }
    return { input, output, total: input + output };
  }

  /**
   * Total cost in USD across all tracked tasks.
   */
  getTotalCost(): number {
    return this.totalCost;
  }

  /**
   * Per-task usage breakdown.
   */
  getTaskUsage(taskId: string): TaskTokenUsage | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Returns true when neither configured limit has been exceeded.
   */
  isWithinBudget(): boolean {
    if (this.maxTokens > 0 && this.totalTokens > this.maxTokens) return false;
    if (this.maxCost > 0 && this.totalCost > this.maxCost) return false;
    return true;
  }

  /**
   * Clear all tracking data and reset counters.
   */
  reset(): void {
    this.tasks.clear();
    this.totalTokens = 0;
    this.totalCost = 0;
  }

  /**
   * Full summary including exceeded flag.
   */
  getSummary(): BudgetSummary {
    return {
      totalTokens: this.totalTokens,
      totalCost: this.totalCost,
      taskCount: this.tasks.size,
      exceeded: !this.isWithinBudget(),
    };
  }
}
