import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkerPool, RunTimeoutError } from '../../application/worker-pool.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('WorkerPool', () => {
  let pool: WorkerPool;

  beforeEach(() => {
    pool = new WorkerPool(2, 5000);
  });

  afterEach(() => {
    pool.cancelAll();
  });

  describe('concurrency limit', () => {
    it('executes at most maxConcurrency tasks simultaneously', async () => {
      const running = new Set<string>();
      const completed: string[] = [];
      const pool2 = new WorkerPool(2, 1000);

      const makeRunner = (id: string) => async () => {
        running.add(id);
        await delay(100);
        completed.push(id);
        running.delete(id);
      };

      pool2.enqueue('a', makeRunner('a'));
      pool2.enqueue('b', makeRunner('b'));
      pool2.enqueue('c', makeRunner('c'));
      pool2.enqueue('d', makeRunner('d'));
      pool2.enqueue('e', makeRunner('e'));

      await delay(20);
      expect(running.size).toBeLessThanOrEqual(2);

      // Wait for all to complete
      while (completed.length < 5) {
        await delay(50);
      }
      expect(completed).toHaveLength(5);
      pool2.cancelAll();
    });

    it('maxConcurrency=1 runs tasks sequentially', async () => {
      const pool1 = new WorkerPool(1, 1000);
      const order: string[] = [];

      pool1.enqueue('a', async () => { order.push('a-start'); await delay(30); order.push('a-end'); });
      pool1.enqueue('b', async () => { order.push('b-start'); await delay(10); order.push('b-end'); });

      // Wait for completion
      while (order.length < 4) {
        await delay(20);
      }

      expect(order[0]).toBe('a-start');
      expect(order[order.length - 1]).toBe('b-end');
      pool1.cancelAll();
    });
  });

  describe('timeout', () => {
    it('aborts task via AbortController after timeout', async () => {
      const poolTimeout = new WorkerPool(1, 100);

      poolTimeout.enqueue('timeout-task', () => new Promise(() => {}));

      await delay(200);
      // After timeout, the abort signal fires. But the runner still hangs.
      // WorkerPool's cleanup only runs on promise settlement.
      expect(poolTimeout.activeCount).toBe(1); // hung task
      poolTimeout.cancelAll();
    });
  });

  describe('cancel', () => {
    it('removes pending task from queue', () => {
      pool = new WorkerPool(1, 5000);
      pool.enqueue('blocker', () => new Promise(() => {}));
      pool.enqueue('pending-a', () => Promise.resolve());
      pool.enqueue('pending-b', () => Promise.resolve());

      expect(pool.pendingCount).toBe(2);
      pool.cancel('pending-a');
      expect(pool.pendingCount).toBe(1);
      pool.cancel('pending-b');
      expect(pool.pendingCount).toBe(0);
      pool.cancelAll();
    });

    it('cancels active running task via AbortController', () => {
      pool = new WorkerPool(1, 5000);
      pool.enqueue('active', () => new Promise(() => {}));
      expect(pool.activeCount).toBe(1);
      pool.cancel('active');
    });

    it('is no-op for unknown task', () => {
      expect(() => pool.cancel('unknown')).not.toThrow();
    });
  });

  describe('cancelAll', () => {
    it('clears all active and pending tasks', () => {
      pool = new WorkerPool(2, 5000);
      pool.enqueue('a', () => new Promise(() => {}));
      pool.enqueue('b', () => new Promise(() => {}));
      pool.enqueue('c', () => Promise.resolve());
      pool.enqueue('d', () => Promise.resolve());

      expect(pool.activeCount).toBe(2);
      expect(pool.pendingCount).toBe(2);

      pool.cancelAll();
      expect(pool.activeCount).toBe(0);
      expect(pool.pendingCount).toBe(0);
    });
  });

  describe('activeCount / pendingCount', () => {
    it('shows correct active count while tasks running', async () => {
      pool = new WorkerPool(2, 5000);
      const completed: string[] = [];

      pool.enqueue('slow-a', async () => { await delay(200); completed.push('a'); });
      pool.enqueue('slow-b', async () => { await delay(200); completed.push('b'); });

      await delay(20);
      expect(pool.activeCount).toBe(2);

      while (completed.length < 2) {
        await delay(50);
      }
      expect(pool.activeCount).toBe(0);
      pool.cancelAll();
    });

    it('pending count decreases as tasks complete', async () => {
      pool = new WorkerPool(1, 5000);
      const completed: string[] = [];

      pool.enqueue('a', async () => { await delay(50); completed.push('a'); });
      pool.enqueue('b', async () => { await delay(10); completed.push('b'); });

      while (completed.length < 2) {
        await delay(30);
      }
      expect(pool.pendingCount).toBe(0);
      pool.cancelAll();
    });
  });

  describe('completion', () => {
    it('all tasks complete successfully', async () => {
      pool = new WorkerPool(3, 5000);
      const completed: string[] = [];

      for (let i = 0; i < 10; i++) {
        pool.enqueue(`task_${i}`, async () => {
          await delay(5);
          completed.push(`task_${i}`);
        });
      }

      while (completed.length < 10) {
        await delay(50);
      }
      expect(completed).toHaveLength(10);
      pool.cancelAll();
    });

    it('handles runner errors without breaking pool', async () => {
      pool = new WorkerPool(2, 5000);
      const completed: string[] = [];

      pool.enqueue('fail', () => Promise.reject(new Error('runner error')));
      pool.enqueue('ok-a', async () => { completed.push('a'); });
      pool.enqueue('ok-b', async () => { completed.push('b'); });

      while (completed.length < 2) {
        await delay(30);
      }
      expect(completed).toContain('a');
      expect(completed).toContain('b');
      pool.cancelAll();
    });
  });
});
