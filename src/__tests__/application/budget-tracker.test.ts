import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetTracker } from '../../application/budget-tracker.js';
import type { BudgetSummary } from '../../application/budget-tracker.js';

describe('BudgetTracker', () => {
  let tracker: BudgetTracker;

  beforeEach(() => {
    tracker = new BudgetTracker(100000, 5.0);
  });

  describe('trackUsage', () => {
    it('accumulates tokens and cost for a task', () => {
      tracker.trackUsage('task_1', 500, 300, 0.02);
      const usage = tracker.getTaskUsage('task_1');
      expect(usage).toBeDefined();
      expect(usage!.input).toBe(500);
      expect(usage!.output).toBe(300);
      expect(usage!.total).toBe(800);
      expect(usage!.cost).toBeCloseTo(0.02);
    });

    it('accumulates across multiple trackUsage calls for same task', () => {
      tracker.trackUsage('task_1', 100, 50, 0.005);
      tracker.trackUsage('task_1', 200, 100, 0.01);

      const usage = tracker.getTaskUsage('task_1');
      expect(usage!.input).toBe(300);
      expect(usage!.output).toBe(150);
      expect(usage!.total).toBe(450);
      expect(usage!.cost).toBeCloseTo(0.015);
    });

    it('tracks separate tasks independently', () => {
      tracker.trackUsage('task_a', 100, 50, 0.01);
      tracker.trackUsage('task_b', 200, 100, 0.02);

      const a = tracker.getTaskUsage('task_a');
      const b = tracker.getTaskUsage('task_b');

      expect(a!.total).toBe(150);
      expect(b!.total).toBe(300);
    });

    it('returns undefined for unknown task', () => {
      expect(tracker.getTaskUsage('unknown')).toBeUndefined();
    });
  });

  describe('getTotalTokens', () => {
    it('returns summed token counts', () => {
      tracker.trackUsage('task_1', 100, 50, 0.01);
      tracker.trackUsage('task_2', 200, 150, 0.02);

      const totals = tracker.getTotalTokens();
      expect(totals.input).toBe(300);
      expect(totals.output).toBe(200);
      expect(totals.total).toBe(500);
    });

    it('returns zeros when no usage tracked', () => {
      const totals = tracker.getTotalTokens();
      expect(totals.input).toBe(0);
      expect(totals.output).toBe(0);
      expect(totals.total).toBe(0);
    });
  });

  describe('getTotalCost', () => {
    it('returns summed cost', () => {
      tracker.trackUsage('task_1', 100, 50, 0.015);
      tracker.trackUsage('task_2', 200, 100, 0.025);

      expect(tracker.getTotalCost()).toBeCloseTo(0.04);
    });

    it('returns 0 when no usage', () => {
      expect(tracker.getTotalCost()).toBe(0);
    });
  });

  describe('isWithinBudget', () => {
    it('returns true when under limits', () => {
      tracker.trackUsage('task_1', 50000, 30000, 2.0);
      expect(tracker.isWithinBudget()).toBe(true);
    });

    it('respects maxTokens limit', () => {
      tracker.trackUsage('task_1', 60000, 41000, 1.0);
      expect(tracker.isWithinBudget()).toBe(false);
    });

    it('respects maxCost limit', () => {
      tracker.trackUsage('task_1', 100, 100, 6.0);
      expect(tracker.isWithinBudget()).toBe(false);
    });

    it('token limit of 0 disables token check', () => {
      const t = new BudgetTracker(0, 5.0);
      t.trackUsage('task_1', 9999999, 9999999, 2.0);
      expect(t.isWithinBudget()).toBe(true);
    });

    it('cost limit of 0 disables cost check', () => {
      const t = new BudgetTracker(100000, 0);
      t.trackUsage('task_1', 100, 100, 999999);
      expect(t.isWithinBudget()).toBe(true);
    });

    it('both limits 0 disables all checks', () => {
      const t = new BudgetTracker(0, 0);
      t.trackUsage('task_1', 9999999, 9999999, 999999);
      expect(t.isWithinBudget()).toBe(true);
    });

    it('negative constructor values are clamped to 0', () => {
      const t = new BudgetTracker(-100, -5);
      t.trackUsage('task_1', 999999, 999999, 999999);
      expect(t.isWithinBudget()).toBe(true);
    });

    it('at exactly maxTokens returns true (not exceeded)', () => {
      const t = new BudgetTracker(1000, 10);
      t.trackUsage('task_1', 500, 500, 1.0);
      expect(t.isWithinBudget()).toBe(true);
    });

    it('one token over maxTokens returns false', () => {
      const t = new BudgetTracker(1000, 10);
      t.trackUsage('task_1', 500, 501, 1.0);
      expect(t.isWithinBudget()).toBe(false);
    });
  });

  describe('reset', () => {
    it('clears all tracking data', () => {
      tracker.trackUsage('task_1', 100, 50, 0.01);
      tracker.reset();

      expect(tracker.getTotalTokens().total).toBe(0);
      expect(tracker.getTotalCost()).toBe(0);
      expect(tracker.getTaskUsage('task_1')).toBeUndefined();
    });
  });

  describe('getSummary', () => {
    it('returns correct structure', () => {
      tracker.trackUsage('task_a', 100, 50, 0.01);
      tracker.trackUsage('task_b', 200, 100, 0.02);

      const summary: BudgetSummary = tracker.getSummary();
      expect(summary.totalTokens).toBe(450);
      expect(summary.totalCost).toBeCloseTo(0.03);
      expect(summary.taskCount).toBe(2);
      expect(summary.exceeded).toBe(false);
    });

    it('sets exceeded=true when budget exceeded', () => {
      tracker.trackUsage('task_1', 60000, 41000, 0.5);
      const summary = tracker.getSummary();
      expect(summary.exceeded).toBe(true);
    });

    it('empty state returns all zeros', () => {
      const summary = tracker.getSummary();
      expect(summary.totalTokens).toBe(0);
      expect(summary.totalCost).toBe(0);
      expect(summary.taskCount).toBe(0);
      expect(summary.exceeded).toBe(false);
    });
  });
});
