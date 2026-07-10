import { computeHotness } from '../rank.js';
import type { NewsItem } from '../types.js';
import { compareText, normalizedLimit } from './math.js';
import type { RankOptions, RankedTrend, TrendCandidate } from './types.js';

export interface ResearchCandidate extends TrendCandidate {
  type: 'article' | 'model' | 'paper';
  score: number | null;
}

function isResearchCandidate(candidate: ResearchCandidate): boolean {
  return (
    candidate.type === 'model' ||
    candidate.type === 'paper' ||
    (candidate.type === 'article' && candidate.source !== 'devto')
  );
}

function asLegacyItem(candidate: ResearchCandidate): NewsItem {
  const placeholderUrl = `https://ranking.invalid/${encodeURIComponent(candidate.storyId)}`;
  return {
    id: candidate.storyId,
    source: candidate.source,
    type: candidate.type,
    title: candidate.title,
    url: placeholderUrl,
    canonicalUrl: placeholderUrl,
    summary: candidate.summary,
    author: null,
    score: candidate.score,
    commentsCount: null,
    tags: [],
    publishedAt: candidate.publishedAt,
    firstSeenAt: candidate.publishedAt,
    lastSeenAt: candidate.publishedAt,
    raw: null,
  };
}

export function rankResearchHot(
  candidates: readonly ResearchCandidate[],
  options: RankOptions,
): Array<RankedTrend<ResearchCandidate>> {
  const eligible = candidates.filter(isResearchCandidate);
  const byStory = new Map(eligible.map((candidate) => [candidate.storyId, candidate]));
  const legacyRanked = computeHotness(eligible.map(asLegacyItem), options.now);
  const limit = normalizedLimit(options.limit, legacyRanked.length);
  return legacyRanked.slice(0, limit).map((legacyItem, index) => {
    const candidate = byStory.get(legacyItem.id) as ResearchCandidate;
    return {
      ...candidate,
      ranking: {
        version: 'v2',
        channel: 'research',
        sort: 'hot',
        kind: 'research_hot_v1',
        position: index + 1,
        score: legacyItem.hotness,
        coverage: candidate.score === null ? 'partial' : 'full',
        signals: {
          legacyHotness: legacyItem.hotness,
          currentScore: candidate.score,
        },
        explanation: 'Legacy source percentile and 36-hour exponential decay',
      },
    };
  });
}

export function rankResearchLatest(
  candidates: readonly ResearchCandidate[],
  options: RankOptions,
): Array<RankedTrend<ResearchCandidate>> {
  const sorted = candidates
    .filter(isResearchCandidate)
    .sort(
      (left, right) =>
        Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
        compareText(left.storyId, right.storyId),
    );
  return sorted.slice(0, normalizedLimit(options.limit, sorted.length)).map((candidate, index) => ({
    ...candidate,
    ranking: {
      version: 'v2',
      channel: 'research',
      sort: 'latest',
      kind: 'research_latest_v1',
      position: index + 1,
      score: null,
      coverage: candidate.score === null ? 'partial' : 'full',
      signals: { publishedAt: candidate.publishedAt },
      explanation: 'Newest research item by publication time',
    },
  }));
}
