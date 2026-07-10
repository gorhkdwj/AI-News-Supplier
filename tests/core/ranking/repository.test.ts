import { describe, expect, it } from 'vitest';

import {
  rankRepositoryDiscovery,
  rankRepositoryTrending,
  type RepositoryCandidate,
} from '../../../src/core/ranking/index.js';

const NOW = new Date('2026-07-10T00:00:00.000Z');

function repo(overrides: Partial<RepositoryCandidate> & { storyId: string }): RepositoryCandidate {
  return {
    storyId: overrides.storyId,
    source: 'github',
    type: 'hot_repo',
    title: overrides.title ?? overrides.storyId,
    summary: null,
    publishedAt: overrides.publishedAt ?? '2026-01-01T00:00:00.000Z',
    activityAt: overrides.activityAt ?? NOW.toISOString(),
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    totalStars: overrides.totalStars ?? 1_000,
    delta24: overrides.delta24 ?? 100,
    baseline24: 'baseline24' in overrides ? (overrides.baseline24 ?? null) : 900,
    delta7: overrides.delta7 ?? 200,
    baseline7: 'baseline7' in overrides ? (overrides.baseline7 ?? null) : 800,
    quality: overrides.quality ?? 'live',
    aiEligible: overrides.aiEligible ?? true,
    fork: overrides.fork ?? false,
    archived: overrides.archived ?? false,
  };
}

describe('repository trending', () => {
  it('ranks strong recent growth above a huge repository with weak growth', () => {
    const ranked = rankRepositoryTrending(
      [
        repo({
          storyId: 'huge',
          totalStars: 100_000,
          delta24: 10,
          baseline24: 99_990,
          delta7: 40,
          baseline7: 99_960,
        }),
        repo({
          storyId: 'growing',
          totalStars: 5_000,
          delta24: 500,
          baseline24: 4_500,
          delta7: 1_000,
          baseline7: 4_000,
        }),
      ],
      { now: NOW },
    );

    expect(ranked.map((item) => item.storyId)).toEqual(['growing', 'huge']);
    expect(ranked[0]!.ranking.score).toBeGreaterThan(ranked[1]!.ranking.score!);
  });

  it('keeps new low-star repositories in Discovery and out of Trending', () => {
    const fresh = repo({
      storyId: 'fresh-10',
      totalStars: 10,
      createdAt: '2026-07-09T00:00:00.000Z',
      baseline24: null,
      baseline7: null,
    });
    const freshEstablished = repo({
      storyId: 'fresh-1000',
      totalStars: 1_000,
      createdAt: '2026-07-09T00:00:00.000Z',
    });

    expect(rankRepositoryTrending([fresh, freshEstablished], { now: NOW })).toEqual([]);
    const discovery = rankRepositoryDiscovery([fresh, freshEstablished], { now: NOW });
    expect(discovery.map((item) => item.storyId)).toEqual(['fresh-1000', 'fresh-10']);
    expect(discovery.every((item) => item.ranking.score === null)).toBe(true);
    expect(discovery.every((item) => item.ranking.coverage === 'warming')).toBe(true);
  });

  it('requires live quality, eligibility, star floor, baselines and recent activity', () => {
    const candidates = [
      repo({ storyId: 'eligible' }),
      repo({ storyId: 'legacy', quality: 'legacy_unverified' }),
      repo({ storyId: 'not-ai', aiEligible: false }),
      repo({ storyId: 'fork', fork: true }),
      repo({ storyId: 'archived', archived: true }),
      repo({ storyId: 'few-stars', totalStars: 99 }),
      repo({ storyId: 'missing-24h', baseline24: null }),
      repo({ storyId: 'missing-7d', baseline7: null }),
      repo({ storyId: 'stale', activityAt: '2026-06-25T23:59:59.000Z' }),
    ];

    expect(rankRepositoryTrending(candidates, { now: NOW }).map((item) => item.storyId)).toEqual([
      'eligible',
    ]);
  });

  it('includes the activity boundary and keeps the 14-day creation boundary in Discovery only', () => {
    const activityBoundary = repo({
      storyId: 'activity-boundary',
      activityAt: '2026-06-26T00:00:00.000Z',
    });
    const creationBoundary = repo({
      storyId: 'creation-boundary',
      createdAt: '2026-06-26T00:00:00.000Z',
    });

    expect(
      rankRepositoryTrending([activityBoundary, creationBoundary], { now: NOW }).map(
        (item) => item.storyId,
      ),
    ).toEqual(['activity-boundary']);
    expect(
      rankRepositoryDiscovery([creationBoundary], { now: NOW }).map((item) => item.storyId),
    ).toEqual(['creation-boundary']);
  });

  it('exposes negative raw deltas while clamping only their score inputs', () => {
    const ranked = rankRepositoryTrending(
      [
        repo({ storyId: 'negative', delta24: -10, baseline24: 1_010 }),
        repo({ storyId: 'zero', delta24: 0, baseline24: 1_000 }),
      ],
      { now: NOW },
    );
    const negative = ranked.find((item) => item.storyId === 'negative')!;

    expect(negative.ranking.signals.delta24).toBe(-10);
    expect(negative.ranking.signals.delta24RankingInput).toBe(0);
  });

  it('uses the documented formula and deterministic tie breakers', () => {
    const single = rankRepositoryTrending(
      [repo({ storyId: 'only', totalStars: 100, delta24: 0, delta7: 0 })],
      { now: NOW },
    );
    const expectedT = 0.5 * 0.5 + 0.5 * (Math.log(101) / Math.log(100_001));
    const expected = Math.round((0.5 * 0.35 + 0.25 * 0.35 + 0.25 * expectedT) * 1_000) / 1_000;
    expect(single[0]!.ranking.score).toBe(expected);

    const tied = rankRepositoryTrending([repo({ storyId: 'b' }), repo({ storyId: 'a' })], {
      now: NOW,
    });
    expect(tied.map((item) => item.storyId)).toEqual(['a', 'b']);
  });
});
