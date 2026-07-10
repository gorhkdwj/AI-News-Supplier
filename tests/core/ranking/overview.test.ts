import { describe, expect, it } from 'vitest';

import {
  composeOverview,
  type RankedTrend,
  type RankingChannel,
  type RankingKind,
  type RankingSort,
  type TrendCandidate,
} from '../../../src/core/ranking/index.js';

const CHANNEL_META: Record<RankingChannel, { kind: RankingKind; sort: RankingSort; type: string }> =
  {
    official: { kind: 'official_important_v2', sort: 'important', type: 'official_update' },
    repos: { kind: 'repository_trending_v2', sort: 'trending', type: 'hot_repo' },
    community: { kind: 'community_hot_v2', sort: 'hot', type: 'community' },
    research: { kind: 'research_hot_v1', sort: 'hot', type: 'paper' },
  };

function item(
  storyId: string,
  channel: RankingChannel,
  source: string = channel,
  score = 0.5,
): RankedTrend<TrendCandidate> {
  const meta = CHANNEL_META[channel];
  return {
    storyId,
    sightingId: `${source}:${storyId}`,
    source,
    type: meta.type,
    title: storyId,
    summary: null,
    publishedAt: '2026-07-10T00:00:00.000Z',
    ranking: {
      version: 'v2',
      channel,
      sort: meta.sort,
      kind: meta.kind,
      position: 1,
      score,
      coverage: 'full',
      signals: { original: `${channel}:${storyId}` },
      explanation: storyId,
    },
  };
}

describe('Overview composer', () => {
  const fullInput = {
    official: [item('o1', 'official')],
    repos: [item('p1', 'repos')],
    community: [item('c1', 'community')],
    research: [item('r1', 'research')],
  };

  it('handles limits 0, 1 and 3 with remainder in channel priority order', () => {
    const zero = composeOverview(fullInput, 0);
    expect(zero.sections.map((section) => section.items.length)).toEqual([0, 0, 0, 0]);
    expect(zero.items).toEqual([]);

    expect(composeOverview(fullInput, 1).items.map((entry) => entry.storyId)).toEqual(['o1']);
    expect(composeOverview(fullInput, 3).items.map((entry) => entry.storyId)).toEqual([
      'o1',
      'p1',
      'c1',
    ]);
  });

  it('redistributes section deficits one item at a time in the same priority order', () => {
    const result = composeOverview(
      {
        official: [],
        repos: [item('p1', 'repos')],
        community: ['c1', 'c2', 'c3', 'c4'].map((id) => item(id, 'community')),
        research: ['r1', 'r2', 'r3', 'r4'].map((id) => item(id, 'research')),
      },
      8,
    );

    expect(result.sections.map((section) => section.items.length)).toEqual([0, 1, 4, 3]);
    expect(result.items).toHaveLength(8);
  });

  it('deduplicates globally by channel priority and preserves deterministic also_seen signals', () => {
    const officialDuplicate = item('duplicate', 'official', 'rss:z', 0.7);
    const communityDuplicate = item('duplicate', 'community', 'reddit', 0.9);
    const result = composeOverview(
      {
        official: [item('o1', 'official'), officialDuplicate],
        repos: [item('duplicate', 'repos', 'github', 0.8), item('p1', 'repos')],
        community: [communityDuplicate, item('c1', 'community')],
        research: [item('duplicate', 'research', 'arxiv', 0.4), item('r1', 'research')],
      },
      8,
    );

    expect(result.items.filter((entry) => entry.storyId === 'duplicate')).toHaveLength(1);
    const duplicate = result.items.find((entry) => entry.storyId === 'duplicate')!;
    expect(duplicate.ranking.channel).toBe('official');
    expect(duplicate.ranking.score).toBe(0.7);
    expect(duplicate.ranking.signals.also_seen).toEqual([
      {
        channel: 'repos',
        source: 'github',
        sightingId: 'github:duplicate',
        kind: 'repository_trending_v2',
        score: 0.8,
        signals: { original: 'repos:duplicate' },
      },
      {
        channel: 'community',
        source: 'reddit',
        sightingId: 'reddit:duplicate',
        kind: 'community_hot_v2',
        score: 0.9,
        signals: { original: 'community:duplicate' },
      },
      {
        channel: 'research',
        source: 'arxiv',
        sightingId: 'arxiv:duplicate',
        kind: 'research_hot_v1',
        score: 0.4,
        signals: { original: 'research:duplicate' },
      },
    ]);
  });

  it('renumbers positions per section and flattens the identical section sequence', () => {
    const result = composeOverview(
      {
        official: [item('o1', 'official'), item('o2', 'official')],
        repos: [item('p1', 'repos'), item('p2', 'repos')],
        community: [item('c1', 'community'), item('c2', 'community')],
        research: [item('r1', 'research'), item('r2', 'research')],
      },
      8,
    );

    expect(
      result.sections.map((section) => section.items.map((entry) => entry.ranking.position)),
    ).toEqual([
      [1, 2],
      [1, 2],
      [1, 2],
      [1, 2],
    ]);
    expect(result.items.map((entry) => entry.storyId)).toEqual(
      result.sections.flatMap((section) => section.items.map((entry) => entry.storyId)),
    );
  });
});
