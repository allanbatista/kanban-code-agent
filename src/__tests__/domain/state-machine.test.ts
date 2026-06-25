import { describe, it, expect } from 'vitest';
import { TASK_STATUS } from '../../domain/types.js';
import { Task } from '../../domain/task.js';
import type { SerializedTask } from '../../domain/task.js';
import { canTransition, transitionTask } from '../../domain/state-machine.js';

describe('State Machine', () => {
  function makeTask(status: string): Task {
    const task = new Task({ taskId: 'task_1', title: 'Test', assignedTo: 'agent', depth: 0 }, false);
    (task as any).status = status;
    return task;
  }

  describe('canTransition', () => {
    it('allows PENDING → QUEUED', () => {
      expect(canTransition(TASK_STATUS.PENDING, TASK_STATUS.QUEUED)).toBe(true);
    });

    it('allows QUEUED → RUNNING', () => {
      expect(canTransition(TASK_STATUS.QUEUED, TASK_STATUS.RUNNING)).toBe(true);
    });

    it('allows RUNNING → WAITING', () => {
      expect(canTransition(TASK_STATUS.RUNNING, TASK_STATUS.WAITING)).toBe(true);
    });

    it('allows RUNNING → REVIEW', () => {
      expect(canTransition(TASK_STATUS.RUNNING, TASK_STATUS.REVIEW)).toBe(true);
    });

    it('allows RUNNING → COMPLETED', () => {
      expect(canTransition(TASK_STATUS.RUNNING, TASK_STATUS.COMPLETED)).toBe(true);
    });

    it('allows RUNNING → FAILED', () => {
      expect(canTransition(TASK_STATUS.RUNNING, TASK_STATUS.FAILED)).toBe(true);
    });

    it('allows RUNNING → SUSPENDED', () => {
      expect(canTransition(TASK_STATUS.RUNNING, TASK_STATUS.SUSPENDED)).toBe(true);
    });

    it('allows SUSPENDED → PENDING (resume)', () => {
      expect(canTransition(TASK_STATUS.SUSPENDED, TASK_STATUS.PENDING)).toBe(true);
    });

    it('allows SUSPENDED → CANCELLED', () => {
      expect(canTransition(TASK_STATUS.SUSPENDED, TASK_STATUS.CANCELLED)).toBe(true);
    });

    it('rejects SUSPENDED → RUNNING directly (must go through PENDING)', () => {
      expect(canTransition(TASK_STATUS.SUSPENDED, TASK_STATUS.RUNNING)).toBe(false);
    });

    it('rejects SUSPENDED → QUEUED', () => {
      expect(canTransition(TASK_STATUS.SUSPENDED, TASK_STATUS.QUEUED)).toBe(false);
    });

    it('allows REVIEW → COMPLETED', () => {
      expect(canTransition(TASK_STATUS.REVIEW, TASK_STATUS.COMPLETED)).toBe(true);
    });

    it('allows REVIEW → RUNNING (reopen)', () => {
      expect(canTransition(TASK_STATUS.REVIEW, TASK_STATUS.RUNNING)).toBe(true);
    });

    it('allows WAITING → RUNNING (resume)', () => {
      expect(canTransition(TASK_STATUS.WAITING, TASK_STATUS.RUNNING)).toBe(true);
    });

    it('allows any non-terminal → CANCELLED', () => {
      const nonTerminal = [TASK_STATUS.PENDING, TASK_STATUS.QUEUED, TASK_STATUS.RUNNING, TASK_STATUS.WAITING, TASK_STATUS.REVIEW];
      for (const from of nonTerminal) {
        expect(canTransition(from, TASK_STATUS.CANCELLED)).toBe(true);
      }
    });

    it('rejects COMPLETED → anything', () => {
      for (const to of Object.values(TASK_STATUS)) {
        if (to === TASK_STATUS.COMPLETED) continue;
        expect(canTransition(TASK_STATUS.COMPLETED, to)).toBe(false);
      }
    });

    it('rejects FAILED → anything', () => {
      for (const to of Object.values(TASK_STATUS)) {
        if (to === TASK_STATUS.FAILED) continue;
        expect(canTransition(TASK_STATUS.FAILED, to)).toBe(false);
      }
    });

    it('rejects CANCELLED → anything', () => {
      for (const to of Object.values(TASK_STATUS)) {
        if (to === TASK_STATUS.CANCELLED) continue;
        expect(canTransition(TASK_STATUS.CANCELLED, to)).toBe(false);
      }
    });

    it('allows QUEUED → PENDING (crash recovery / move)', () => {
      expect(canTransition(TASK_STATUS.QUEUED, TASK_STATUS.PENDING)).toBe(true);
    });

    it('allows RUNNING → PENDING (retry)', () => {
      expect(canTransition(TASK_STATUS.RUNNING, TASK_STATUS.PENDING)).toBe(true);
    });
  });

  describe('transitionTask', () => {
    it('transitions task status when valid', () => {
      const task = makeTask(TASK_STATUS.PENDING);
      transitionTask(task, TASK_STATUS.QUEUED);
      expect(task.status).toBe(TASK_STATUS.QUEUED);
    });

    it('throws on illegal transition', () => {
      const task = makeTask(TASK_STATUS.COMPLETED);
      expect(() => transitionTask(task, TASK_STATUS.RUNNING)).toThrow(/illegal.*transition/i);
    });

    it('preserves status on illegal transition', () => {
      const task = makeTask(TASK_STATUS.COMPLETED);
      try { transitionTask(task, TASK_STATUS.RUNNING); } catch {}
      expect(task.status).toBe(TASK_STATUS.COMPLETED);
    });
  });

  describe('Task.setStatus (guarded)', () => {
    it('allows a legal transition', () => {
      const task = makeTask(TASK_STATUS.PENDING);
      task.setStatus(TASK_STATUS.QUEUED);
      expect(task.status).toBe(TASK_STATUS.QUEUED);
    });

    it('throws on an illegal transition and preserves status', () => {
      const task = makeTask(TASK_STATUS.PENDING);
      expect(() => task.setStatus(TASK_STATUS.COMPLETED)).toThrow(/Illegal transition/i);
      expect(task.status).toBe(TASK_STATUS.PENDING);
    });

    it('force bypasses the guard (reopen / restore)', () => {
      const task = makeTask(TASK_STATUS.COMPLETED);
      task.setStatus(TASK_STATUS.PENDING, { force: true });
      expect(task.status).toBe(TASK_STATUS.PENDING);
    });

    it('sets failureReason and waitingReason atomically', () => {
      const task = makeTask(TASK_STATUS.RUNNING);
      task.setStatus(TASK_STATUS.FAILED, { force: true, failureReason: 'ceiling' });
      expect(task.status).toBe(TASK_STATUS.FAILED);
      expect(task.failureReason).toBe('ceiling');
    });

    it('treats a self-transition as a no-op (no throw)', () => {
      const task = makeTask(TASK_STATUS.RUNNING);
      expect(() => task.setStatus(TASK_STATUS.RUNNING)).not.toThrow();
    });
  });

  describe('failureReason', () => {
    it('is undefined by default', () => {
      const task = makeTask(TASK_STATUS.PENDING);
      expect(task.failureReason).toBeUndefined();
    });

    it('survives serialization round-trip', () => {
      const task = makeTask(TASK_STATUS.FAILED);
      task.failureReason = 'attempts';
      const serialized = task.serialize();
      expect(serialized.failureReason).toBe('attempts');

      const restored = Task.fromSerialized(serialized as SerializedTask);
      expect(restored.failureReason).toBe('attempts');
      expect(restored.status).toBe(TASK_STATUS.FAILED);
    });

    it('survives round-trip when undefined', () => {
      const task = makeTask(TASK_STATUS.COMPLETED);
      const serialized = task.serialize();
      const restored = Task.fromSerialized(serialized as SerializedTask);
      expect(restored.failureReason).toBeUndefined();
    });
  });

  describe('SUSPENDED serialization', () => {
    it('survives round-trip', () => {
      const task = makeTask(TASK_STATUS.SUSPENDED);
      const serialized = task.serialize();
      expect(serialized.status).toBe(TASK_STATUS.SUSPENDED);

      const restored = Task.fromSerialized(serialized as SerializedTask);
      expect(restored.status).toBe(TASK_STATUS.SUSPENDED);
    });
  });

  describe('full transition coverage', () => {
    const allStatuses = Object.values(TASK_STATUS);

    it('every non-terminal status has at least one outgoing transition', () => {
      const nonTerminal = [TASK_STATUS.PENDING, TASK_STATUS.QUEUED, TASK_STATUS.RUNNING, TASK_STATUS.WAITING, TASK_STATUS.SUSPENDED, TASK_STATUS.REVIEW];
      for (const from of nonTerminal) {
        const hasOutgoing = allStatuses.some((to) => canTransition(from, to));
        expect(hasOutgoing).toBe(true);
      }
    });

    it('terminal statuses have no outgoing transitions', () => {
      const terminal = [TASK_STATUS.COMPLETED, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED];
      for (const from of terminal) {
        const hasOutgoing = allStatuses.some((to) => canTransition(from, to));
        expect(hasOutgoing).toBe(false);
      }
    });
  });
});
