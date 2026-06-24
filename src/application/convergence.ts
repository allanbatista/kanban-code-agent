/**
 * Convergence detection: detects stagnation between consecutive runs.
 * Uses simple Jaccard similarity on normalized tokens.
 */

const DEFAULT_THETA = 0.9; // similarity threshold (0-1, higher = more similar)
const DEFAULT_STAGNATION_EPOCHS = 3;

/** Normalize text into a set of word tokens for comparison. */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

/** Jaccard similarity between two sets (0 = disjoint, 1 = identical). */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/** Compute similarity between two text outputs. */
export function computeSimilarity(prev: string, current: string): number {
  return jaccardSimilarity(tokenize(prev), tokenize(current));
}

/** Signal extracted from a run for convergence comparison. */
export interface RunSignal {
  output: string;
  epoch: number;
}

/**
 * Check if the task has stagnated (outputs too similar for N consecutive epochs).
 * Returns 'stagnation' if stagnated, null otherwise.
 */
export function checkStagnation(
  signals: RunSignal[],
  theta: number = DEFAULT_THETA,
  stagnationEpochs: number = DEFAULT_STAGNATION_EPOCHS,
): 'stagnation' | null {
  if (signals.length < stagnationEpochs + 1) return null;

  // Check the last N consecutive pairs
  const recent = signals.slice(-stagnationEpochs - 1);
  let stagnantCount = 0;

  for (let i = 1; i < recent.length; i++) {
    const similarity = computeSimilarity(recent[i - 1].output, recent[i].output);
    if (similarity >= theta) {
      stagnantCount++;
    }
  }

  return stagnantCount >= stagnationEpochs ? 'stagnation' : null;
}
