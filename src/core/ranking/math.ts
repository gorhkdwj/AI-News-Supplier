export interface WeightedComponent {
  value: number | null;
  weight: number;
}

export function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export function naturalLogNorm(value: number, ceiling: number): number {
  if (value <= 0 || ceiling <= 0) return 0;
  return clamp(Math.log1p(value) / Math.log1p(ceiling));
}

/**
 * Returns one percentile per input position. Nulls are absent from the
 * population while a numeric zero remains a real observation.
 */
export function midrankPercentiles(values: readonly (number | null)[]): Array<number | null> {
  const population = values
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (population.length === 0) return values.map(() => null);

  const percentiles = new Map<number, number>();
  for (let start = 0; start < population.length;) {
    const value = population[start] as number;
    let end = start + 1;
    while (end < population.length && population[end] === value) end += 1;
    const firstRank = start + 1;
    const lastRank = end;
    const averageRank = (firstRank + lastRank) / 2;
    percentiles.set(value, (averageRank - 0.5) / population.length);
    start = end;
  }

  return values.map((value) => (value === null ? null : (percentiles.get(value) ?? null)));
}

export function weightedAverage(components: readonly WeightedComponent[]): number | null {
  let weightedSum = 0;
  let presentWeight = 0;
  for (const component of components) {
    if (component.value === null || component.weight <= 0) continue;
    weightedSum += component.value * component.weight;
    presentWeight += component.weight;
  }
  return presentWeight === 0 ? null : weightedSum / presentWeight;
}

export function nearestRankPercentile(
  values: readonly number[],
  percentile: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(clamp(percentile) * sorted.length);
  return sorted[Math.max(0, rank - 1)] as number;
}

export function ageHours(reference: string, now: Date): number {
  const timestamp = Date.parse(reference);
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - timestamp) / 3_600_000);
}

export function normalizedLimit(limit: number | undefined, available: number): number {
  if (limit === undefined) return available;
  if (!Number.isFinite(limit)) return available;
  return Math.min(available, Math.max(0, Math.floor(limit)));
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
