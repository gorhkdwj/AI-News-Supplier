import { describe, expect, it } from 'vitest';

import {
  rankCommunityHot,
  rankCommunityLatest,
  type CommunityCandidate,
  type CommunityRankOptions,
} from '../../../src/core/ranking/index.js';

const NOW = new Date('2026-07-10T00:00:00.000Z');

function community(
  overrides: Partial<CommunityCandidate> & { storyId: string },
): CommunityCandidate {
  return {
    storyId: overrides.storyId,
    source: overrides.source ?? 'hackernews',
    type: overrides.type ?? 'community',
    title: overrides.title ?? overrides.storyId,
    summary: null,
    publishedAt: overrides.publishedAt ?? NOW.toISOString(),
    score: 'score' in overrides ? (overrides.score ?? null) : 100,
    commentsCount: 'commentsCount' in overrides ? (overrides.commentsCount ?? null) : 20,
    baseline6: 'baseline6' in overrides ? overrides.baseline6 : { score: 80, commentsCount: 15 },
    baseline24: 'baseline24' in overrides ? overrides.baseline24 : { score: 50, commentsCount: 10 },
  };
}

function options(overrides: Partial<CommunityRankOptions> = {}): CommunityRankOptions {
  return { now: NOW, ...overrides };
}

describe('community hot', () => {
  it('is monotonic for score, comments, gains and recency independently', () => {
    const scoreRanked = rankCommunityHot(
      [
        community({ storyId: 'score-low', score: 20 }),
        community({ storyId: 'score-high', score: 200 }),
      ],
      options(),
    );
    expect(scoreRanked[0]!.storyId).toBe('score-high');

    const commentRanked = rankCommunityHot(
      [
        community({ storyId: 'comments-low', commentsCount: 1 }),
        community({ storyId: 'comments-high', commentsCount: 100 }),
      ],
      options(),
    );
    expect(commentRanked[0]!.storyId).toBe('comments-high');

    const gainRanked = rankCommunityHot(
      [
        community({
          storyId: 'gain-low',
          baseline6: { score: 99, commentsCount: 19 },
          baseline24: { score: 99, commentsCount: 19 },
        }),
        community({
          storyId: 'gain-high',
          baseline6: { score: 0, commentsCount: 0 },
          baseline24: { score: 0, commentsCount: 0 },
        }),
      ],
      options(),
    );
    expect(gainRanked[0]!.storyId).toBe('gain-high');

    const recencyRanked = rankCommunityHot(
      [
        community({ storyId: 'old', publishedAt: '2026-07-08T00:00:00.000Z' }),
        community({ storyId: 'new', publishedAt: '2026-07-10T00:00:00.000Z' }),
      ],
      options(),
    );
    expect(recencyRanked[0]!.storyId).toBe('new');
  });

  it('keeps real zero, excludes null score from HOT, and keeps both in Latest', () => {
    const zero = community({
      storyId: 'zero',
      score: 0,
      commentsCount: 0,
      baseline6: { score: 0, commentsCount: 0 },
      baseline24: { score: 0, commentsCount: 0 },
    });
    const unavailable = community({ storyId: 'null', score: null });

    const hot = rankCommunityHot([zero, unavailable], options());
    expect(hot.map((item) => item.storyId)).toEqual(['zero']);
    expect(hot[0]!.ranking.signals.discussionLevel).not.toBeNull();
    expect(rankCommunityLatest([zero, unavailable], options()).map((item) => item.storyId)).toEqual(
      ['null', 'zero'],
    );
  });

  it('reweights missing components at every level and applies partial coverage factor', () => {
    const ranked = rankCommunityHot(
      [
        community({
          storyId: 'partial',
          score: 0,
          commentsCount: null,
          baseline6: undefined,
          baseline24: undefined,
        }),
      ],
      options(),
    );

    // single-candidate score level = .6*.5 + .4*0 = .3; only that component
    // remains, so the outer weighted average is .3 and coverage factor is .9.
    expect(ranked[0]!.ranking.score).toBe(0.27);
    expect(ranked[0]!.ranking.coverage).toBe('warming');
    expect(ranked[0]!.ranking.signals.velocity).toBeNull();
  });

  it('reweights a single available horizon and ties clamped negative gains', () => {
    const ranked = rankCommunityHot(
      [
        community({
          storyId: 'negative-a',
          score: 10,
          baseline6: { score: 100 },
          baseline24: undefined,
        }),
        community({
          storyId: 'negative-b',
          score: 20,
          baseline6: { score: 200 },
          baseline24: undefined,
        }),
      ],
      options(),
    );
    for (const candidate of ranked) {
      expect(candidate.ranking.signals.scoreGain6).toBe(0.35);
      expect(candidate.ranking.signals.velocity).toBe(candidate.ranking.signals.velocity6);
      expect(candidate.ranking.signals.velocity24).toBeNull();
    }
  });

  it('computes percentiles per source and metric', () => {
    const ranked = rankCommunityHot(
      [
        community({ storyId: 'a-only', source: 'hackernews', score: 100 }),
        community({ storyId: 'b-low', source: 'reddit', score: 1 }),
        community({ storyId: 'b-high', source: 'reddit', score: 2 }),
      ],
      options(),
    );
    const a = ranked.find((item) => item.storyId === 'a-only')!;
    const bHigh = ranked.find((item) => item.storyId === 'b-high')!;

    expect(a.ranking.signals.scoreMidrank).toBe(0.5);
    expect(bHigh.ranking.signals.scoreMidrank).toBe(0.75);
  });

  it('switches from fallback floors to nearest-rank P95 at 20 non-null samples', () => {
    const nineteen = Array.from({ length: 19 }, () => 1_000);
    const twenty = Array.from({ length: 20 }, () => 1_000);
    const candidate = community({ storyId: 'sampled', score: 50 });

    const fallback = rankCommunityHot(
      [candidate],
      options({ benchmarks: { hackernews: { scores: nineteen, comments: nineteen } } }),
    )[0]!;
    const sampled = rankCommunityHot(
      [candidate],
      options({ benchmarks: { hackernews: { scores: twenty, comments: twenty } } }),
    )[0]!;

    expect(fallback.ranking.signals.scoreNormalizationCeiling).toBe(100);
    expect(sampled.ranking.signals.scoreNormalizationCeiling).toBe(1_000);
    expect(fallback.ranking.signals.engagementLevel).toBeGreaterThan(
      sampled.ranking.signals.engagementLevel as number,
    );
  });

  it('applies a 40% source target only when alternatives can fill the result', () => {
    const candidates = [
      ...[500, 490, 480, 470, 460].map((score, index) =>
        community({ storyId: `a-${index}`, source: 'hackernews', score }),
      ),
      ...[100, 90].map((score, index) =>
        community({ storyId: `b-${index}`, source: 'reddit', score }),
      ),
      community({ storyId: 'c-0', source: 'devto', type: 'article', score: 10 }),
    ];
    const diverse = rankCommunityHot(candidates, options({ limit: 5 }));
    const counts = new Map<string, number>();
    for (const item of diverse) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);
    expect([...counts.values()].sort()).toEqual([1, 2, 2]);

    const oneSource = rankCommunityHot(
      candidates.filter((candidate) => candidate.source === 'hackernews'),
      options({ limit: 5 }),
    );
    expect(oneSource).toHaveLength(5);
    expect(oneSource.every((item) => item.source === 'hackernews')).toBe(true);
  });

  it('includes the 72-hour boundary, excludes older candidates and breaks ties deterministically', () => {
    const ranked = rankCommunityHot(
      [
        community({ storyId: 'b', publishedAt: '2026-07-07T00:00:00.000Z' }),
        community({ storyId: 'a', publishedAt: '2026-07-07T00:00:00.000Z' }),
        community({ storyId: 'too-old', publishedAt: '2026-07-06T23:59:59.000Z' }),
      ],
      options(),
    );
    expect(ranked.map((item) => item.storyId)).toEqual(['a', 'b']);
  });
});
