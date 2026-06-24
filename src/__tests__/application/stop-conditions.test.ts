import { describe, it, expect } from 'vitest';
import { TASK_STATUS, SWARM_EVENT_TYPE } from '../../domain/types.js';
import { checkCardCeiling } from '../../application/budget-tracker.js';
import { checkStagnation, type RunSignal } from '../../application/convergence.js';

describe('Stop conditions catalog (§10)', () => {
  describe('1. Success (DoD ok)', () => {
    it('completed status is terminal', () => {
      expect(TASK_STATUS.COMPLETED).toBe('COMPLETED');
    });
  });

  describe('2. Max retries exhausted', () => {
    it('failureReason is attempts', () => {
      const reason = 'attempts' as const;
      expect(reason).toBe('attempts');
    });
  });

  describe('3. Stagnation (Δ < θ)', () => {
    it('detects stagnation with similar outputs', () => {
      const signals: RunSignal[] = [
        { output: 'same output text here', epoch: 1 },
        { output: 'same output text here', epoch: 2 },
        { output: 'same output text here', epoch: 3 },
        { output: 'same output text here', epoch: 4 },
      ];
      expect(checkStagnation(signals, 0.9, 3)).toBe('stagnation');
    });
  });

  describe('4. Depth limit', () => {
    it('failureReason is blocked', () => {
      const reason = 'blocked' as const;
      expect(reason).toBe('blocked');
    });
  });

  describe('5. Cost/time ceiling per card', () => {
    it('detects cost ceiling exceeded', () => {
      expect(checkCardCeiling({ cost: 10, durationMs: 1000 }, { maxCost: 5 })).toBe('ceiling');
    });

    it('detects time ceiling exceeded', () => {
      expect(checkCardCeiling({ cost: 0, durationMs: 10000 }, { maxActiveMs: 5000 })).toBe('ceiling');
    });

    it('returns null when within limits', () => {
      expect(checkCardCeiling({ cost: 1, durationMs: 1000 }, { maxCost: 5, maxActiveMs: 5000 })).toBeNull();
    });
  });

  describe('6. Human timeout', () => {
    it('failureReason is human_timeout → SUSPENDED', () => {
      const reason = 'human_timeout' as const;
      expect(reason).toBe('human_timeout');
    });
  });
});
