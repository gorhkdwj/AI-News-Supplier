import { describe, expect, it } from 'vitest';
import { openDb, type DB } from '../../src/core/db/connection.js';
import {
  MIRROR_FORMAT_VERSION,
  MIRROR_SOURCES,
  bucketFileStem,
  exportMirrorBucket,
  listMirrorBuckets,
} from '../../src/core/mirror/export.js';

const BUCKET = '2026-07-12T09:00:00.000Z';
const OTHER_BUCKET = '2026-07-12T08:00:00.000Z';
const NOW = new Date('2026-07-12T09:30:00.000Z');

function insertStory(db: DB, id: string, source: string): void {
  db.prepare(
    `INSERT INTO items (id, source, type, title, url, canonical_url, summary, author,
                        score, comments_count, tags, published_at, first_seen_at, last_seen_at, raw)
     VALUES (?, ?, 'community', 'title-' || ?, 'https://example.com/' || ?,
             'https://example.com/' || ?, null, null, null, null, '["ai"]',
             '2026-07-12T08:00:00.000Z', '2026-07-12T08:00:00.000Z', '2026-07-12T09:10:00.000Z',
             '{"secret":"raw-should-not-leak"}')`,
  ).run(id, source, id, id, id);
}

function insertSighting(db: DB, id: string, storyId: string, source: string): void {
  db.prepare(
    `INSERT INTO source_sightings (id, story_id, source, source_key, type, source_url,
       discussion_url, title, summary, author, tags, score_kind, score, comments_count,
       published_at, published_precision, activity_at, first_seen_at, last_seen_at,
       raw, quality, verified_at, is_primary)
     VALUES (?, ?, ?, 'key-' || ?, 'community', 'https://example.com/' || ?,
             null, 'title', null, null, '[]', 'points', 100, 5,
             '2026-07-12T08:00:00.000Z', 'exact_time', null,
             '2026-07-12T08:00:00.000Z', '2026-07-12T09:10:00.000Z',
             '{"secret":"raw-should-not-leak"}', 'live', '2026-07-12T09:10:00.000Z', 1)`,
  ).run(id, storyId, source, id, id);
}

function insertSnapshot(db: DB, sightingId: string, bucketAt: string): void {
  db.prepare(
    `INSERT INTO metric_snapshots (sighting_id, bucket_at, observed_at, score, comments_count)
     VALUES (?, ?, ?, 100, 5)`,
  ).run(sightingId, bucketAt, NOW.toISOString());
}

/** hackernews Sighting 1개(스냅샷 있음)와 rss:openai Sighting 1개(제외 대상)를 심은 DB. */
function seededDb(): DB {
  const db = openDb(':memory:');
  insertStory(db, 'story-hn', 'hackernews');
  insertSighting(db, 'sight-hn', 'story-hn', 'hackernews');
  insertSnapshot(db, 'sight-hn', BUCKET);

  insertStory(db, 'story-rss', 'rss:openai');
  insertSighting(db, 'sight-rss', 'story-rss', 'rss:openai');
  insertSnapshot(db, 'sight-rss', BUCKET);
  return db;
}

describe('listMirrorBuckets', () => {
  it('미러 소스의 스냅샷이 있는 버킷만 오름차순으로 반환한다', () => {
    const db = seededDb();
    insertStory(db, 'story-hn2', 'hackernews');
    insertSighting(db, 'sight-hn2', 'story-hn2', 'hackernews');
    insertSnapshot(db, 'sight-hn2', OTHER_BUCKET);

    expect(listMirrorBuckets(db, '2026-07-12T00:00:00.000Z')).toEqual([OTHER_BUCKET, BUCKET]);
    db.close();
  });

  it('since 이전 관측은 제외한다', () => {
    const db = seededDb();
    expect(listMirrorBuckets(db, '2026-07-13T00:00:00.000Z')).toEqual([]);
    db.close();
  });

  it('제외 소스(rss)만 있는 버킷은 나타나지 않는다', () => {
    const db = openDb(':memory:');
    insertStory(db, 'story-rss', 'rss:openai');
    insertSighting(db, 'sight-rss', 'story-rss', 'rss:openai');
    insertSnapshot(db, 'sight-rss', BUCKET);
    expect(listMirrorBuckets(db, '2026-07-12T00:00:00.000Z')).toEqual([]);
    db.close();
  });
});

describe('exportMirrorBucket', () => {
  it('미러 소스의 스냅샷·Sighting·Story만 포함한다 (계약 14.1절)', () => {
    const db = seededDb();
    const out = exportMirrorBucket(db, BUCKET, NOW);

    expect(out.formatVersion).toBe(MIRROR_FORMAT_VERSION);
    expect(out.bucketAt).toBe(BUCKET);
    expect(out.sources).toEqual([...MIRROR_SOURCES]);
    expect(out.snapshots.map((s) => s.sightingId)).toEqual(['sight-hn']);
    expect(out.sightings.map((s) => s.id)).toEqual(['sight-hn']);
    expect(out.stories.map((s) => s.id)).toEqual(['story-hn']);
    db.close();
  });

  it('raw 원문을 절대 포함하지 않는다 (재배포 최소화)', () => {
    const db = seededDb();
    const serialized = JSON.stringify(exportMirrorBucket(db, BUCKET, NOW));
    expect(serialized).not.toContain('raw-should-not-leak');
    db.close();
  });

  it('스냅샷이 없어도 버킷 시간창에 관측된 Sighting은 포함한다', () => {
    const db = openDb(':memory:');
    insertStory(db, 'story-hn', 'hackernews');
    insertSighting(db, 'sight-hn', 'story-hn', 'hackernews'); // last_seen 09:10 — BUCKET 창 안
    const out = exportMirrorBucket(db, BUCKET, NOW);
    expect(out.sightings.map((s) => s.id)).toEqual(['sight-hn']);
    expect(out.snapshots).toEqual([]);
    db.close();
  });

  it('tags를 배열로 파싱하고 손상 시 빈 배열로 둔다', () => {
    const db = seededDb();
    db.prepare(`UPDATE items SET tags = 'BROKEN' WHERE id = 'story-hn'`).run();
    const out = exportMirrorBucket(db, BUCKET, NOW);
    expect(out.stories[0]?.tags).toEqual([]);
    expect(out.sightings[0]?.tags).toEqual([]);
    db.close();
  });
});

describe('bucketFileStem', () => {
  it('버킷 ISO에서 파일명 안전한 시간 표기를 만든다', () => {
    expect(bucketFileStem(BUCKET)).toBe('mirror-2026-07-12T09');
  });
});
