import { describe, expect, it } from 'vitest';

import {
  midrankPercentiles,
  naturalLogNorm,
  nearestRankPercentile,
  weightedAverage,
} from '../../../src/core/ranking/math.js';

describe('ranking math', () => {
  it('computes ascending midrank percentiles, including real zero and excluding null', () => {
    expect(midrankPercentiles([0, 10, 20, 20, null])).toEqual([0.125, 0.375, 0.75, 0.75, null]);
    expect(midrankPercentiles([7])).toEqual([0.5]);
  });

  it('normalizes with natural logarithms and clamps to zero through one', () => {
    expect(naturalLogNorm(0, 100)).toBe(0);
    expect(naturalLogNorm(100, 100)).toBe(1);
    expect(naturalLogNorm(1_000, 100)).toBe(1);
    expect(naturalLogNorm(-1, 100)).toBe(0);
  });

  it('reweights missing weighted-average components without treating them as zero', () => {
    expect(
      weightedAverage([
        { value: 1, weight: 0.45 },
        { value: null, weight: 0.25 },
        { value: 0, weight: 0.3 },
      ]),
    ).toBeCloseTo(0.6, 12);
    expect(weightedAverage([{ value: null, weight: 1 }])).toBeNull();
  });

  it('uses deterministic nearest-rank percentiles', () => {
    expect(nearestRankPercentile([1, 3, 2, 100], 0.75)).toBe(3);
    expect(nearestRankPercentile([], 0.95)).toBeNull();
  });
});
