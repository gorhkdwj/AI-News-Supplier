import { computeHotness, interleaveBySource } from '../rank.js';
import {
  composeOverview,
  diversifyBySource,
  rankCommunityHot,
  rankCommunityLatest,
  rankOfficialImportant,
  rankOfficialLatest,
  rankRepositoryDiscovery,
  rankRepositoryTrending,
  rankResearchHot,
  rankResearchLatest,
  type CommunityBenchmarkSamples,
  type CommunityCandidate,
  type OfficialCandidate,
  type RankedTrend,
  type RankingCoverage,
  type RepositoryCandidate,
  type ResearchCandidate,
} from '../ranking/index.js';
import { getItemById, getScoreHistory } from '../store/itemStore.js';
import { getSightingsByStory } from '../store/sightingStore.js';
import type { DB } from '../db/connection.js';
import type { MetricSnapshot, NewsItem, PublishedPrecision, SourceSighting } from '../types.js';
import {
  queryAllMetricSnapshots,
  queryLegacyTrendItems,
  queryTrendSightings,
  type TrendSightingRecord,
} from './query.js';
import {
  resolveTrendRequest,
  type ResolvedTrendRequest,
  type TrendChannel,
  type TrendRequestInput,
  type TrendSort,
} from './request.js';

export type TrendRankingKind =
  | 'legacy_hotness_v1'
  | 'community_hot_v2'
  | 'community_latest_v2'
  | 'official_important_v2'
  | 'official_latest_v2'
  | 'repository_discovery_v2'
  | 'repository_trending_v2'
  | 'research_hot_v1'
  | 'research_latest_v1';

export interface TrendRankingMetadata {
  version: 'legacy' | 'v2';
  channel: TrendChannel;
  sort: TrendSort;
  kind: TrendRankingKind;
  position: number;
  score: number | null;
  coverage: RankingCoverage;
  signals: Record<string, unknown>;
  explanation: string;
}

export interface TrendResultItem extends NewsItem {
  sightingId: string | null;
  scoreKind: string | null;
  discussionUrl: string | null;
  activityAt: string | null;
  publishedPrecision: PublishedPrecision | null;
  ranking: TrendRankingMetadata;
  hotness: number | null;
}

export interface TrendSection {
  channel: TrendChannel;
  sort: TrendSort;
  items: TrendResultItem[];
}

export interface TrendResult {
  rankingVersion: 'legacy' | 'v2';
  sections: TrendSection[];
  items: TrendResultItem[];
}

export interface TrendServiceOptions {
  now?: Date;
  maxPerSourceRatio?: number;
}

export type TrendItemDetailResult =
  | { found: false }
  | {
      found: true;
      item: NewsItem;
      scoreHistory: Array<{ observedAt: string; score: number | null }>;
      sightings: SourceSighting[];
    };

const DEFAULT_HOURS: Record<Exclude<TrendChannel, 'overview'>, number> = {
  community: 72,
  official: 720,
  repos: 336,
  research: 72,
};

const BASELINE_WINDOWS = {
  '6h': { ageMs: 6 * 3_600_000, toleranceMs: 2 * 3_600_000 },
  '24h': { ageMs: 24 * 3_600_000, toleranceMs: 4 * 3_600_000 },
  '7d': { ageMs: 7 * 86_400_000, toleranceMs: 12 * 3_600_000 },
} as const;

type BaselineHorizon = keyof typeof BASELINE_WINDOWS;

interface RankingContext {
  now: Date;
  request: ResolvedTrendRequest;
  rows: TrendSightingRecord[];
  recordsBySighting: Map<string, TrendSightingRecord>;
  snapshotsBySighting: Map<string, MetricSnapshot[]>;
  benchmarks: Record<string, CommunityBenchmarkSamples>;
}

