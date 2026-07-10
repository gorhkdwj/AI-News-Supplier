import type { DB } from '../db/connection.js';
import type {
  ItemType,
  MetricSnapshot,
  NewsItem,
  PublishedPrecision,
  SightingQuality,
} from '../types.js';

interface TrendSightingSqlRow {
  sighting_id: string;
  story_id: string;
  canonical_url: string;
  story_first_seen_at: string;
  story_last_seen_at: string;
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
  is_primary: number;
}

interface MetricSnapshotSqlRow {
  sighting_id: string;
  bucket_at: string;
  observed_at: string;
  score: number | null;
  comments_count: number | null;
}

interface ItemSqlRow {
  id: string;
  source: string;
  type: string;
  title: string;
  url: string;
  canonical_url: string;
  summary: string | null;
  author: string | null;
  score: number | null;
  comments_count: number | null;
  tags: string;
  published_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  raw: string | null;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export interface TrendSightingRecord {
  sightingId: string;
  storyId: string;
  canonicalUrl: string;
  storyFirstSeenAt: string;
  storyLastSeenAt: string;
  source: string;
  sourceKey: string;
  type: ItemType;
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
  publishedPrecision: PublishedPrecision;
  activityAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  quality: SightingQuality;
  verifiedAt: string | null;
  isPrimary: boolean;
}

export function queryTrendSightings(db: DB): TrendSightingRecord[] {
  const rows = db
    .prepare(
      `SELECT
         ss.id AS sighting_id,
         ss.story_id,
         i.canonical_url,
         i.first_seen_at AS story_first_seen_at,
         i.last_seen_at AS story_last_seen_at,
         ss.source,
         ss.source_key,
         ss.type,
         ss.source_url,
         ss.discussion_url,
         ss.title,
         ss.summary,
         ss.author,
         ss.tags,
         ss.score_kind,
         ss.score,
         ss.comments_count,
         ss.published_at,
         ss.published_precision,
         ss.activity_at,
         ss.first_seen_at,
         ss.last_seen_at,
         ss.quality,
         ss.verified_at,
         ss.is_primary
       FROM source_sightings ss
       JOIN items i ON i.id = ss.story_id
       ORDER BY ss.story_id ASC, ss.source ASC, ss.source_key ASC, ss.id ASC`,
    )
    .all() as TrendSightingSqlRow[];
  return rows.map((row) => ({
    sightingId: row.sighting_id,
    storyId: row.story_id,
    canonicalUrl: row.canonical_url,
    storyFirstSeenAt: row.story_first_seen_at,
    storyLastSeenAt: row.story_last_seen_at,
    source: row.source,
    sourceKey: row.source_key,
    type: row.type as ItemType,
    sourceUrl: row.source_url,
    discussionUrl: row.discussion_url,
    title: row.title,
    summary: row.summary,
    author: row.author,
    tags: parseJson<string[]>(row.tags, []),
    scoreKind: row.score_kind,
    score: row.score,
    commentsCount: row.comments_count,
    publishedAt: row.published_at,
    publishedPrecision: row.published_precision as PublishedPrecision,
    activityAt: row.activity_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    quality: row.quality as SightingQuality,
    verifiedAt: row.verified_at,
    isPrimary: row.is_primary === 1,
  }));
}

export function queryAllMetricSnapshots(db: DB): MetricSnapshot[] {
  const rows = db
    .prepare(
      `SELECT sighting_id, bucket_at, observed_at, score, comments_count
       FROM metric_snapshots
       ORDER BY sighting_id ASC, observed_at ASC, bucket_at ASC`,
    )
    .all() as MetricSnapshotSqlRow[];
  return rows.map((row) => ({
    sightingId: row.sighting_id,
    bucketAt: row.bucket_at,
    observedAt: row.observed_at,
    score: row.score,
    commentsCount: row.comments_count,
  }));
}

function rowToItem(row: ItemSqlRow): NewsItem {
  return {
    id: row.id,
    source: row.source,
    type: row.type as ItemType,
    title: row.title,
    url: row.url,
    canonicalUrl: row.canonical_url,
    summary: row.summary,
    author: row.author,
    score: row.score,
    commentsCount: row.comments_count,
    tags: parseJson<string[]>(row.tags, []),
    publishedAt: row.published_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    raw: parseJson<unknown>(row.raw, null),
  };
}

export interface LegacyTrendQuery {
  sinceIso: string;
  sources?: string[];
  types?: ItemType[];
}

export function queryLegacyTrendItems(db: DB, query: LegacyTrendQuery): NewsItem[] {
  const conditions = ['(published_at >= ? OR published_at IS NULL)'];
  const parameters: unknown[] = [query.sinceIso];
  if (query.sources !== undefined && query.sources.length > 0) {
    conditions.push(`source IN (${query.sources.map(() => '?').join(',')})`);
    parameters.push(...query.sources);
  }
  if (query.types !== undefined && query.types.length > 0) {
    conditions.push(`type IN (${query.types.map(() => '?').join(',')})`);
    parameters.push(...query.types);
  }
  const rows = db
    .prepare(
      `SELECT * FROM items
       WHERE ${conditions.join(' AND ')}
       ORDER BY COALESCE(published_at, '') DESC, id ASC`,
    )
    .all(...parameters) as ItemSqlRow[];
  return rows.map(rowToItem);
}
