import { describe, expect, it } from 'vitest';

import { computeHotness } from '../../../src/core/rank.js';
import {
  rankResearchHot,
  rankResearchLatest,
  type ResearchCandidate,
} from '../../../src/core/ranking/index.js';
import type { NewsItem } from '../../../src/core/types.js';

const NOW = new Date('2026-07-10T00:00:00.000Z');

function research(overrides: Partial<ResearchCandidate> & { storyId: string }): ResearchCandidate {
  return {
    storyId: overrides.storyId,
    source: overrides.source ?? 'arxiv',
    type: overrides.type ?? 'paper',
    title: overrides.title ?? overrides.storyId,
    summary: null,
    publishedAt: overrides.publishedAt ?? NOW.toISOString(),
    score: 'score' in overrides ? (overrides.score ?? null) : 10,
  };
}

function legacy(candidate: ResearchCandidate): NewsItem {
  return {
    id: candidate.storyId,
    source: candidate.source,
    type: candidate.type,
    title: candidate.title,
    url: `https://example.com/${candidate.storyId}`,
    canonicalUrl: `https://example.com/${candidate.storyId}`,
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

describe('research ranking', () => {
  it('matches existing research_hot_v1 values and order exactly', () => {
    const candidates = [
      research({ storyId: 'low', score: 10, publishedAt: '2026-07-09T12:00:00.000Z' }),
      research({ storyId: 'high', score: 30, publishedAt: '2026-07-09T12:00:00.000Z' }),
      research({ storyId: 'null', source: 'huggingface', type: 'model', score: null }),
    ];
    const expected = computeHotness(candidates.map(legacy), NOW);
    const actual = rankResearchHot(candidates, { now: NOW });

    expect(actual.map((item) => item.storyId)).toEqual(expected.map((item) => item.id));
    expect(actual.map((item) => item.ranking.score)).toEqual(expected.map((item) => item.hotness));
  });

  it('keeps DEV articles in Community rather than Research', () => {
    const candidates = [
      research({ storyId: 'paper' }),
      research({ storyId: 'article', type: 'article', source: 'rss:blog' }),
      research({ storyId: 'dev', type: 'article', source: 'devto' }),
    ];
    expect(rankResearchHot(candidates, { now: NOW }).map((item) => item.storyId)).not.toContain(
      'dev',
    );
    expect(rankResearchLatest(candidates, { now: NOW }).map((item) => item.storyId)).toEqual([
      'article',
      'paper',
    ]);
  });

  it('makes Latest scoreless and orders by publication time then Story ID', () => {
    const latest = rankResearchLatest(
      [
        research({ storyId: 'old', publishedAt: '2026-07-09T00:00:00.000Z' }),
        research({ storyId: 'b' }),
        research({ storyId: 'a' }),
      ],
      { now: NOW },
    );
    expect(latest.map((item) => item.storyId)).toEqual(['a', 'b', 'old']);
    expect(latest.every((item) => item.ranking.score === null)).toBe(true);
  });
});