function timestamp(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function withinHours(value: string | null, now: Date, hours: number): boolean {
  const parsed = timestamp(value);
  if (parsed === null) return false;
  return Math.max(0, now.getTime() - parsed) <= hours * 3_600_000;
}

function isChannelRow(
  row: TrendSightingRecord,
  channel: Exclude<TrendChannel, 'overview'>,
): boolean {
  switch (channel) {
    case 'community':
      return row.type === 'community' || (row.type === 'article' && row.source === 'devto');
    case 'official':
      return row.type === 'official_update';
    case 'repos':
      return row.type === 'hot_repo';
    case 'research':
      return (
        row.type === 'model' ||
        row.type === 'paper' ||
        (row.type === 'article' && row.source !== 'devto')
      );
  }
}

function filteredRows(
  context: RankingContext,
  channel: Exclude<TrendChannel, 'overview'>,
  sort: TrendSort,
  applyRequestFilters = true,
): TrendSightingRecord[] {
  const { request, now } = context;
  const hours = request.sinceHours ?? DEFAULT_HOURS[channel];
  return context.rows.filter((row) => {
    if (!isChannelRow(row, channel)) return false;
    if (
      applyRequestFilters &&
      request.sources !== undefined &&
      !request.sources.includes(row.source)
    ) {
      return false;
    }
    if (applyRequestFilters && request.types !== undefined && !request.types.includes(row.type)) {
      return false;
    }
    if (channel === 'community' && sort === 'hot' && row.quality !== 'live') return false;
    const reference =
      channel === 'repos'
        ? sort === 'discovery'
          ? (row.publishedAt ?? row.firstSeenAt)
          : row.activityAt
        : (row.publishedAt ?? row.firstSeenAt);
    return withinHours(reference, now, hours);
  });
}

function groupSnapshots(snapshots: MetricSnapshot[]): Map<string, MetricSnapshot[]> {
  const grouped = new Map<string, MetricSnapshot[]>();
  for (const snapshot of snapshots) {
    const existing = grouped.get(snapshot.sightingId);
    if (existing) existing.push(snapshot);
    else grouped.set(snapshot.sightingId, [snapshot]);
  }
  return grouped;
}

function nearestBaseline(
  context: RankingContext,
  sightingId: string,
  horizon: BaselineHorizon,
): MetricSnapshot | null {
  const window = BASELINE_WINDOWS[horizon];
  const target = context.now.getTime() - window.ageMs;
  const candidates = (context.snapshotsBySighting.get(sightingId) ?? [])
    .map((snapshot) => ({ snapshot, time: timestamp(snapshot.observedAt) }))
    .filter(
      (candidate): candidate is { snapshot: MetricSnapshot; time: number } =>
        candidate.time !== null && Math.abs(candidate.time - target) <= window.toleranceMs,
    )
    .sort((left, right) => {
      const byDistance = Math.abs(left.time - target) - Math.abs(right.time - target);
      return byDistance !== 0 ? byDistance : left.time - right.time;
    });
  return candidates[0]?.snapshot ?? null;
}

function buildBenchmarks(
  rows: readonly TrendSightingRecord[],
  now: Date,
): Record<string, CommunityBenchmarkSamples> {
  const cutoff = now.getTime() - 30 * 86_400_000;
  const result: Record<string, CommunityBenchmarkSamples> = {};
  for (const row of rows) {
    if (row.quality !== 'live' || !isChannelRow(row, 'community')) continue;
    const lastSeen = timestamp(row.lastSeenAt);
    if (lastSeen === null || lastSeen < cutoff) continue;
    const samples = (result[row.source] ??= { scores: [], comments: [] });
    samples.scores.push(row.score);
    samples.comments.push(row.commentsCount);
  }
  return result;
}

function communityCandidates(
  context: RankingContext,
  sort: 'hot' | 'latest',
  applyRequestFilters = true,
): CommunityCandidate[] {
  return filteredRows(context, 'community', sort, applyRequestFilters).map((row) => {
    const baseline6 = nearestBaseline(context, row.sightingId, '6h');
    const baseline24 = nearestBaseline(context, row.sightingId, '24h');
    return {
      storyId: row.storyId,
      sightingId: row.sightingId,
      source: row.source,
      type: row.type as 'article' | 'community',
      title: row.title,
      summary: row.summary,
      publishedAt: row.publishedAt ?? row.firstSeenAt,
      score: row.score,
      commentsCount: row.commentsCount,
      ...(baseline6 === null
        ? {}
        : { baseline6: { score: baseline6.score, commentsCount: baseline6.commentsCount } }),
      ...(baseline24 === null
        ? {}
        : { baseline24: { score: baseline24.score, commentsCount: baseline24.commentsCount } }),
    };
  });
}

function repositoryCandidates(
  context: RankingContext,
  sort: 'trending' | 'discovery',
): RepositoryCandidate[] {
  return filteredRows(context, 'repos', sort).map((row) => {
    const baseline24 = nearestBaseline(context, row.sightingId, '24h');
    const baseline7 = nearestBaseline(context, row.sightingId, '7d');
    const totalStars = row.score ?? 0;
    return {
      storyId: row.storyId,
      sightingId: row.sightingId,
      source: row.source,
      type: 'hot_repo',
      title: row.title,
      summary: row.summary,
      publishedAt: row.publishedAt ?? row.firstSeenAt,
      activityAt: row.activityAt ?? '1970-01-01T00:00:00.000Z',
      createdAt: row.publishedAt ?? row.firstSeenAt,
      totalStars,
      delta24:
        baseline24?.score === null || baseline24 === null ? 0 : totalStars - baseline24.score,
      baseline24: baseline24?.score ?? null,
      delta7: baseline7?.score === null || baseline7 === null ? 0 : totalStars - baseline7.score,
      baseline7: baseline7?.score ?? null,
      quality: row.quality,
      // The GitHub collector admits only deterministic AI matches that are neither forks nor archived.
      aiEligible: row.source === 'github',
      fork: false,
      archived: false,
    };
  });
}

function officialCandidates(context: RankingContext): OfficialCandidate[] {
  return filteredRows(context, 'official', context.request.sort).map((row) => ({
    storyId: row.storyId,
    sightingId: row.sightingId,
    source: row.source,
    type: 'official_update',
    title: row.title,
    summary: row.summary,
    publishedAt: row.publishedAt ?? row.firstSeenAt,
  }));
}

function researchCandidates(context: RankingContext, sort: 'hot' | 'latest'): ResearchCandidate[] {
  return filteredRows(context, 'research', sort).map((row) => ({
    storyId: row.storyId,
    sightingId: row.sightingId,
    source: row.source,
    type: row.type as 'article' | 'model' | 'paper',
    title: row.title,
    summary: row.summary,
    publishedAt: row.publishedAt ?? row.firstSeenAt,
    score: row.score,
  }));
}

interface AlternateSightingSignal {
  channel: Exclude<TrendChannel, 'overview'>;
  source: string;
  sightingId?: string;
  kind: string;
  score: number | null;
  signals: Record<string, unknown>;
}

function deduplicateRanked(
  ranked: readonly RankedTrend[],
  channel: Exclude<TrendChannel, 'overview'>,
  limit?: number,
  diversify = false,
): RankedTrend[] {
  const selected: RankedTrend[] = [];
  const byStory = new Map<
    string,
    { candidate: RankedTrend; alternates: AlternateSightingSignal[] }
  >();
  for (const candidate of ranked) {
    const current = byStory.get(candidate.storyId);
    if (current === undefined) {
      const entry = { candidate, alternates: [] as AlternateSightingSignal[] };
      byStory.set(candidate.storyId, entry);
      selected.push(candidate);
      continue;
    }
    current.alternates.push({
      channel,
      source: candidate.source,
      ...(candidate.sightingId === undefined ? {} : { sightingId: candidate.sightingId }),
      kind: candidate.ranking.kind,
      score: candidate.ranking.score,
      signals: candidate.ranking.signals,
    });
  }

  const withAlternates = selected.map((candidate) => {
    const alternates = byStory.get(candidate.storyId)?.alternates ?? [];
    if (alternates.length === 0) return candidate;
    return {
      ...candidate,
      ranking: {
        ...candidate.ranking,
        signals: { ...candidate.ranking.signals, alternate_sightings: alternates },
      },
    };
  });
  const limited = diversify
    ? diversifyBySource(withAlternates, limit)
    : withAlternates.slice(0, limit ?? withAlternates.length);
  return limited.map((candidate, index) => ({
    ...candidate,
    ranking: { ...candidate.ranking, position: index + 1 },
  }));
}

function unfilteredCommunityScores(context: RankingContext): Record<string, Array<number | null>> {
  const candidates = communityCandidates(context, 'hot', false);
  const ranked = deduplicateRanked(
    rankCommunityHot(candidates, {
      now: context.now,
      benchmarks: context.benchmarks,
      maxAgeHours: context.request.sinceHours ?? DEFAULT_HOURS.community,
    }),
    'community',
  );
  const scores: Record<string, Array<number | null>> = {};
  for (const candidate of ranked) {
    (scores[candidate.storyId] ??= []).push(candidate.ranking.score);
  }
  return scores;
}

function rankChannel(
  context: RankingContext,
  channel: Exclude<TrendChannel, 'overview'>,
  sort: TrendSort,
  limit?: number,
): RankedTrend[] {
  switch (channel) {
    case 'community': {
      const communitySort = sort as 'hot' | 'latest';
      const candidates = communityCandidates(context, communitySort);
      const ranked =
        communitySort === 'hot'
          ? rankCommunityHot(candidates, {
              now: context.now,
              benchmarks: context.benchmarks,
              maxAgeHours: context.request.sinceHours ?? DEFAULT_HOURS.community,
            })
          : rankCommunityLatest(candidates, {
              now: context.now,
              maxAgeHours: context.request.sinceHours ?? DEFAULT_HOURS.community,
            });
      return deduplicateRanked(ranked, channel, limit, communitySort === 'hot');
    }
    case 'official': {
      const candidates = officialCandidates(context);
      const ranked =
        sort === 'important'
          ? rankOfficialImportant(candidates, {
              now: context.now,
              communityScores: unfilteredCommunityScores(context),
            })
          : rankOfficialLatest(candidates, { now: context.now });
      return deduplicateRanked(ranked, channel, limit, sort === 'important');
    }
    case 'repos': {
      const repoSort = sort as 'trending' | 'discovery';
      const candidates = repositoryCandidates(context, repoSort);
      const ranked =
        repoSort === 'trending'
          ? rankRepositoryTrending(candidates, { now: context.now })
          : rankRepositoryDiscovery(candidates, { now: context.now });
      return deduplicateRanked(ranked, channel, limit);
    }
    case 'research': {
      const researchSort = sort as 'hot' | 'latest';
      const candidates = researchCandidates(context, researchSort);
      const ranked =
        researchSort === 'hot'
          ? rankResearchHot(candidates, { now: context.now })
          : rankResearchLatest(candidates, { now: context.now });
      return deduplicateRanked(ranked, channel, limit);
    }
  }
}

function rankedToResultItem(candidate: RankedTrend, context: RankingContext): TrendResultItem {
  const row =
    candidate.sightingId === undefined
      ? undefined
      : context.recordsBySighting.get(candidate.sightingId);
  if (row === undefined) {
    throw new Error(`Ranked Sighting not found: ${candidate.sightingId ?? candidate.storyId}`);
  }
  const ranking: TrendRankingMetadata = {
    version: 'v2',
    channel: candidate.ranking.channel,
    sort: candidate.ranking.sort,
    kind: candidate.ranking.kind,
    position: candidate.ranking.position,
    score: candidate.ranking.score,
    coverage: candidate.ranking.coverage,
    signals: candidate.ranking.signals,
    explanation: candidate.ranking.explanation,
  };
  return {
    id: row.storyId,
    source: row.source,
    type: row.type,
    title: row.title,
    url: row.sourceUrl,
    canonicalUrl: row.canonicalUrl,
    summary: row.summary,
    author: row.author,
    score: row.score,
    commentsCount: row.commentsCount,
    tags: row.tags,
    publishedAt: row.publishedAt,
    firstSeenAt: row.storyFirstSeenAt,
    lastSeenAt: row.storyLastSeenAt,
    raw: null,
    sightingId: row.sightingId,
    scoreKind: row.scoreKind,
    discussionUrl: row.discussionUrl,
    activityAt: row.activityAt,
    publishedPrecision: row.publishedPrecision,
    ranking,
    hotness: ranking.score,
  };
}

function legacyResult(
  db: DB,
  request: ResolvedTrendRequest,
  now: Date,
  maxPerSourceRatio: number,
): TrendResult {
  const hours = request.sinceHours ?? 72;
  const items = queryLegacyTrendItems(db, {
    sinceIso: new Date(now.getTime() - hours * 3_600_000).toISOString(),
    sources: request.sources,
    types: request.types,
  });
  const ranked = interleaveBySource(computeHotness(items, now), request.limit, maxPerSourceRatio);
  const primaryByStory = new Map(
    queryTrendSightings(db)
      .filter((sighting) => sighting.isPrimary)
      .map((sighting) => [sighting.storyId, sighting]),
  );
  const resultItems = ranked.map((item, index): TrendResultItem => {
    const primary = primaryByStory.get(item.id);
    return {
      ...item,
      sightingId: primary?.sightingId ?? null,
      scoreKind: primary?.scoreKind ?? null,
      discussionUrl: primary?.discussionUrl ?? null,
      activityAt: primary?.activityAt ?? null,
      publishedPrecision: primary?.publishedPrecision ?? null,
      ranking: {
        version: 'legacy',
        channel: 'overview',
        sort: 'briefing',
        kind: 'legacy_hotness_v1',
        position: index + 1,
        score: item.hotness,
        coverage: item.score === null ? 'partial' : 'full',
        signals: { legacyHotness: item.hotness },
        explanation: 'Legacy source percentile, time decay and type boost',
      },
      hotness: item.hotness,
    };
  });
  const section: TrendSection = { channel: 'overview', sort: 'briefing', items: resultItems };
  return { rankingVersion: 'legacy', sections: [section], items: resultItems };
}

export function getTrends(
  db: DB,
  input: TrendRequestInput,
  options: TrendServiceOptions = {},
): TrendResult {
  const request = resolveTrendRequest(input);
  const now = options.now ?? new Date();
  if (request.rankingVersion === 'legacy') {
    return legacyResult(db, request, now, options.maxPerSourceRatio ?? 0.4);
  }

  const rows = queryTrendSightings(db);
  const context: RankingContext = {
    now,
    request,
    rows,
    recordsBySighting: new Map(rows.map((row) => [row.sightingId, row])),
    snapshotsBySighting: groupSnapshots(queryAllMetricSnapshots(db)),
    benchmarks: buildBenchmarks(rows, now),
  };

  if (request.channel !== 'overview') {
    const ranked = rankChannel(context, request.channel, request.sort, request.limit);
    const items = ranked.map((candidate) => rankedToResultItem(candidate, context));
    return {
      rankingVersion: 'v2',
      sections: [{ channel: request.channel, sort: request.sort, items }],
      items,
    };
  }

  const overview = composeOverview(
    {
      official: rankChannel(context, 'official', 'important'),
      repos: rankChannel(context, 'repos', 'trending'),
      community: rankChannel(context, 'community', 'hot'),
      research: rankChannel(context, 'research', 'hot'),
    },
    request.limit,
  );
  const sectionSorts: Record<Exclude<TrendChannel, 'overview'>, TrendSort> = {
    official: 'important',
    repos: 'trending',
    community: 'hot',
    research: 'hot',
  };
  const sections: TrendSection[] = overview.sections.map((section) => ({
    channel: section.channel,
    sort: sectionSorts[section.channel],
    items: section.items.map((candidate) => rankedToResultItem(candidate, context)),
  }));
  return { rankingVersion: 'v2', sections, items: sections.flatMap((section) => section.items) };
}

export function getTrendItemDetail(db: DB, id: string): TrendItemDetailResult {
  const item = getItemById(db, id);
  if (item === null) return { found: false };
  const sightings = getSightingsByStory(db, id).sort(
    (left, right) =>
      Number(right.isPrimary) - Number(left.isPrimary) ||
      compareText(left.source, right.source) ||
      compareText(left.sourceKey, right.sourceKey) ||
      compareText(left.id, right.id),
  );
  return {
    found: true,
    item,
    scoreHistory: getScoreHistory(db, id),
    sightings,
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
