import type { DB } from '../db/connection.js';

/** 미러에 포함하는 소스. 성장 기준점이 필요한 채널만 게시한다 (기준 계약 14.1절, D-009). */
export const MIRROR_SOURCES = ['hackernews', 'devto', 'github'] as const;

export const MIRROR_FORMAT_VERSION = 1;

export interface MirrorStory {
  id: string;
  canonicalUrl: string;
  source: string;
  type: string;
  title: string;
  url: string;
  summary: string | null;
  author: string | null;
  tags: string[];
  publishedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface MirrorSighting {
  id: string;
  storyId: string;
  source: string;
  sourceKey: string;
  type: string;
  sourceUrl: string;
  discussionUrl: string | null;
  title: string;
  summary: string | null;
  author: string | null;
  tags: string[];
  scoreKind: string | null;
  score: number | null;
  commentsCount: number | null;
  publishedAt: string | null;
  publishedPrecision: string;
  activityAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  quality: string;
  verifiedAt: string | null;
}

export interface MirrorSnapshot {
  sightingId: string;
  bucketAt: string;
  observedAt: string;
  score: number | null;
  commentsCount: number | null;
}

/** 시간 버킷 하나의 증분 산출물 (기준 계약 14.2절). raw 원문은 크기·재배포 최소화를 위해 제외한다. */
export interface MirrorBucketExport {
  formatVersion: number;
  exportedAt: string;
  bucketAt: string;
  sources: string[];
  stories: MirrorStory[];
  sightings: MirrorSighting[];
  snapshots: MirrorSnapshot[];
}

const SOURCE_PLACEHOLDERS = MIRROR_SOURCES.map(() => '?').join(',');

function parseTags(tags: string): string[] {
  try {
    const parsed: unknown = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** since 이후에 관측된 스냅샷이 존재하는 시간 버킷 목록(오름차순). */
export function listMirrorBuckets(db: DB, sinceIso: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT ms.bucket_at AS bucketAt
       FROM metric_snapshots ms
       JOIN source_sightings s ON s.id = ms.sighting_id
       WHERE ms.observed_at >= ? AND s.source IN (${SOURCE_PLACEHOLDERS})
       ORDER BY ms.bucket_at ASC`,
    )
    .all(sinceIso, ...MIRROR_SOURCES) as Array<{ bucketAt: string }>;
  return rows.map((r) => r.bucketAt);
}

interface SightingRow {
  id: string;
  story_id: string;
  source: string;
  source_key: string;
  type: string;
  source_url: string;
  discussion_url: string | null;
  title: string;
  summary: string | null;
  author: string | null;
  tags: string;
  score_kind: string | null;
  score: number | null;
  comments_count: number | null;
  published_at: string | null;
  published_precision: string;
  activity_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  quality: string;
  verified_at: string | null;
}

interface StoryRow {
  id: string;
  canonical_url: string;
  source: string;
  type: string;
  title: string;
  url: string;
  summary: string | null;
  author: string | null;
  tags: string;
  published_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

/**
 * 한 시간 버킷의 미러 증분을 만든다.
 * 포함 기준: 그 버킷의 스냅샷 + 그 스냅샷의 Sighting + 해당 버킷 시간창에 관측된 Sighting + 참조된 Story.
 */
export function exportMirrorBucket(db: DB, bucketAt: string, now: Date): MirrorBucketExport {
  const bucketEnd = new Date(Date.parse(bucketAt) + 3_600_000).toISOString();

  const snapshots = db
    .prepare(
      `SELECT ms.sighting_id AS sightingId, ms.bucket_at AS bucketAt,
              ms.observed_at AS observedAt, ms.score, ms.comments_count AS commentsCount
       FROM metric_snapshots ms
       JOIN source_sightings s ON s.id = ms.sighting_id
       WHERE ms.bucket_at = ? AND s.source IN (${SOURCE_PLACEHOLDERS})
       ORDER BY ms.sighting_id ASC`,
    )
    .all(bucketAt, ...MIRROR_SOURCES) as MirrorSnapshot[];

  const sightingRows = db
    .prepare(
      `SELECT id, story_id, source, source_key, type, source_url, discussion_url,
              title, summary, author, tags, score_kind, score, comments_count,
              published_at, published_precision, activity_at,
              first_seen_at, last_seen_at, quality, verified_at
       FROM source_sightings
       WHERE source IN (${SOURCE_PLACEHOLDERS})
         AND (id IN (SELECT sighting_id FROM metric_snapshots WHERE bucket_at = ?)
              OR (last_seen_at >= ? AND last_seen_at < ?))
       ORDER BY id ASC`,
    )
    .all(...MIRROR_SOURCES, bucketAt, bucketAt, bucketEnd) as SightingRow[];

  const storyIds = [...new Set(sightingRows.map((r) => r.story_id))];
  const stories: MirrorStory[] = [];
  const storyStmt = db.prepare(
    `SELECT id, canonical_url, source, type, title, url, summary, author, tags,
            published_at, first_seen_at, last_seen_at
     FROM items WHERE id = ?`,
  );
  for (const storyId of storyIds.sort()) {
    const row = storyStmt.get(storyId) as StoryRow | undefined;
    if (!row) continue;
    stories.push({
      id: row.id,
      canonicalUrl: row.canonical_url,
      source: row.source,
      type: row.type,
      title: row.title,
      url: row.url,
      summary: row.summary,
      author: row.author,
      tags: parseTags(row.tags),
      publishedAt: row.published_at,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
    });
  }

  const sightings: MirrorSighting[] = sightingRows.map((r) => ({
    id: r.id,
    storyId: r.story_id,
    source: r.source,
    sourceKey: r.source_key,
    type: r.type,
    sourceUrl: r.source_url,
    discussionUrl: r.discussion_url,
    title: r.title,
    summary: r.summary,
    author: r.author,
    tags: parseTags(r.tags),
    scoreKind: r.score_kind,
    score: r.score,
    commentsCount: r.comments_count,
    publishedAt: r.published_at,
    publishedPrecision: r.published_precision,
    activityAt: r.activity_at,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    quality: r.quality,
    verifiedAt: r.verified_at,
  }));

  return {
    formatVersion: MIRROR_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    bucketAt,
    sources: [...MIRROR_SOURCES],
    stories,
    sightings,
    snapshots,
  };
}

/** 파일 이름에 쓰는 버킷 표기: 콜론을 제거한 `2026-07-12T09` 형태. */
export function bucketFileStem(bucketAt: string): string {
  return `mirror-${bucketAt.slice(0, 13)}`;
}
