import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../../src/core/db/connection.js';
import {
  countItems,
  getItemById,
  getScoreHistory,
  searchItems,
  upsertItems,
} from '../../src/core/store/itemStore.js';
import {
  deleteSighting,
  getMetricHistory,
  getNearestBaseline,
  getSightingBySourceKey,
  getSightingsByStory,
  listTrackedSightings,
  purgeMetricSnapshots,
  upsertSightings,
} from '../../src/core/store/sightingStore.js';
import { sightingId } from '../../src/core/normalize.js';
import type { LiveSightingInput } from '../../src/core/types.js';

function makeSighting(overrides: Partial<LiveSightingInput> = {}): LiveSightingInput {
  return {
    source: 'rss:openai',
    sourceKey: 'release-1',
    type: 'official_update',
    title: 'New model release',
    url: 'https://example.com/releases/model',
    discussionUrl: null,
    summary: 'A capable new model',
    author: 'Example AI',
    scoreKind: null,
    score: null,
    commentsCount: null,
    tags: ['model'],
    publishedAt: '2026-07-10T10:00:00.000Z',
    publishedPrecision: 'exact_time',
    activityAt: null,
    raw: { guid: 'release-1' },
    ...overrides,
  };
}

describe('sightingStore', () => {
  let db: DB;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('동일 canonical URL의 RSS·HN·Reddit 관측을 Story 하나와 Sighting 셋으로 보존한다', () => {
    const result = upsertSightings(
      db,
      [
        makeSighting(),
        makeSighting({
          source: 'hackernews',
          sourceKey: 'hn-1',
          type: 'community',
          url: 'https://example.com/releases/model?utm_source=hn',
          discussionUrl: 'https://news.ycombinator.com/item?id=hn-1',
          scoreKind: 'points',
          score: 120,
          commentsCount: 40,
          raw: { objectID: 'hn-1' },
        }),
        makeSighting({
          source: 'reddit',
          sourceKey: 'reddit-1',
          type: 'community',
          url: 'https://example.com/releases/model?ref=reddit',
          discussionUrl: 'https://www.reddit.com/r/LocalLLaMA/comments/reddit-1',
          scoreKind: 'upvotes',
          score: 80,
          commentsCount: 20,
          raw: { id: 'reddit-1' },
        }),
      ],
      '2026-07-10T12:34:56.000Z',
    );

    expect(result).toMatchObject({ found: 3, created: 1 });
    expect(result.sightingIds).toHaveLength(3);
    expect(countItems(db)).toBe(1);

    const storyId = db.prepare('SELECT id FROM items').pluck().get() as string;
    const sightings = getSightingsByStory(db, storyId);
    expect(sightings).toHaveLength(3);
    expect(sightings.map((sighting) => sighting.source).sort()).toEqual([
      'hackernews',
      'reddit',
      'rss:openai',
    ]);
    expect(new Set(sightings.map((sighting) => sighting.storyId))).toEqual(new Set([storyId]));
  });

  it('같은 source key 재관측은 URL이 바뀌어도 기존 Story의 Sighting을 갱신한다', () => {
    const first = upsertSightings(
      db,
      [
        makeSighting({
          source: 'hackernews',
          sourceKey: 'stable-key',
          type: 'community',
          scoreKind: 'points',
          score: 10,
        }),
      ],
      '2026-07-10T10:00:00.000Z',
    );
    const originalStoryId = db.prepare('SELECT id FROM items').pluck().get() as string;

    const second = upsertSightings(
      db,
      [
        makeSighting({
          source: 'hackernews',
          sourceKey: 'stable-key',
          type: 'community',
          title: 'Updated title',
          url: 'https://different.example.com/new-location',
          scoreKind: 'points',
          score: 25,
        }),
      ],
      '2026-07-10T11:00:00.000Z',
    );

    expect(second).toMatchObject({ found: 1, created: 0, sightingIds: first.sightingIds });
    expect(countItems(db)).toBe(1);
    expect(db.prepare('SELECT id FROM items').pluck().get()).toBe(originalStoryId);

    const sighting = getSightingBySourceKey(db, 'hackernews', 'stable-key');
    expect(sighting).toMatchObject({
      storyId: originalStoryId,
      title: 'Updated title',
      url: 'https://different.example.com/new-location',
      score: 25,
      firstSeenAt: '2026-07-10T10:00:00.000Z',
      lastSeenAt: '2026-07-10T11:00:00.000Z',
      quality: 'live',
      verifiedAt: '2026-07-10T11:00:00.000Z',
    });
    expect(db.prepare('SELECT COUNT(*) FROM source_sightings').pluck().get()).toBe(1);
  });

  it('legacy upsert Sighting을 실제 source key의 live Sighting으로 승격한다', () => {
    const legacyUrl = 'https://example.com/legacy-story';
    upsertItems(
      db,
      [
        {
          source: 'hackernews',
          type: 'community',
          title: 'Legacy title',
          url: legacyUrl,
          summary: null,
          author: null,
          score: 7,
          commentsCount: 1,
          tags: ['legacy'],
          publishedAt: '2026-07-09T09:00:00.000Z',
          raw: {},
        },
      ],
      '2026-07-09T10:00:00.000Z',
    );

    const before = db.prepare('SELECT rowid, id FROM items').get() as {
      rowid: number;
      id: string;
    };
    const legacySightings = getSightingsByStory(db, before.id);
    expect(legacySightings).toHaveLength(1);
    expect(legacySightings[0]).toMatchObject({
      source: 'hackernews',
      sourceKey: legacyUrl,
      quality: 'legacy_unverified',
      verifiedAt: null,
      isPrimary: true,
    });
    expect(db.prepare('SELECT COUNT(*) FROM metric_snapshots').pluck().get()).toBe(0);

    const live = makeSighting({
      source: 'hackernews',
      sourceKey: 'real-hn-key',
      type: 'community',
      title: 'Verified title',
      url: legacyUrl,
      scoreKind: 'points',
      score: 21,
      commentsCount: 5,
      raw: { objectID: 'real-hn-key' },
    });
    const result = upsertSightings(db, [live], '2026-07-10T10:00:00.000Z');

    expect(result).toEqual({
      found: 1,
      created: 0,
      sightingIds: [sightingId('hackernews', 'real-hn-key')],
    });
    const after = db.prepare('SELECT rowid, id FROM items').get();
    expect(after).toEqual(before);
    expect(getSightingsByStory(db, before.id)).toEqual([
      expect.objectContaining({
        id: sightingId('hackernews', 'real-hn-key'),
        sourceKey: 'real-hn-key',
        quality: 'live',
        verifiedAt: '2026-07-10T10:00:00.000Z',
        firstSeenAt: '2026-07-09T10:00:00.000Z',
      }),
    ]);
    expect(getScoreHistory(db, before.id).map((entry) => entry.score)).toEqual([7]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('primary를 live·채널·충실도·원천 identity 순으로 정하고 Story와 FTS에 투영한다', () => {
    const canonicalUrl = 'https://example.com/primary-story';
    upsertItems(
      db,
      [
        {
          source: 'rss:legacy',
          type: 'official_update',
          title: 'Legacy announcement phrase',
          url: canonicalUrl,
          summary: 'legacy summary',
          author: 'legacy author',
          score: 3,
          commentsCount: null,
          tags: ['legacy'],
          publishedAt: '2026-07-08T00:00:00.000Z',
          raw: {},
        },
      ],
      '2026-07-08T01:00:00.000Z',
    );
    const before = db.prepare('SELECT rowid, * FROM items').get() as Record<string, unknown>;
    const storyId = before['id'] as string;

    upsertSightings(
      db,
      [
        makeSighting({
          source: 'arxiv',
          sourceKey: 'paper-1',
          type: 'paper',
          title: 'Live research phrase',
          url: canonicalUrl,
          summary: null,
          author: null,
          tags: [],
          raw: null,
        }),
      ],
      '2026-07-09T01:00:00.000Z',
    );
    expect(getSightingsByStory(db, storyId).find((row) => row.isPrimary)).toMatchObject({
      source: 'arxiv',
      quality: 'live',
    });
    expect(getItemById(db, storyId)?.title).toBe('Live research phrase');

    const richShared = {
      type: 'official_update' as const,
      url: canonicalUrl,
      summary: 'complete summary',
      author: 'complete author',
      discussionUrl: 'https://community.example.com/thread',
      scoreKind: 'reactions',
      score: 9,
      commentsCount: 4,
      tags: ['complete'],
      activityAt: '2026-07-10T08:00:00.000Z',
      raw: { complete: true },
    };
    upsertSightings(
      db,
      [
        makeSighting({
          ...richShared,
          source: 'rss:z-provider',
          sourceKey: 'z-key',
          title: 'Rich Z phrase',
        }),
        makeSighting({
          source: 'rss:a-provider',
          sourceKey: 'a-key',
          type: 'official_update',
          title: 'Sparse A phrase',
          url: canonicalUrl,
          discussionUrl: null,
          summary: null,
          author: null,
          scoreKind: null,
          score: null,
          commentsCount: null,
          tags: [],
          activityAt: null,
          raw: null,
        }),
        makeSighting({
          ...richShared,
          source: 'rss:b-provider',
          sourceKey: 'b-key',
          title: 'Lexical winner phrase',
        }),
      ],
      '2026-07-10T09:30:00.000Z',
    );

    const sightings = getSightingsByStory(db, storyId);
    expect(sightings.filter((row) => row.isPrimary)).toEqual([
      expect.objectContaining({ source: 'rss:b-provider', sourceKey: 'b-key' }),
    ]);

    const after = db.prepare('SELECT rowid, * FROM items WHERE id = ?').get(storyId) as Record<
      string,
      unknown
    >;
    expect(after).toMatchObject({
      rowid: before['rowid'],
      id: before['id'],
      canonical_url: before['canonical_url'],
      first_seen_at: before['first_seen_at'],
      source: 'rss:b-provider',
      type: 'official_update',
      title: 'Lexical winner phrase',
      url: canonicalUrl,
      summary: 'complete summary',
      author: 'complete author',
      score: 9,
      comments_count: 4,
      tags: JSON.stringify(['complete']),
      published_at: '2026-07-10T10:00:00.000Z',
      raw: JSON.stringify({ complete: true }),
      last_seen_at: '2026-07-10T09:30:00.000Z',
    });
    expect(searchItems(db, 'lexical winner', { sinceDays: 3650, limit: 10 })).toHaveLength(1);
    expect(searchItems(db, 'legacy announcement', { sinceDays: 3650, limit: 10 })).toHaveLength(0);
    expect(getScoreHistory(db, storyId).map((entry) => entry.score)).toEqual([3]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('시간 버킷별 최신 snapshot을 값 변화와 무관하게 저장하고 0과 null을 보존한다', () => {
    const input = makeSighting({
      source: 'hackernews',
      sourceKey: 'snapshot-key',
      type: 'community',
      scoreKind: 'points',
      score: 0,
      commentsCount: null,
    });
    const first = upsertSightings(db, [input], '2026-07-10T10:05:00.000Z');
    const sightingIdValue = first.sightingIds[0]!;

    upsertSightings(db, [{ ...input, score: 5, commentsCount: 0 }], '2026-07-10T10:55:00.000Z');
    upsertSightings(db, [{ ...input, score: 99, commentsCount: 99 }], '2026-07-10T10:20:00.000Z');
    upsertSightings(db, [{ ...input, score: 5, commentsCount: 0 }], '2026-07-10T11:05:00.000Z');
    upsertSightings(db, [{ ...input, score: 0, commentsCount: null }], '2026-07-10T12:05:00.000Z');

    expect(getMetricHistory(db, sightingIdValue)).toEqual([
      {
        sightingId: sightingIdValue,
        bucketAt: '2026-07-10T10:00:00.000Z',
        observedAt: '2026-07-10T10:55:00.000Z',
        score: 5,
        commentsCount: 0,
      },
      {
        sightingId: sightingIdValue,
        bucketAt: '2026-07-10T11:00:00.000Z',
        observedAt: '2026-07-10T11:05:00.000Z',
        score: 5,
        commentsCount: 0,
      },
      {
        sightingId: sightingIdValue,
        bucketAt: '2026-07-10T12:00:00.000Z',
        observedAt: '2026-07-10T12:05:00.000Z',
        score: 0,
        commentsCount: null,
      },
    ]);

    const storyId = getSightingBySourceKey(db, 'hackernews', 'snapshot-key')!.storyId;
    expect(getSightingsByStory(db, storyId)[0]!.metricHistory).toEqual(
      getMetricHistory(db, sightingIdValue),
    );
  });

  it('6h·24h·7d 허용 오차에서 observedAt 최근접 기준점을 고르고 legacy를 제외한다', () => {
    const input = makeSighting({
      source: 'github',
      sourceKey: 'baseline-repo',
      type: 'hot_repo',
      scoreKind: 'stars',
    });
    const observations = [
      ['2026-07-03T00:00:00.000Z', 30],
      ['2026-07-09T07:59:59.000Z', 70],
      ['2026-07-09T16:00:00.000Z', 160],
      ['2026-07-10T04:00:00.000Z', 40],
      ['2026-07-10T08:00:00.000Z', 80],
    ] as const;
    let sightingIdValue = '';
    for (const [observedAt, score] of observations) {
      sightingIdValue = upsertSightings(db, [{ ...input, score }], observedAt).sightingIds[0]!;
    }

    expect(getNearestBaseline(db, sightingIdValue, '2026-07-10T12:00:00.000Z', '6h')).toMatchObject(
      { observedAt: '2026-07-10T04:00:00.000Z', score: 40 },
    );
    expect(
      getNearestBaseline(db, sightingIdValue, '2026-07-10T12:00:00.000Z', '24h'),
    ).toMatchObject({ observedAt: '2026-07-09T16:00:00.000Z', score: 160 });
    expect(getNearestBaseline(db, sightingIdValue, '2026-07-10T12:00:00.000Z', '7d')).toMatchObject(
      { observedAt: '2026-07-03T00:00:00.000Z', score: 30 },
    );

    const outsideId = upsertSightings(
      db,
      [{ ...input, sourceKey: 'outside-baseline', score: 70 }],
      '2026-07-09T07:59:59.000Z',
    ).sightingIds[0]!;
    expect(getNearestBaseline(db, outsideId, '2026-07-10T12:00:00.000Z', '24h')).toBeNull();

    upsertItems(
      db,
      [
        {
          source: 'github',
          type: 'hot_repo',
          title: 'Legacy repo',
          url: 'https://example.com/legacy-repo',
          summary: null,
          author: null,
          score: 10,
          commentsCount: null,
          tags: [],
          publishedAt: '2026-07-10T00:00:00.000Z',
          raw: { id: 'legacy-repo-id' },
        },
      ],
      '2026-07-10T00:00:00.000Z',
    );
    const legacyId = sightingId('github', 'legacy-repo-id');
    db.prepare(
      `INSERT INTO metric_snapshots
         (sighting_id, bucket_at, observed_at, score, comments_count)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(legacyId, '2026-07-10T06:00:00.000Z', '2026-07-10T06:00:00.000Z', 10, null);
    expect(getNearestBaseline(db, legacyId, '2026-07-10T12:00:00.000Z', '6h')).toBeNull();
  });

  it('게시 시각이 없으면 관측 시각으로 대체하고 precision을 inferred로 강제한다', () => {
    upsertSightings(
      db,
      [
        makeSighting({
          sourceKey: 'missing-time',
          publishedAt: null,
          publishedPrecision: 'exact_time',
        }),
      ],
      '2026-07-10T13:14:15.000Z',
    );

    expect(getSightingBySourceKey(db, 'rss:openai', 'missing-time')).toMatchObject({
      publishedAt: '2026-07-10T13:14:15.000Z',
      publishedPrecision: 'inferred',
    });
  });

  it('legacy 호환 경로의 신규·key 변경·exact 갱신마다 primary와 Story 투영을 재선정한다', () => {
    const url = 'https://example.com/legacy-multi-source';
    upsertItems(
      db,
      [
        {
          source: 'arxiv',
          type: 'paper',
          title: 'Legacy research',
          url,
          summary: null,
          author: 'research author',
          score: null,
          commentsCount: null,
          tags: ['paper'],
          publishedAt: '2026-07-01T00:00:00.000Z',
          raw: { id: 'paper-key' },
        },
      ],
      '2026-07-01T01:00:00.000Z',
    );
    const before = db.prepare('SELECT rowid, id, canonical_url, first_seen_at FROM items').get();

    const official = {
      source: 'rss:official',
      type: 'official_update' as const,
      title: 'Legacy official v1',
      url,
      summary: 'official summary',
      author: 'official author v1',
      score: null,
      commentsCount: null,
      tags: ['official'],
      publishedAt: '2026-07-02T00:00:00.000Z',
      raw: { feedId: 'official-v1' },
    };
    upsertItems(db, [official], '2026-07-02T01:00:00.000Z');
    upsertItems(db, [{ ...official, raw: { feedId: 'official-v2' } }], '2026-07-02T02:00:00.000Z');
    upsertItems(
      db,
      [
        {
          ...official,
          title: 'Legacy official exact update',
          author: 'official author exact',
          raw: { feedId: 'official-v2', revision: 2 },
        },
      ],
      '2026-07-02T03:00:00.000Z',
    );

    const storyId = (before as { id: string }).id;
    const sightings = getSightingsByStory(db, storyId);
    expect(sightings).toHaveLength(2);
    expect(sightings.filter((row) => row.isPrimary)).toEqual([
      expect.objectContaining({
        source: 'rss:official',
        sourceKey: `official-v2:${url}`,
        title: 'Legacy official exact update',
      }),
    ]);
    expect(db.prepare('SELECT rowid, id, canonical_url, first_seen_at FROM items').get()).toEqual(
      before,
    );
    expect(getItemById(db, storyId)).toMatchObject({
      source: 'rss:official',
      type: 'official_update',
      title: 'Legacy official exact update',
      author: 'official author exact',
      raw: { feedId: 'official-v2', revision: 2 },
    });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('일반 snapshot purge는 14일보다 오래된 행만 삭제하고 정확한 경계는 보존한다', () => {
    const input = makeSighting({
      source: 'github',
      sourceKey: 'retention-repo',
      type: 'hot_repo',
      scoreKind: 'stars',
    });
    const observations = [
      ['2026-06-30T11:00:00.000Z', 1],
      ['2026-07-01T11:59:59.000Z', 2],
      ['2026-07-01T12:00:00.000Z', 3],
      ['2026-07-01T13:00:00.000Z', 4],
    ] as const;
    let sightingIdValue = '';
    for (const [observedAt, score] of observations) {
      sightingIdValue = upsertSightings(db, [{ ...input, score }], observedAt).sightingIds[0]!;
    }

    expect(purgeMetricSnapshots(db, '2026-07-15T12:00:00.000Z')).toBe(2);
    expect(getMetricHistory(db, sightingIdValue).map((row) => row.observedAt)).toEqual([
      '2026-07-01T12:00:00.000Z',
      '2026-07-01T13:00:00.000Z',
    ]);
  });

  it('tracked 목록을 결정적으로 제한하고 Sighting 삭제 후 primary·Story·cascade를 정리한다', () => {
    const sharedUrl = 'https://example.com/delete-shared';
    const officialResult = upsertSightings(
      db,
      [makeSighting({ sourceKey: 'delete-official', url: sharedUrl, title: 'Primary official' })],
      '2026-07-10T10:00:00.000Z',
    );
    const redditResult = upsertSightings(
      db,
      [
        makeSighting({
          source: 'reddit',
          sourceKey: 'delete-reddit',
          type: 'community',
          url: sharedUrl,
          title: 'Reddit fallback',
          discussionUrl: 'https://www.reddit.com/r/ai/comments/delete-reddit',
          scoreKind: 'upvotes',
          score: 5,
        }),
      ],
      '2026-07-10T11:00:00.000Z',
    );
    const otherReddit = upsertSightings(
      db,
      [
        makeSighting({
          source: 'reddit',
          sourceKey: 'other-reddit',
          type: 'community',
          url: 'https://example.com/delete-other',
          title: 'Other Reddit',
          scoreKind: 'upvotes',
        }),
      ],
      '2026-07-10T12:00:00.000Z',
    );

    expect(listTrackedSightings(db, 'reddit', 1).map((row) => row.sourceKey)).toEqual([
      'other-reddit',
    ]);

    const officialId = officialResult.sightingIds[0]!;
    const redditId = redditResult.sightingIds[0]!;
    const sharedStoryId = getSightingBySourceKey(db, 'reddit', 'delete-reddit')!.storyId;
    expect(deleteSighting(db, officialId)).toBe(true);
    expect(getMetricHistory(db, officialId)).toEqual([]);
    expect(getSightingsByStory(db, sharedStoryId)).toEqual([
      expect.objectContaining({ id: redditId, isPrimary: true }),
    ]);
    expect(getItemById(db, sharedStoryId)).toMatchObject({
      source: 'reddit',
      title: 'Reddit fallback',
    });

    expect(deleteSighting(db, redditId)).toBe(true);
    expect(getItemById(db, sharedStoryId)).toBeNull();
    expect(getMetricHistory(db, redditId)).toEqual([]);
    expect(deleteSighting(db, redditId)).toBe(false);
    expect(getSightingBySourceKey(db, 'reddit', 'other-reddit')?.id).toBe(
      otherReddit.sightingIds[0],
    );
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('늦게 도착한 과거 관측은 현재 Sighting과 Story를 되돌리지 않는다', () => {
    const current = makeSighting({
      source: 'hackernews',
      sourceKey: 'late-current',
      type: 'community',
      title: 'Current observation',
      scoreKind: 'points',
      score: 50,
      commentsCount: 10,
      raw: { revision: 'current' },
    });
    upsertSightings(db, [current], '2026-07-10T10:55:00.000Z');
    upsertSightings(
      db,
      [
        {
          ...current,
          title: 'Late stale observation',
          score: 999,
          commentsCount: 999,
          raw: { revision: 'stale' },
        },
      ],
      '2026-07-10T10:20:00.000Z',
    );

    const sighting = getSightingBySourceKey(db, 'hackernews', 'late-current')!;
    expect(sighting).toMatchObject({
      title: 'Current observation',
      score: 50,
      commentsCount: 10,
      raw: { revision: 'current' },
      lastSeenAt: '2026-07-10T10:55:00.000Z',
      verifiedAt: '2026-07-10T10:55:00.000Z',
    });
    expect(getMetricHistory(db, sighting.id)).toEqual([
      expect.objectContaining({
        observedAt: '2026-07-10T10:55:00.000Z',
        score: 50,
        commentsCount: 10,
      }),
    ]);
    expect(getItemById(db, sighting.storyId)).toMatchObject({
      title: 'Current observation',
      score: 50,
      commentsCount: 10,
      lastSeenAt: '2026-07-10T10:55:00.000Z',
    });
  });

  it('live와 legacy의 모든 non-null 시각을 UTC Z 형식으로 정규화한다', () => {
    upsertSightings(
      db,
      [
        makeSighting({
          source: 'github',
          sourceKey: 'offset-live',
          type: 'hot_repo',
          publishedAt: '2026-07-10T20:00:00+09:00',
          publishedPrecision: 'date_only',
          activityAt: '2026-07-10T21:00:00+09:00',
          scoreKind: 'stars',
        }),
      ],
      '2026-07-10T22:30:45+09:00',
    );
    const live = getSightingBySourceKey(db, 'github', 'offset-live')!;
    expect(live).toMatchObject({
      publishedAt: '2026-07-10T11:00:00.000Z',
      publishedPrecision: 'date_only',
      activityAt: '2026-07-10T12:00:00.000Z',
      firstSeenAt: '2026-07-10T13:30:45.000Z',
      lastSeenAt: '2026-07-10T13:30:45.000Z',
      verifiedAt: '2026-07-10T13:30:45.000Z',
    });
    expect(live.metricHistory).toEqual([
      expect.objectContaining({
        bucketAt: '2026-07-10T13:00:00.000Z',
        observedAt: '2026-07-10T13:30:45.000Z',
      }),
    ]);

    upsertItems(
      db,
      [
        {
          source: 'github',
          type: 'hot_repo',
          title: 'Offset legacy',
          url: 'https://example.com/offset-legacy',
          summary: null,
          author: null,
          score: 1,
          commentsCount: null,
          tags: [],
          publishedAt: '2026-07-09T20:00:00+09:00',
          raw: { id: 'offset-legacy', pushed_at: '2026-07-09T21:00:00+09:00' },
        },
      ],
      '2026-07-09T22:30:45+09:00',
    );
    const legacy = getSightingBySourceKey(db, 'github', 'offset-legacy')!;
    expect(legacy).toMatchObject({
      publishedAt: '2026-07-09T11:00:00.000Z',
      activityAt: '2026-07-09T12:00:00.000Z',
      firstSeenAt: '2026-07-09T13:30:45.000Z',
      lastSeenAt: '2026-07-09T13:30:45.000Z',
      verifiedAt: null,
    });
    expect(getItemById(db, legacy.storyId)).toMatchObject({
      publishedAt: '2026-07-09T11:00:00.000Z',
      firstSeenAt: '2026-07-09T13:30:45.000Z',
      lastSeenAt: '2026-07-09T13:30:45.000Z',
    });
  });

  it('빈 live batch는 no-op이고 파싱 불가 시각은 명시 오류로 원자적으로 롤백한다', () => {
    expect(upsertSightings(db, [], 'not-used-for-empty')).toEqual({
      found: 0,
      created: 0,
      sightingIds: [],
    });
    expect(() => upsertSightings(db, [makeSighting()], 'not-a-time')).toThrow(/observedAt/i);
    expect(() =>
      upsertSightings(
        db,
        [makeSighting({ sourceKey: 'bad-published', publishedAt: 'not-a-time' })],
        '2026-07-10T00:00:00.000Z',
      ),
    ).toThrow(/publishedAt/i);
    expect(() =>
      upsertSightings(
        db,
        [makeSighting({ sourceKey: 'bad-activity', activityAt: 'not-a-time' })],
        '2026-07-10T00:00:00.000Z',
      ),
    ).toThrow(/activityAt/i);
    expect(countItems(db)).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM source_sightings').pluck().get()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM metric_snapshots').pluck().get()).toBe(0);
  });
});
