import { diversifyBySource } from './diversity.js';
import {
  ageHours,
  clamp,
  compareText,
  midrankPercentiles,
  naturalLogNorm,
  nearestRankPercentile,
  normalizedLimit,
  round3,
  weightedAverage,
} from './math.js';
import type { RankOptions, RankedTrend, RankingCoverage, TrendCandidate } from './types.js';

const COMMUNITY_SOURCES = new Set(['devto', 'hackernews', 'reddit']);

export interface CommunityBaseline {
  score?: number | null;
  commentsCount?: number | null;
}

export interface CommunityCandidate extends TrendCandidate {
  type: 'article' | 'community';
  score: number | null;
  commentsCount: number | null;
  baseline6?: CommunityBaseline;
  baseline24?: CommunityBaseline;
}

export interface CommunityBenchmarkSamples {
  scores: Array<number | null>;
  comments: Array<number | null>;
}

export interface CommunityRankOptions extends RankOptions {
  benchmarks?: Record<string, CommunityBenchmarkSamples>;
  maxAgeHours?: number;
}

type Horizon = '6' | '24';
type Metric = 'score' | 'comments';

interface CandidateSignals {
  scoreMidrank: number;
  scoreNormalizationCeiling: number;
  engagementLevel: number;
  commentsMidrank: number | null;
  commentsNormalizationCeiling: number;
  discussionLevel: number | null;
  scoreDelta6: number | null;
  commentDelta6: number | null;
  scoreGain6: number | null;
  commentGain6: number | null;
  velocity6: number | null;
  scoreDelta24: number | null;
  commentDelta24: number | null;
  scoreGain24: number | null;
  commentGain24: number | null;
  velocity24: number | null;
  velocity: number | null;
  ageHours: number;
  ageDecay: number;
  coverageFactor: number;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCommunityCandidate(candidate: CommunityCandidate): boolean {
  return (
    COMMUNITY_SOURCES.has(candidate.source) &&
    (candidate.type === 'community' ||
      (candidate.source === 'devto' && candidate.type === 'article'))
  );
}

function currentWindow(
  candidates: readonly CommunityCandidate[],
  options: CommunityRankOptions,
): CommunityCandidate[] {
  const maxAgeHours = options.maxAgeHours ?? 72;
  return candidates.filter(
    (candidate) =>
      isCommunityCandidate(candidate) &&
      ageHours(candidate.publishedAt, options.now) <= maxAgeHours,
  );
}

function sourceMidranks(
  candidates: readonly CommunityCandidate[],
  getValue: (candidate: CommunityCandidate) => number | null,
): Map<CommunityCandidate, number | null> {
  const result = new Map<CommunityCandidate, number | null>();
  const groups = new Map<string, CommunityCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.source);
    if (group) group.push(candidate);
    else groups.set(candidate.source, [candidate]);
  }
  for (const group of groups.values()) {
    const values = group.map(getValue);
    const percentiles = midrankPercentiles(values);
    group.forEach((candidate, index) => result.set(candidate, percentiles[index] ?? null));
  }
  return result;
}

function baselineValue(
  candidate: CommunityCandidate,
  horizon: Horizon,
  metric: Metric,
): number | null {
  const baseline = horizon === '6' ? candidate.baseline6 : candidate.baseline24;
  const value = metric === 'score' ? baseline?.score : baseline?.commentsCount;
  return isFiniteNumber(value) ? value : null;
}

function currentValue(candidate: CommunityCandidate, metric: Metric): number | null {
  const value = metric === 'score' ? candidate.score : candidate.commentsCount;
  return isFiniteNumber(value) ? value : null;
}

function deltaValue(
  candidate: CommunityCandidate,
  horizon: Horizon,
  metric: Metric,
): number | null {
  const current = currentValue(candidate, metric);
  const baseline = baselineValue(candidate, horizon, metric);
  return current === null || baseline === null ? null : current - baseline;
}

function normalizationCeiling(
  source: string,
  metric: Metric,
  options: CommunityRankOptions,
): number {
  const floor = metric === 'score' ? 100 : 50;
  const samples =
    metric === 'score'
      ? options.benchmarks?.[source]?.scores
      : options.benchmarks?.[source]?.comments;
  const usable = (samples ?? []).filter(isFiniteNumber);
  if (usable.length < 20) return floor;
  return Math.max(nearestRankPercentile(usable, 0.95) ?? floor, floor);
}

function coverage(candidate: CommunityCandidate, velocity: number | null): RankingCoverage {
  if (!isFiniteNumber(candidate.score)) return 'unavailable';
  const complete =
    isFiniteNumber(candidate.commentsCount) &&
    isFiniteNumber(candidate.baseline6?.score) &&
    isFiniteNumber(candidate.baseline6?.commentsCount) &&
    isFiniteNumber(candidate.baseline24?.score) &&
    isFiniteNumber(candidate.baseline24?.commentsCount);
  if (complete) return 'full';
  return velocity === null ? 'warming' : 'partial';
}

