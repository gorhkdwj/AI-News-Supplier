import { normalizedLimit } from './math.js';

/**
 * Applies a source-share target without dropping results. The cap is relaxed
 * one item at a time only when the remaining sources cannot fill the limit.
 */
export function diversifyBySource<T extends { source: string }>(
  ranked: readonly T[],
  limit: number | undefined,
  targetRatio = 0.4,
): T[] {
  const targetCount = normalizedLimit(limit, ranked.length);
  if (targetCount === 0) return [];
  if (new Set(ranked.map((item) => item.source)).size <= 1) {
    return ranked.slice(0, targetCount);
  }

  const selected: T[] = [];
  const selectedIndexes = new Set<number>();
  const sourceCounts = new Map<string, number>();
  const initialCap = Math.max(1, Math.floor(targetCount * targetRatio));

  for (let cap = initialCap; selected.length < targetCount && cap <= targetCount; cap += 1) {
    for (let index = 0; index < ranked.length && selected.length < targetCount; index += 1) {
      if (selectedIndexes.has(index)) continue;
      const item = ranked[index] as T;
      const count = sourceCounts.get(item.source) ?? 0;
      if (count >= cap) continue;
      selected.push(item);
      selectedIndexes.add(index);
      sourceCounts.set(item.source, count + 1);
    }
  }
  return selected;
}
