import type { DB } from '../db/connection.js';
import { findRecentLearning } from '../store/learningStore.js';
import { getItemById } from '../store/itemStore.js';
import { getNearestBaseline } from '../store/sightingStore.js';
import { queryTrendSightings, type TrendSightingRecord } from '../trends/query.js';
import { getTrends } from '../trends/service.js';
import type { NewsItem } from '../types.js';
import { extractTerms } from './topics.js';

export interface EvidenceBuckets {
  official: NewsItem[];
  papers: NewsItem[];
  repos: NewsItem[];
  discussion: NewsItem[];
}

export interface LearningCandidate {
  topic: string;
  normalizedTopic: string;
  learnScore: number;
  signals: { sourceSpread: number; velocity: number; itemCount: number; hotSum: number };
  why: string;
  evidence: EvidenceBuckets;
}

export interface MineOptions {
  sinceDays?: number;
  limit?: number;
  includeLearned?: boolean;
  relearnAfterDays?: number;
  now?: Date;
}

interface StoryEvidence {
  item: NewsItem;
  sightings: TrendSightingRecord[];
  trendScore: number;
  velocity: number;
}

interface Cluster {
  normalized: string;
  display: string;
  stories: StoryEvidence[];
  ids: Set<string>;
}

const COMMUNITY_SOURCES = new Set(['devto', 'hackernews', 'reddit']);

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function timestamp(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sightingReferenceTime(sighting: TrendSightingRecord): number | null {
  return timestamp(
    sighting.type === 'hot_repo'
      ? (sighting.activityAt ?? sighting.publishedAt ?? sighting.firstSeenAt)
      : (sighting.publishedAt ?? sighting.firstSeenAt),
  );
}

function isVelocitySighting(sighting: TrendSightingRecord): boolean {
  if (sighting.quality !== 'live') return false;
  if (sighting.type === 'hot_repo' && sighting.source === 'github') return true;
  return (
    COMMUNITY_SOURCES.has(sighting.source) &&
    (sighting.type === 'community' ||
      (sighting.source === 'devto' && sighting.type === 'article'))
  );
}

/** A Story's velocity is the strongest valid live Community/Repo 24-hour score growth. */
function storyVelocity(db: DB, sightings: readonly TrendSightingRecord[], now: Date): number {
  let maximum: number | null = null;
  for (const sighting of sightings) {
    if (!isVelocitySighting(sighting) || !finiteNumber(sighting.score)) continue;
    const baseline = getNearestBaseline(db, sighting.sightingId, now.toISOString(), '24h');
    if (!finiteNumber(baseline?.score)) continue;
    const growth = (sighting.score - baseline.score) / Math.max(baseline.score, 1);
    maximum = maximum === null ? growth : Math.max(maximum, growth);
  }
  return maximum === null ? 0 : clamp(maximum, 0, 2);
}

function availableStoryScores(
  db: DB,
  sinceHours: number,
  limit: number,
  now: Date,
): Map<string, number> {
  const scores = new Map<string, number>();
  const views = [
    { channel: 'community', sort: 'hot' },
    { channel: 'official', sort: 'important' },
    { channel: 'repos', sort: 'trending' },
    { channel: 'research', sort: 'hot' },
  ] as const;
  for (const view of views) {
    const result = getTrends(
      db,
      {
        rankingVersion: 'v2',
        channel: view.channel,
        sort: view.sort,
        sinceHours,
        limit,
      },
      { now },
    );
    for (const item of result.items) {
      if (
        (item.ranking.coverage !== 'full' && item.ranking.coverage !== 'partial') ||
        !finiteNumber(item.ranking.score)
      ) {
        continue;
      }
      const current = scores.get(item.id);
      if (current === undefined || item.ranking.score > current) {
        scores.set(item.id, item.ranking.score);
      }
    }
  }
  return scores;
}

function recentStoryEvidence(db: DB, sinceDays: number, now: Date): StoryEvidence[] {
  const allSightings = queryTrendSightings(db);
  const cutoff = now.getTime() - sinceDays * 86_400_000;
  const latestRecentTime = new Map<string, number>();
  const recentSightingsByStory = new Map<string, TrendSightingRecord[]>();
  for (const sighting of allSightings) {
    const reference = sightingReferenceTime(sighting);
    if (reference === null || reference < cutoff) continue;
    const current = latestRecentTime.get(sighting.storyId);
    if (current === undefined || reference > current) latestRecentTime.set(sighting.storyId, reference);
    const storySightings = recentSightingsByStory.get(sighting.storyId);
    if (storySightings) storySightings.push(sighting);
    else recentSightingsByStory.set(sighting.storyId, [sighting]);
  }

  const storyIds = [...latestRecentTime]
    .sort(
      ([leftId, leftTime], [rightId, rightTime]) =>
        rightTime - leftTime || leftId.localeCompare(rightId),
    )
    .slice(0, 1000)
    .map(([storyId]) => storyId);

  const sinceHours = Math.max(1, Math.ceil(sinceDays * 24));
  const rankingLimit = Math.max(1, allSightings.length);
  const scores = availableStoryScores(db, sinceHours, rankingLimit, now);
  const evidence: StoryEvidence[] = [];
  for (const storyId of storyIds) {
    const item = getItemById(db, storyId);
    const sightings = recentSightingsByStory.get(storyId) ?? [];
    if (item === null || sightings.length === 0) continue;
    evidence.push({
      item,
      sightings,
      trendScore: scores.get(storyId) ?? 0,
      velocity: storyVelocity(db, sightings, now),
    });
  }
  return evidence;
}

export function bucketEvidence(items: NewsItem[]): EvidenceBuckets {
  const buckets: EvidenceBuckets = { official: [], papers: [], repos: [], discussion: [] };
  for (const it of items) {
    if (it.type === 'official_update') buckets.official.push(it);
    else if (it.type === 'paper') buckets.papers.push(it);
    else if (it.type === 'hot_repo' || it.type === 'model') buckets.repos.push(it);
    else buckets.discussion.push(it);
  }
  return buckets;
}

/** Merge term clusters when at least `threshold` of the smaller Story set overlaps. */
function mergeClusters(clusters: Cluster[], threshold: number): Cluster[] {
  const sorted = [...clusters].sort((a, b) => b.stories.length - a.stories.length);
  const merged: Cluster[] = [];
  for (const cluster of sorted) {
    let absorbed = false;
    for (const target of merged) {
      let overlap = 0;
      for (const id of cluster.ids) if (target.ids.has(id)) overlap += 1;
      const minSize = Math.min(cluster.ids.size, target.ids.size);
      if (minSize > 0 && overlap / minSize >= threshold) {
        for (const story of cluster.stories) {
          if (!target.ids.has(story.item.id)) {
            target.stories.push(story);
            target.ids.add(story.item.id);
          }
        }
        absorbed = true;
        break;
      }
    }
    if (!absorbed) {
      merged.push({
        ...cluster,
        stories: [...cluster.stories],
        ids: new Set(cluster.ids),
      });
    }
  }
  return merged;
}

function compareStoryEvidence(left: StoryEvidence, right: StoryEvidence): number {
  if (left.trendScore !== right.trendScore) return right.trendScore - left.trendScore;
  const byPublished =
    (timestamp(right.item.publishedAt ?? right.item.firstSeenAt) ?? 0) -
    (timestamp(left.item.publishedAt ?? left.item.firstSeenAt) ?? 0);
  return byPublished !== 0 ? byPublished : left.item.id.localeCompare(right.item.id);
}

/**
 * Finds topic clusters worth learning from v2 Story-level ranking evidence.
 * learnScore = novelty × (2×sourceSpread + hotSum + velocity + ln(1+itemCount))
 */
export function mineLearningCandidates(db: DB, opts: MineOptions = {}): LearningCandidate[] {
  const now = opts.now ?? new Date();
  const sinceDays = opts.sinceDays ?? 7;
  const limit = opts.limit ?? 5;
  const includeLearned = opts.includeLearned ?? false;
  const relearnAfterDays = opts.relearnAfterDays ?? 90;

  const stories = recentStoryEvidence(db, sinceDays, now);

  const clusters = new Map<string, Cluster>();
  for (const story of stories) {
    const terms = new Map<string, { normalized: string; display: string }>();
    for (const sighting of story.sightings) {
      for (const term of extractTerms(sighting.title, sighting.tags)) {
        if (!terms.has(term.normalized)) terms.set(term.normalized, term);
      }
    }
    for (const term of terms.values()) {
      let cluster = clusters.get(term.normalized);
      if (!cluster) {
        cluster = {
          normalized: term.normalized,
          display: term.display,
          stories: [],
          ids: new Set(),
        };
        clusters.set(term.normalized, cluster);
      }
      if (!cluster.ids.has(story.item.id)) {
        cluster.stories.push(story);
        cluster.ids.add(story.item.id);
      }
    }
  }

  const merged = mergeClusters([...clusters.values()], 0.6);
  const candidates: LearningCandidate[] = [];
  for (const cluster of merged) {
    const sources = new Set(
      cluster.stories.flatMap((story) => story.sightings.map((sighting) => sighting.source)),
    );
    const sourceSpread = sources.size;
    const itemCount = cluster.stories.length;
    const velocity = round3(
      cluster.stories.reduce((maximum, story) => Math.max(maximum, story.velocity), 0),
    );

    if (!(sourceSpread >= 2 || (itemCount >= 3 && velocity > 0.5))) continue;

    const ordered = [...cluster.stories].sort(compareStoryEvidence);
    const hotSum = round3(
      ordered.slice(0, 5).reduce((sum, story) => sum + story.trendScore, 0),
    );

    const recent = findRecentLearning(db, cluster.normalized);
    let novelty = 1;
    if (recent) {
      const daysSince = (now.getTime() - Date.parse(recent.learnedAt)) / 86_400_000;
      novelty = daysSince <= relearnAfterDays ? 0.15 : 0.5;
    }
    if (!includeLearned && novelty === 0.15) continue;

    const learnScore = round3(
      novelty * (2 * sourceSpread + hotSum + velocity + Math.log(1 + itemCount)),
    );
    const whyParts = [`${sourceSpread}개 소스에서 등장`, `항목 ${itemCount}개`];
    if (velocity > 0.5) whyParts.push('최근 화제 급상승');
    if (novelty < 1) whyParts.push('과거 학습 이력 있음(복습)');

    candidates.push({
      topic: cluster.display,
      normalizedTopic: cluster.normalized,
      learnScore,
      signals: { sourceSpread, velocity, itemCount, hotSum },
      why: whyParts.join(' · '),
      evidence: bucketEvidence(ordered.map((story) => story.item)),
    });
  }

  return candidates.sort((a, b) => b.learnScore - a.learnScore).slice(0, limit);
}
