import type { DB } from '../db/connection.js';
import { recomputeStoryPrimary } from '../store/sightingStore.js';
import {
  MIRROR_FORMAT_VERSION,
  type MirrorBucketExport,
  type MirrorSighting,
  type MirrorSnapshot,
  type MirrorStory,
} from './export.js';

export interface MirrorMergeCounts {
  stories: number;
  sightings: number;
  snapshots: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 미러 버킷 JSON을 검증해 반환한다. 형식 불일치는 null(해당 파일 폐기 대상, 계약 14.3).
 * 필드 단위 정밀 검증은 하지 않는다 — 병합 SQL이 유일 키·타입 제약으로 방어한다.
 */
export function parseMirrorBucket(data: unknown): MirrorBucketExport | null {
  if (!isRecord(data)) return null;
  if (data.formatVersion !== MIRROR_FORMAT_VERSION) return null;
  if (typeof data.bucketAt !== 'string') return null;
  if (!Array.isArray(data.stories) || !Array.isArray(data.sightings) || !Array.isArray(data.snapshots)) {
    return null;
  }
  return data as unknown as MirrorBucketExport;
}

/**
 * 미러 버킷 하나를 로컬 DB에 병합한다(계약 14.3).
 * 내용 필드는 로컬 우선이고 관측 시각 범위만 넓히며, 스냅샷은 최신 observed_at이 이긴다.
 * 반환값은 새로 삽입된 행 수(기존 행 갱신은 세지 않는다).
 */
export function mergeMirrorBucket(db: DB, bucket: MirrorBucketExport): MirrorMergeCounts {
  const insertStory = db.prepare(
    `INSERT INTO items
       (id, source, type, title, url, canonical_url, summary, author, score,
        comments_count, tags, published_at, first_seen_at, last_seen_at, raw)
     VALUES
       (@id, @source, @type, @title, @url, @canonicalUrl, @summary, @author, NULL,
        NULL, @tags, @publishedAt, @firstSeenAt, @lastSeenAt, NULL)
     ON CONFLICT (id) DO UPDATE SET
       first_seen_at = MIN(items.first_seen_at, excluded.first_seen_at),
       last_seen_at = MAX(items.last_seen_at, excluded.last_seen_at)`,
  );
  const insertSighting = db.prepare(
    `INSERT INTO source_sightings
       (id, story_id, source, source_key, type, source_url, discussion_url, title,
        summary, author, tags, score_kind, score, comments_count, published_at,
        published_precision, activity_at, first_seen_at, last_seen_at, raw, quality,
        verified_at, is_primary)
     VALUES
       (@id, @storyId, @source, @sourceKey, @type, @sourceUrl, @discussionUrl, @title,
        @summary, @author, @tags, @scoreKind, @score, @commentsCount, @publishedAt,
        @publishedPrecision, @activityAt, @firstSeenAt, @lastSeenAt, NULL, @quality,
        @verifiedAt, 0)
     ON CONFLICT (id) DO UPDATE SET
       first_seen_at = MIN(source_sightings.first_seen_at, excluded.first_seen_at),
       last_seen_at = MAX(source_sightings.last_seen_at, excluded.last_seen_at)`,
  );
  const insertSnapshot = db.prepare(
    `INSERT INTO metric_snapshots
       (sighting_id, bucket_at, observed_at, score, comments_count)
     VALUES
       (@sightingId, @bucketAt, @observedAt, @score, @commentsCount)
     ON CONFLICT (sighting_id, bucket_at) DO UPDATE SET
       observed_at = excluded.observed_at,
       score = excluded.score,
       comments_count = excluded.comments_count
     WHERE julianday(excluded.observed_at) > julianday(metric_snapshots.observed_at)`,
  );
  const hasSighting = db.prepare('SELECT 1 FROM source_sightings WHERE id = ? LIMIT 1');
  const hasStory = db.prepare('SELECT 1 FROM items WHERE id = ? LIMIT 1');

  const tx = db.transaction((data: MirrorBucketExport): MirrorMergeCounts => {
    const counts: MirrorMergeCounts = { stories: 0, sightings: 0, snapshots: 0 };
    const affectedStoryIds = new Set<string>();

    for (const story of data.stories as MirrorStory[]) {
      const existed = hasStory.get(story.id) !== undefined;
      insertStory.run({
        id: story.id,
        source: story.source,
        type: story.type,
        title: story.title,
        url: story.url,
        canonicalUrl: story.canonicalUrl,
        summary: story.summary,
        author: story.author,
        tags: JSON.stringify(story.tags ?? []),
        publishedAt: story.publishedAt,
        firstSeenAt: story.firstSeenAt,
        lastSeenAt: story.lastSeenAt,
      });
      if (!existed) counts.stories++;
    }

    for (const sighting of data.sightings as MirrorSighting[]) {
      const existed = hasSighting.get(sighting.id) !== undefined;
      insertSighting.run({
        id: sighting.id,
        storyId: sighting.storyId,
        source: sighting.source,
        sourceKey: sighting.sourceKey,
        type: sighting.type,
        sourceUrl: sighting.sourceUrl,
        discussionUrl: sighting.discussionUrl,
        title: sighting.title,
        summary: sighting.summary,
        author: sighting.author,
        tags: JSON.stringify(sighting.tags ?? []),
        scoreKind: sighting.scoreKind,
        score: sighting.score,
        commentsCount: sighting.commentsCount,
        publishedAt: sighting.publishedAt,
        publishedPrecision: sighting.publishedPrecision,
        activityAt: sighting.activityAt,
        firstSeenAt: sighting.firstSeenAt,
        lastSeenAt: sighting.lastSeenAt,
        quality: sighting.quality,
        verifiedAt: sighting.verifiedAt,
      });
      if (!existed) {
        counts.sightings++;
        affectedStoryIds.add(sighting.storyId);
      }
    }

    for (const snapshot of data.snapshots as MirrorSnapshot[]) {
      // 스냅샷은 대응하는 Sighting이 있어야만 의미가 있다(외래 참조 무결성).
      if (hasSighting.get(snapshot.sightingId) === undefined) continue;
      const result = insertSnapshot.run({
        sightingId: snapshot.sightingId,
        bucketAt: snapshot.bucketAt,
        observedAt: snapshot.observedAt,
        score: snapshot.score,
        commentsCount: snapshot.commentsCount,
      });
      if (result.changes > 0) counts.snapshots++;
    }

    for (const storyId of affectedStoryIds) recomputeStoryPrimary(db, storyId);
    return counts;
  });

  return tx(bucket);
}
