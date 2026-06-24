import { describe, it, expect } from 'vitest';
import { computeSimilarity, checkStagnation, type RunSignal } from '../../application/convergence.js';

describe('Convergence detection', () => {
  describe('computeSimilarity', () => {
    it('returns 1 for identical texts', () => {
      expect(computeSimilarity('hello world', 'hello world')).toBe(1);
    });

    it('returns 0 for completely different texts', () => {
      expect(computeSimilarity('apple banana cherry', 'dog elephant fox')).toBe(0);
    });

    it('returns value between 0 and 1 for partially similar texts', () => {
      const sim = computeSimilarity('hello world foo', 'hello world bar');
      expect(sim).toBeGreaterThan(0);
      expect(sim).toBeLessThan(1);
    });

    it('handles empty strings', () => {
      expect(computeSimilarity('', '')).toBe(1);
    });
  });

  describe('checkStagnation', () => {
    it('returns null with too few signals', () => {
      const signals: RunSignal[] = [
        { output: 'result 1', epoch: 1 },
        { output: 'result 2', epoch: 2 },
      ];
      expect(checkStagnation(signals)).toBeNull();
    });

    it('detects stagnation with similar outputs', () => {
      const signals: RunSignal[] = [
        { output: 'the quick brown fox jumps over the lazy dog', epoch: 1 },
        { output: 'the quick brown fox jumps over the lazy cat', epoch: 2 },
        { output: 'the quick brown fox jumps over the lazy bird', epoch: 3 },
        { output: 'the quick brown fox jumps over the lazy fish', epoch: 4 },
      ];
      expect(checkStagnation(signals, 0.7, 3)).toBe('stagnation');
    });

    it('returns null for diverse outputs', () => {
      const signals: RunSignal[] = [
        { output: 'first approach: use REST API with Express', epoch: 1 },
        { output: 'second approach: switch to GraphQL with Apollo', epoch: 2 },
        { output: 'third approach: try gRPC with protobuf', epoch: 3 },
        { output: 'fourth approach: use WebSocket streaming', epoch: 4 },
      ];
      expect(checkStagnation(signals, 0.8, 3)).toBeNull();
    });

    it('returns null when only last 2 are similar (below threshold)', () => {
      const signals: RunSignal[] = [
        { output: 'completely different approach number one', epoch: 1 },
        { output: 'totally unrelated second strategy here', epoch: 2 },
        { output: 'the quick brown fox jumps lazy', epoch: 3 },
        { output: 'the quick brown fox jumps lazy', epoch: 4 },
      ];
      // Only 1 consecutive pair is similar, need 3
      expect(checkStagnation(signals, 0.8, 3)).toBeNull();
    });
  });
});
