import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../../src/core/db/connection.js';
import { getItemById } from '../../src/core/store/itemStore.js';
import { getLearningHistory, recordLearning } from '../../src/core/store/learningStore.js';
import {
  getMetricHistory,
  getSightingBySourceKey,
  getSightingsByStory,
  purgeRedditSightings,
  upsertSightings,
} from '../../src/core/store/sightingStore.js';
import type { LiveSightingInput } from '../../src/core/types.js';

function redditSighting(
  sourceKey: string,
  url: string,
  overrides: Partial<LiveSightingInput> = {},
): LiveSightingInput {
  return {
    source: 'reddit',
    sourceKey,
    type: 'community',
    title: `Reddit ${sourceKey}`,
    url,
    discussionUrl: `https://www.reddit.com/r/ai/comments/${sourceKey}`,
    summary: 'Reddit-only summary that must not survive its Sighting',
    author: 'fixture-author',
    score: 100,
    scoreKind: 'upvotes',
    commentsCount: 20,
    tags: ['r/ai'],
    publishedAt: '2026-07-08T00:00:00.000Z',
    publishedPrecision: 'exact_time',
    activityAt: null,
    raw: { id: sourceKey, privateFixtureValue: 'must-be-removed' },
    ...overrides,
  };
}

describe('Reddit hard retention', () => {
  let db: DB;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('first_seen 48시간 경계는 유지하고 더 오래된 Reddit 데이터와 dangling learning ID를 원자적으로 정리한다', () => {
    const now = '2026-07-10T12:00:00.000Z';
    const exact = upsertSightings(
      db,
      [redditSighting('exact-boundary', 'https://example.com/reddit-exact')],
      '2026-07-08T12:00:00.000Z',
    );
    const sharedReddit = upsertSightings(
      db,
      [redditSighting('old-shared', 'https://example.com/reddit-shared?ref=reddit')],
      '2026-07-08T11:59:59.999Z',
    );
    upsertSightings(
      db,
      [
        {
          ...redditSighting('unused', 'https://example.com/reddit-shared'),
          source: 'hackernews',
          sourceKey: 'shared-hn',
          title: 'Non-Reddit survivor',
          discussionUrl: 'https://news.ycombinator.com/item?id=shared-hn',
          summary: null,
          author: null,
          score: 1,
          scoreKind: 'points',
          commentsCount: null,
          tags: [],
          raw: { objectID: 'shared-hn' },
        },
      ],
      '2026-07-09T00:00:00.000Z',
    );
    const oldOnlyInput = redditSighting('old-only', 'https://example.com/reddit-only');
    const oldOnly = upsertSightings(db, [oldOnlyInput], '2026-07-08T11:59:59.999Z');
    upsertSightings(db, [{ ...oldOnlyInput, score: 999 }], '2026-07-10T11:59:00.000Z');

    const exactStoryId = getSightingBySourceKey(db, 'reddit', 'exact-boundary')!.storyId;
    const sharedStoryId = getSightingBySourceKey(db, 'reddit', 'old-shared')!.storyId;
    const oldOnlyStoryId = getSightingBySourceKey(db, 'reddit', 'old-only')!.storyId;
    expect(getItemById(db, sharedStoryId)?.source).toBe('reddit');
    expect(getSightingBySourceKey(db, 'reddit', 'old-only')?.lastSeenAt).toBe(
      '2026-07-10T11:59:00.000Z',
    );

    recordLearning(db, {
      topic: 'retention one',
      itemIds: [oldOnlyStoryId, sharedStoryId, exactStoryId, 'unknown-story'],
      now: '2026-07-10T11:00:00.000Z',
    });
    recordLearning(db, {
      topic: 'retention two',
      itemIds: [oldOnlyStoryId, oldOnlyStoryId, sharedStoryId],
      now,
    });

    expect(purgeRedditSightings(db, now)).toEqual({
      deletedSightings: 2,
      deletedStories: 1,
    });

    expect(getSightingBySourceKey(db, 'reddit', 'exact-boundary')).not.toBeNull();
    expect(getSightingBySourceKey(db, 'reddit', 'old-shared')).toBeNull();
    expect(getSightingBySourceKey(db, 'reddit', 'old-only')).toBeNull();
    expect(getMetricHistory(db, sharedReddit.sightingIds[0]!)).toEqual([]);
    expect(getMetricHistory(db, oldOnly.sightingIds[0]!)).toEqual([]);
    expect(getMetricHistory(db, exact.sightingIds[0]!)).toHaveLength(1);

    expect(getSightingsByStory(db, sharedStoryId)).toEqual([
      expect.objectContaining({
        source: 'hackernews',
        title: 'Non-Reddit survivor',
        isPrimary: true,
      }),
    ]);
    expect(getItemById(db, sharedStoryId)).toMatchObject({
      source: 'hackernews',
      title: 'Non-Reddit survivor',
      url: 'https://example.com/reddit-shared',
      summary: null,
      author: null,
      raw: { objectID: 'shared-hn' },
    });
    expect(getItemById(db, oldOnlyStoryId)).toBeNull();
    expect(getLearningHistory(db).map((entry) => entry.itemIds)).toEqual([
      [sharedStoryId],
      [sharedStoryId, exactStoryId, 'unknown-story'],
    ]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('학습 이력 정리가 실패하면 Sighting·snapshot·Story 삭제를 모두 롤백한다', () => {
    const inserted = upsertSightings(
      db,
      [redditSighting('rollback-old', 'https://example.com/reddit-rollback')],
      '2026-07-08T11:59:59.999Z',
    );
    const sighting = getSightingBySourceKey(db, 'reddit', 'rollback-old')!;
    recordLearning(db, {
      topic: 'rollback fixture',
      itemIds: [sighting.storyId],
      now: '2026-07-10T11:00:00.000Z',
    });
    db.exec(`
      CREATE TRIGGER fail_learning_cleanup
      BEFORE UPDATE OF item_ids ON learning_history
      BEGIN
        SELECT RAISE(ABORT, 'fixture learning update failure');
      END;
    `);

    expect(() => purgeRedditSightings(db, '2026-07-10T12:00:00.000Z')).toThrow(
      /fixture learning update failure/,
    );
    expect(getSightingBySourceKey(db, 'reddit', 'rollback-old')).not.toBeNull();
    expect(getMetricHistory(db, inserted.sightingIds[0]!)).toHaveLength(1);
    expect(getItemById(db, sighting.storyId)).not.toBeNull();
    expect(getLearningHistory(db)[0]?.itemIds).toEqual([sighting.storyId]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});
