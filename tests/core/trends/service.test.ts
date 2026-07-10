import { afterEach, describe, expect, it } from 'vitest';

import { openDb, type DB } from '../../../src/core/db/connection.js';
import { itemId } from '../../../src/core/normalize.js';
import { getTrendItemDetail, getTrends } from '../../../src/core/trends/service.js';
import { upsertItems } from '../../../src/core/store/itemStore.js';
import { upsertSightings } from '../../../src/core/store/sightingStore.js';
import type { LiveSightingInput } from '../../../src/core/types.js';

const NOW = new Date('2026-07-10T12:00:00.000Z');
const openDbs: DB[] = [];

function db(): DB {
  const connection = openDb(':memory:');
  openDbs.push(connection);
  return connection;
}

afterEach(() => {
  while (openDbs.length > 0) openDbs.pop()?.close();
});

function live(
  overrides: Partial<LiveSightingInput> & Pick<LiveSightingInput, 'sourceKey'>,
): LiveSightingInput {
  return {
    source: overrides.source ?? 'hackernews',
    sourceKey: overrides.sourceKey,
    type: overrides.type ?? 'community',
    title: overrides.title ?? overrides.sourceKey,
    url: overrides.url ?? `https://example.com/${overrides.sourceKey}`,
    discussionUrl: overrides.discussionUrl === undefined ? null : overrides.discussionUrl,
    summary: overrides.summary === undefined ? null : overrides.summary,
    author: overrides.author === undefined ? null : overrides.author,
    score: overrides.score === undefined ? 10 : overrides.score,
    scoreKind: overrides.scoreKind === undefined ? 'points' : overrides.scoreKind,
    commentsCount: overrides.commentsCount === undefined ? 1 : overrides.commentsCount,
    tags: overrides.tags ?? ['ai'],
    publishedAt:
      overrides.publishedAt === undefined ? '2026-07-10T10:00:00.000Z' : overrides.publishedAt,
    publishedPrecision: overrides.publishedPrecision ?? 'exact_time',
    activityAt: overrides.activityAt === undefined ? null : overrides.activityAt,
    raw: overrides.raw === undefined ? null : overrides.raw,
  };
}

function observeRepo(
  connection: DB,
  key = 'repo-1',
  url = 'https://github.com/acme/agent',
): string {
  const common = {
    source: 'github',
    sourceKey: key,
    type: 'hot_repo' as const,
    title: `acme/${key}`,
    url,
    scoreKind: 'stars',
    commentsCount: null,
    publishedAt: '2026-01-01T00:00:00.000Z',
  };
  upsertSightings(
    connection,
    [live({ ...common, score: 4_000, activityAt: '2026-07-03T12:00:00.000Z' })],
    '2026-07-03T12:00:00.000Z',
  );
  upsertSightings(
    connection,
    [live({ ...common, score: 4_500, activityAt: '2026-07-09T12:00:00.000Z' })],
    '2026-07-09T12:00:00.000Z',
  );
  upsertSightings(
    connection,
    [live({ ...common, score: 5_000, activityAt: NOW.toISOString(), raw: { stars: 999_999 } })],
    NOW.toISOString(),
  );
  return itemId(url);
}