export function rankCommunityHot(
  candidates: readonly CommunityCandidate[],
  options: CommunityRankOptions,
): Array<RankedTrend<CommunityCandidate>> {
  const eligible = currentWindow(candidates, options).filter((candidate) =>
    isFiniteNumber(candidate.score),
  );
  const scoreMidranks = sourceMidranks(eligible, (candidate) => currentValue(candidate, 'score'));
  const commentMidranks = sourceMidranks(eligible, (candidate) =>
    currentValue(candidate, 'comments'),
  );
  const gainMidranks = new Map<string, Map<CommunityCandidate, number | null>>();
  for (const horizon of ['6', '24'] as const) {
    for (const metric of ['score', 'comments'] as const) {
      gainMidranks.set(
        `${metric}:${horizon}`,
        sourceMidranks(eligible, (candidate) => {
          const delta = deltaValue(candidate, horizon, metric);
          return delta === null ? null : Math.max(delta, 0);
        }),
      );
    }
  }

  const ranked = eligible.map((candidate): RankedTrend<CommunityCandidate> => {
    const score = candidate.score as number;
    const scoreMidrank = scoreMidranks.get(candidate) as number;
    const scoreCeiling = normalizationCeiling(candidate.source, 'score', options);
    const engagementLevel = 0.6 * scoreMidrank + 0.4 * naturalLogNorm(score, scoreCeiling);
    const commentsMidrank = commentMidranks.get(candidate) ?? null;
    const commentsCeiling = normalizationCeiling(candidate.source, 'comments', options);
    const discussionLevel =
      isFiniteNumber(candidate.commentsCount) && commentsMidrank !== null
        ? 0.6 * commentsMidrank + 0.4 * naturalLogNorm(candidate.commentsCount, commentsCeiling)
        : null;

    const gains = new Map<string, number | null>();
    const deltas = new Map<string, number | null>();
    for (const horizon of ['6', '24'] as const) {
      for (const metric of ['score', 'comments'] as const) {
        const key = `${metric}:${horizon}`;
        const delta = deltaValue(candidate, horizon, metric);
        deltas.set(key, delta);
        const percentile = gainMidranks.get(key)?.get(candidate) ?? null;
        const baseline = baselineValue(candidate, horizon, metric);
        const relativeFloor = metric === 'score' ? 20 : 10;
        gains.set(
          key,
          delta === null || percentile === null || baseline === null
            ? null
            : 0.7 * percentile +
                0.3 * clamp(Math.max(delta, 0) / Math.max(baseline, relativeFloor)),
        );
      }
    }
    const velocity6 = weightedAverage([
      { value: gains.get('score:6') ?? null, weight: 0.65 },
      { value: gains.get('comments:6') ?? null, weight: 0.35 },
    ]);
    const velocity24 = weightedAverage([
      { value: gains.get('score:24') ?? null, weight: 0.65 },
      { value: gains.get('comments:24') ?? null, weight: 0.35 },
    ]);
    const velocity = weightedAverage([
      { value: velocity6, weight: 0.6 },
      { value: velocity24, weight: 0.4 },
    ]);
    const combined = weightedAverage([
      { value: engagementLevel, weight: 0.45 },
      { value: discussionLevel, weight: 0.25 },
      { value: velocity, weight: 0.3 },
    ]) as number;
    const age = ageHours(candidate.publishedAt, options.now);
    const decay = 2 ** (-age / 48);
    const fullCoverage = coverage(candidate, velocity) === 'full';
    const coverageFactor = fullCoverage ? 1 : 0.9;
    const rankingScore = round3(coverageFactor * decay * combined);
    const signals: CandidateSignals = {
      scoreMidrank,
      scoreNormalizationCeiling: scoreCeiling,
      engagementLevel,
      commentsMidrank,
      commentsNormalizationCeiling: commentsCeiling,
      discussionLevel,
      scoreDelta6: deltas.get('score:6') ?? null,
      commentDelta6: deltas.get('comments:6') ?? null,
      scoreGain6: gains.get('score:6') ?? null,
      commentGain6: gains.get('comments:6') ?? null,
      velocity6,
      scoreDelta24: deltas.get('score:24') ?? null,
      commentDelta24: deltas.get('comments:24') ?? null,
      scoreGain24: gains.get('score:24') ?? null,
      commentGain24: gains.get('comments:24') ?? null,
      velocity24,
      velocity,
      ageHours: age,
      ageDecay: decay,
      coverageFactor,
    };
    return {
      ...candidate,
      ranking: {
        version: 'v2',
        channel: 'community',
        sort: 'hot',
        kind: 'community_hot_v2',
        position: 0,
        score: rankingScore,
        coverage: coverage(candidate, velocity),
        signals: { ...signals },
        explanation: `Engagement, discussion and 6h/24h velocity from ${candidate.source}`,
      },
    };
  });
  ranked.sort(
    (left, right) =>
      (right.ranking.score as number) - (left.ranking.score as number) ||
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
      compareText(left.storyId, right.storyId),
  );
  return diversifyBySource(ranked, options.limit).map((candidate, index) => ({
    ...candidate,
    ranking: { ...candidate.ranking, position: index + 1 },
  }));
}

export function rankCommunityLatest(
  candidates: readonly CommunityCandidate[],
  options: CommunityRankOptions,
): Array<RankedTrend<CommunityCandidate>> {
  return currentWindow(candidates, options)
    .sort(
      (left, right) =>
        Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
        compareText(left.storyId, right.storyId),
    )
    .slice(0, normalizedLimit(options.limit, candidates.length))
    .map((candidate, index) => ({
      ...candidate,
      ranking: {
        version: 'v2',
        channel: 'community',
        sort: 'latest',
        kind: 'community_latest_v2',
        position: index + 1,
        score: null,
        coverage: coverage(candidate, null),
        signals: {
          currentScore: candidate.score,
          currentComments: candidate.commentsCount,
        },
        explanation: 'Newest community item by publication time',
      },
    }));
}
