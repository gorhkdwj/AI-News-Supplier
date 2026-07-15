import {
  ageHours,
  clamp,
  compareText,
  midrankPercentiles,
  naturalLogNorm,
  normalizedLimit,
  round3,
} from './math.js';
import type { RankOptions, RankedTrend, TrendCandidate } from './types.js';

export interface RepositoryCandidate extends TrendCandidate {
  type: 'hot_repo';
  activityAt: string;
  createdAt: string;
  totalStars: number;
  delta24: number;
  baseline24: number | null;
  delta7: number;
  baseline7: number | null;
  quality: 'live' | 'legacy_unverified';
  aiEligible: boolean;
  fork: boolean;
  archived: boolean;
}

interface RepositorySignals {
  totalStars: number;
  totalStarsMidrank: number;
  totalStarsAbsolute: number;
  totalSignal: number;
  delta24: number;
  delta24RankingInput: number;
  delta24Midrank: number;
  relativeGrowth24: number;
  growth24: number;
  delta7: number;
  delta7RankingInput: number;
  delta7Midrank: number;
  relativeGrowth7: number;
  growth7: number;
  pushAgeDays: number;
  pushFreshness: number;
}

function structurallyEligible(candidate: RepositoryCandidate): boolean {
  return candidate.aiEligible && !candidate.fork && !candidate.archived;
}

function isNew(candidate: RepositoryCandidate, now: Date): boolean {
  return ageHours(candidate.createdAt, now) <= 14 * 24;
}

/** Trending 자격 조건(계약 6.1) 중 기준점을 제외한 부분. 자격 필터와 0건 진단이 공유한다. */
function passesTrendingFilters(candidate: RepositoryCandidate, now: Date): boolean {
  return (
    candidate.quality === 'live' &&
    structurallyEligible(candidate) &&
    !isNew(candidate, now) &&
    candidate.totalStars >= 100 &&
    ageHours(candidate.activityAt, now) <= 14 * 24
  );
}

export type RepositoryTrendingEmptyReason = 'no_candidates' | 'warming' | 'filtered';

/** Trending 0건의 사유를 진단한다(계약 10.4, B-003): 관측 없음 / 기준점 워밍업 / 자격 미충족. */
export function repositoryTrendingEmptyReason(
  candidates: readonly RepositoryCandidate[],
  options: RankOptions,
): RepositoryTrendingEmptyReason {
  if (candidates.length === 0) return 'no_candidates';
  const baselineBlocked = candidates.some(
    (candidate) =>
      passesTrendingFilters(candidate, options.now) &&
      (candidate.baseline24 === null || candidate.baseline7 === null),
  );
  return baselineBlocked ? 'warming' : 'filtered';
}

export function rankRepositoryTrending(
  candidates: readonly RepositoryCandidate[],
  options: RankOptions,
): Array<RankedTrend<RepositoryCandidate>> {
  const eligible = candidates.filter(
    (candidate) =>
      passesTrendingFilters(candidate, options.now) &&
      candidate.baseline24 !== null &&
      candidate.baseline7 !== null,
  );
  const starsPercentiles = midrankPercentiles(eligible.map((candidate) => candidate.totalStars));
  const delta24Inputs = eligible.map((candidate) => Math.max(candidate.delta24, 0));
  const delta7Inputs = eligible.map((candidate) => Math.max(candidate.delta7, 0));
  const delta24Percentiles = midrankPercentiles(delta24Inputs);
  const delta7Percentiles = midrankPercentiles(delta7Inputs);

  const ranked = eligible.map((candidate, index): RankedTrend<RepositoryCandidate> => {
    const starsMidrank = starsPercentiles[index] as number;
    const delta24Midrank = delta24Percentiles[index] as number;
    const delta7Midrank = delta7Percentiles[index] as number;
    const delta24Input = delta24Inputs[index] as number;
    const delta7Input = delta7Inputs[index] as number;
    const totalStarsAbsolute = naturalLogNorm(candidate.totalStars, 100_000);
    const totalSignal = 0.5 * starsMidrank + 0.5 * totalStarsAbsolute;
    const relativeGrowth24 = clamp(delta24Input / Math.max(candidate.baseline24 as number, 100));
    const relativeGrowth7 = clamp(delta7Input / Math.max(candidate.baseline7 as number, 100));
    const growth24 = 0.7 * delta24Midrank + 0.3 * relativeGrowth24;
    const growth7 = 0.7 * delta7Midrank + 0.3 * relativeGrowth7;
    const pushAgeDays = ageHours(candidate.activityAt, options.now) / 24;
    const pushFreshness = 0.25 + 0.75 * 2 ** (-pushAgeDays / 7);
    const score = round3(pushFreshness * (0.5 * growth24 + 0.25 * growth7 + 0.25 * totalSignal));
    const signals: RepositorySignals = {
      totalStars: candidate.totalStars,
      totalStarsMidrank: starsMidrank,
      totalStarsAbsolute,
      totalSignal,
      delta24: candidate.delta24,
      delta24RankingInput: delta24Input,
      delta24Midrank,
      relativeGrowth24,
      growth24,
      delta7: candidate.delta7,
      delta7RankingInput: delta7Input,
      delta7Midrank,
      relativeGrowth7,
      growth7,
      pushAgeDays,
      pushFreshness,
    };
    return {
      ...candidate,
      ranking: {
        version: 'v2',
        channel: 'repos',
        sort: 'trending',
        kind: 'repository_trending_v2',
        position: 0,
        score,
        coverage: 'full',
        signals: { ...signals },
        explanation: `24h growth ${candidate.delta24}, 7d growth ${candidate.delta7}, ${candidate.totalStars} total stars`,
      },
    };
  });

  ranked.sort(
    (left, right) =>
      (right.ranking.score as number) - (left.ranking.score as number) ||
      right.delta24 - left.delta24 ||
      right.totalStars - left.totalStars ||
      compareText(left.storyId, right.storyId),
  );
  return ranked.slice(0, normalizedLimit(options.limit, ranked.length)).map((candidate, index) => ({
    ...candidate,
    ranking: { ...candidate.ranking, position: index + 1 },
  }));
}

export function rankRepositoryDiscovery(
  candidates: readonly RepositoryCandidate[],
  options: RankOptions,
): Array<RankedTrend<RepositoryCandidate>> {
  const ranked = candidates
    .filter((candidate) => structurallyEligible(candidate) && isNew(candidate, options.now))
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        right.totalStars - left.totalStars ||
        compareText(left.storyId, right.storyId),
    )
    .slice(0, normalizedLimit(options.limit, candidates.length));

  return ranked.map((candidate, index) => ({
    ...candidate,
    ranking: {
      version: 'v2',
      channel: 'repos',
      sort: 'discovery',
      kind: 'repository_discovery_v2',
      position: index + 1,
      score: null,
      coverage: 'warming',
      signals: {
        createdAt: candidate.createdAt,
        totalStars: candidate.totalStars,
        ageDays: ageHours(candidate.createdAt, options.now) / 24,
      },
      explanation: `Created within 14 days with ${candidate.totalStars} total stars`,
    },
  }));
}