describe('core trend service', () => {
  it('builds repository baselines only from metric snapshots and current normalized columns', () => {
    const connection = db();
    const storyId = observeRepo(connection);
    connection.prepare('UPDATE items SET score = 999999 WHERE id = ?').run(storyId);
    connection
      .prepare('INSERT INTO score_history(item_id, observed_at, score) VALUES (?, ?, ?)')
      .run(storyId, NOW.toISOString(), 888_888);

    const result = getTrends(
      connection,
      { rankingVersion: 'v2', channel: 'repos', sort: 'trending', limit: 10 },
      { now: NOW },
    );

    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.id).toBe(storyId);
    expect(item.score).toBe(5_000);
    expect(item.ranking.signals).toMatchObject({
      totalStars: 5_000,
      delta24: 500,
      delta7: 1_000,
    });
    expect(item.ranking.coverage).toBe('full');
  });

  it('uses 30-day live Sighting values for community P95 and snapshots for velocity', () => {
    const connection = db();
    const target = live({
      sourceKey: 'target',
      url: 'https://example.com/community-target',
      score: 40,
      commentsCount: 5,
      publishedAt: '2026-07-09T12:00:00.000Z',
    });
    upsertSightings(connection, [target], '2026-07-09T12:00:00.000Z');
    upsertSightings(
      connection,
      [{ ...target, score: 80, commentsCount: 10 }],
      '2026-07-10T06:00:00.000Z',
    );
    upsertSightings(
      connection,
      [{ ...target, score: 100, commentsCount: 20, raw: { score: 999_999 } }],
      NOW.toISOString(),
    );
    for (let score = 101; score <= 119; score += 1) {
      upsertSightings(
        connection,
        [live({ sourceKey: `sample-${score}`, score, commentsCount: score - 90 })],
        NOW.toISOString(),
      );
    }
    const storyId = itemId('https://example.com/community-target');
    connection.prepare('UPDATE items SET score = 777777 WHERE id = ?').run(storyId);
    connection
      .prepare('INSERT INTO score_history(item_id, observed_at, score) VALUES (?, ?, ?)')
      .run(storyId, NOW.toISOString(), 666_666);

    const result = getTrends(
      connection,
      { channel: 'community', sort: 'hot', limit: 30 },
      { now: NOW },
    );
    const item = result.items.find((candidate) => candidate.id === storyId)!;

    expect(item.score).toBe(100);
    expect(item.ranking.signals).toMatchObject({
      scoreNormalizationCeiling: 118,
      scoreDelta6: 20,
      scoreDelta24: 60,
      commentDelta6: 10,
      commentDelta24: 15,
    });
  });

  it('composes four real-store Overview sections, redistributes and deduplicates a Story', () => {
    const connection = db();
    const sharedUrl = 'https://vendor.example.com/release';
    upsertSightings(
      connection,
      [
        live({
          source: 'rss:vendor',
          sourceKey: 'release',
          type: 'official_update',
          title: 'API release',
          url: sharedUrl,
          score: null,
          scoreKind: null,
          commentsCount: null,
        }),
        live({
          sourceKey: 'shared-hn',
          url: sharedUrl,
          title: 'Discussion of API release',
          score: 50,
        }),
        live({ sourceKey: 'community-only', score: 40 }),
        live({
          source: 'arxiv',
          sourceKey: 'paper',
          type: 'paper',
          scoreKind: 'citations',
          score: 5,
        }),
      ],
      NOW.toISOString(),
    );
    observeRepo(connection);

    const result = getTrends(connection, { rankingVersion: 'v2', limit: 4 }, { now: NOW });

    expect(result.sections.map((section) => section.channel)).toEqual([
      'official',
      'repos',
      'community',
      'research',
    ]);
    expect(result.sections.map((section) => section.items.length)).toEqual([1, 1, 1, 1]);
    expect(new Set(result.items.map((item) => item.id)).size).toBe(4);
    expect(result.items).toEqual(result.sections.flatMap((section) => section.items));
    const shared = result.items.find((item) => item.id === itemId(sharedUrl))!;
    expect(shared.ranking.channel).toBe('official');
    expect(shared.ranking.signals.also_seen).toEqual(
      expect.arrayContaining([expect.objectContaining({ channel: 'community' })]),
    );
  });

  it('returns scoreless latest metadata and a nullable hotness alias', () => {
    const connection = db();
    upsertSightings(
      connection,
      [live({ source: 'rss:vendor', sourceKey: 'latest', type: 'official_update', score: null })],
      NOW.toISOString(),
    );

    const result = getTrends(connection, { channel: 'official', sort: 'latest' }, { now: NOW });

    expect(result.sections).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      hotness: null,
      ranking: { channel: 'official', sort: 'latest', score: null },
    });
  });

  it('emits one Story per channel and retains alternate same-channel Sightings in signals', () => {
    const connection = db();
    const url = 'https://example.com/shared-community';
    upsertSightings(
      connection,
      [
        live({ source: 'hackernews', sourceKey: 'same-hn', url, score: 40 }),
        live({
          source: 'reddit',
          sourceKey: 'same-reddit',
          url,
          score: 80,
          scoreKind: 'upvotes',
          discussionUrl: 'https://reddit.com/r/test/comments/same',
        }),
      ],
      NOW.toISOString(),
    );

    const result = getTrends(
      connection,
      { channel: 'community', sort: 'hot', limit: 10 },
      { now: NOW },
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe(itemId(url));
    expect(result.items[0]!.ranking.signals.alternate_sightings).toEqual([
      expect.objectContaining({ channel: 'community', source: 'hackernews' }),
    ]);
  });

  it('preserves the exact legacy hotness/diversity order by default', () => {
    const connection = db();
    upsertItems(
      connection,
      [
        live({
          source: 'hackernews',
          sourceKey: 'a-low',
          url: 'https://example.com/a-low',
          score: 10,
        }),
        live({
          source: 'hackernews',
          sourceKey: 'a-high',
          url: 'https://example.com/a-high',
          score: 30,
        }),
        live({
          source: 'rss:test',
          sourceKey: 'b',
          url: 'https://example.com/b',
          score: null,
          scoreKind: null,
        }),
      ],
      NOW.toISOString(),
    );

    const result = getTrends(connection, { limit: 3 }, { now: NOW, maxPerSourceRatio: 0.4 });

    expect(result.items.map((item) => item.id)).toEqual([
      itemId('https://example.com/a-high'),
      itemId('https://example.com/b'),
      itemId('https://example.com/a-low'),
    ]);
    expect(result.items.every((item) => item.ranking.kind === 'legacy_hotness_v1')).toBe(true);
    expect(result.items.every((item) => item.hotness === item.ranking.score)).toBe(true);
  });

  it('returns primary-first Sightings with ascending metric history in item detail', () => {
    const connection = db();
    const url = 'https://vendor.example.com/detail';
    const discussion = live({
      sourceKey: 'detail-hn',
      url,
      score: 1,
      discussionUrl: 'https://news.ycombinator.com/item?id=1',
    });
    upsertSightings(connection, [discussion], '2026-07-10T10:00:00.000Z');
    upsertSightings(connection, [{ ...discussion, score: 2 }], '2026-07-10T11:00:00.000Z');
    upsertSightings(
      connection,
      [
        live({
          source: 'rss:vendor',
          sourceKey: 'detail-rss',
          type: 'official_update',
          url,
          score: null,
          scoreKind: null,
        }),
      ],
      NOW.toISOString(),
    );

    const detail = getTrendItemDetail(connection, itemId(url));

    expect(detail.found).toBe(true);
    if (!detail.found) throw new Error('unreachable');
    expect(detail.sightings[0]).toMatchObject({ source: 'rss:vendor', isPrimary: true });
    const hn = detail.sightings.find((sighting) => sighting.source === 'hackernews')!;
    expect(hn.metricHistory.map((snapshot) => snapshot.score)).toEqual([1, 2]);
    expect(detail.scoreHistory).toEqual([]);
  });
});
