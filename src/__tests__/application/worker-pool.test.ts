import { describe, it, expect, afterEach } from 'vitest';
import { WorkerPool, RunTimeoutError } from '../../application/worker-pool.js';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('WorkerPool', () => {
  let pool: WorkerPool | undefined;

  afterEach(() => {
    pool?.cancelAll();
    pool = undefined;
  });

  it('respeita limite de concorrência e mantém pendentes', async () => {
    pool = new WorkerPool(5000, 2);
    const running: string[] = [];

    for (const id of ['a', 'b', 'c']) {
      pool.enqueue(id, async () => {
        running.push(id);
        await new Promise(() => {});
      });
    }

    await delay(20);

    expect(running).toEqual(['a', 'b']);
    expect(pool.activeCount).toBe(2);
    expect(pool.pendingCount).toBe(1);
  });

  it('drena pendentes quando uma execução termina', async () => {
    pool = new WorkerPool(5000, 1);
    const completed: string[] = [];

    pool.enqueue('a', async () => {
      await delay(10);
      completed.push('a');
    });
    pool.enqueue('b', async () => {
      completed.push('b');
    });

    await delay(40);

    expect(completed).toEqual(['a', 'b']);
    expect(pool.activeCount).toBe(0);
    expect(pool.pendingCount).toBe(0);
  });

  it('aborta por timeout e reporta RunTimeoutError', async () => {
    pool = new WorkerPool(20, 1);
    let aborted = false;
    let error: unknown;

    pool.enqueue(
      'timeout',
      async (signal) => {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        await new Promise(() => {});
      },
      (err) => {
        error = err;
      },
    );

    await delay(60);

    expect(aborted).toBe(true);
    expect(error).toBeInstanceOf(RunTimeoutError);
    expect(pool.activeCount).toBe(0);
  });

  it('cancela pendente sem iniciar execução', async () => {
    pool = new WorkerPool(5000, 1);
    const started: string[] = [];

    pool.enqueue('a', async () => {
      started.push('a');
      await new Promise(() => {});
    });
    pool.enqueue('b', async () => {
      started.push('b');
    });

    pool.cancel('b');
    await delay(20);

    expect(started).toEqual(['a']);
    expect(pool.pendingCount).toBe(0);
  });
});
