import type { DB } from '../db/connection.js';
import { canonicalizeUrl, itemId, sightingId } from '../normalize.js';
import type {
  BaselineHorizon,
  CollectedItem,
  ItemType,
  LiveSightingInput,
  MetricSnapshot,
  PublishedPrecision,
  SightingQuality,
  SourceSighting,
} from '../types.js';

function sourceKeyPart(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function objectRaw(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function legacySourceKey(raw: Record<string, unknown>, canonicalUrl: string): string {
  return (
    sourceKeyPart(raw['objectID']) ??
    sourceKeyPart(raw['id']) ??
    sourceKeyPart(raw['permalink']) ??
    (sourceKeyPart(raw['feedId']) == null
      ? null
      : `${sourceKeyPart(raw['feedId'])}:${canonicalUrl}`) ??
    canonicalUrl
  );
}

function legacyDiscussionUrl(source: string, raw: Record<string, unknown>): string | null {
  const objectId = sourceKeyPart(raw['objectID']);
  if (source === 'hackernews' && objectId !== null) {
    return `https://news.ycombinator.com/item?id=${encodeURIComponent(objectId)}`;
  }
  const permalink = sourceKeyPart(raw['permalink']);
  if (source === 'reddit' && permalink !== null) {
    try {
      return new URL(permalink, 'https://www.reddit.com').toString();
    } catch {
      return null;
    }
  }
  return null;
}

function legacyScoreKind(source: string): string | null {
  switch (source) {
    case 'hackernews':
      return 'points';
    case 'reddit':
      return 'upvotes';
    case 'devto':
      return 'reactions';
    case 'github':
      return 'stars';
    default:
      return null;
  }
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
  raw: string | null;
  quality: string;
  verified_at: string | null;
  is_primary: number;
}

interface MetricSnapshotRow {
  sighting_id: string;
  bucket_at: string;
  observed_at: string;
  score: number | null;
  comments_count: number | null;
}

function rowToSighting(row: SightingRow, metricHistory: MetricSnapshot[] = []): SourceSighting {
  return {
    id: row.id,
    storyId: row.story_id,
    source: row.source,
    sourceKey: row.source_key,
    type: row.type as ItemType,
    url: row.source_url,
    discussionUrl: row.discussion_url,
    title: row.title,
    summary: row.summary,
    author: row.author,
    tags: JSON.parse(row.tags) as string[],
    scoreKind: row.score_kind,
    score: row.score,
    commentsCount: row.comments_count,
    publishedAt: row.published_at,
    publishedPrecision: row.published_precision as PublishedPrecision,
    activityAt: row.activity_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    raw: row.raw == null ? null : (JSON.parse(row.raw) as unknown),
    quality: row.quality as SightingQuality,
    verifiedAt: row.verified_at,
    isPrimary: row.is_primary === 1,
    metricHistory,
  };
}

function rowToMetricSnapshot(row: MetricSnapshotRow): MetricSnapshot {
  return {
    sightingId: row.sighting_id,
    bucketAt: row.bucket_at,
    observedAt: row.observed_at,
    score: row.score,
    commentsCount: row.comments_count,
  };
}

function normalizeIsoTime(value: string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${field}: ${value}`);
  return date.toISOString();
}

function normalizeOptionalIsoTime(value: string | null, field: string): string | null {
  return value === null ? null : normalizeIsoTime(value, field);
}

function floorToUtcHour(iso: string): string {
  const date = new Date(normalizeIsoTime(iso, 'observedAt'));
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function channelPriority(row: SightingRow): number {
  if (row.type === 'official_update') return 0;
  if (row.type === 'hot_repo') return 1;
  if (row.type === 'community' || (row.type === 'article' && row.source === 'devto')) {
    return 2;
  }
  return 3;
}

function informationCompleteness(row: SightingRow): number {
  const values = [
    row.discussion_url,
    row.summary,
    row.author,
    row.score_kind,
    row.score,
    row.comments_count,
    row.published_at,
    row.activity_at,
    row.raw,
  ];
  let score = values.reduce<number>((total, value) => total + (value === null ? 0 : 1), 0);
  try {
    const tags: unknown = JSON.parse(row.tags);
    if (Array.isArray(tags) && tags.length > 0) score++;
  } catch {
    // 스키마 계약상 JSON이지만 손상된 레거시 값은 충실도 가산 없이 결정적으로 처리한다.
  }
  return score;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePrimary(left: SightingRow, right: SightingRow): number {
  const quality = (left.quality === 'live' ? 0 : 1) - (right.quality === 'live' ? 0 : 1);
  if (quality !== 0) return quality;
  const channel = channelPriority(left) - channelPriority(right);
  if (channel !== 0) return channel;
  const completeness = informationCompleteness(right) - informationCompleteness(left);
  if (completeness !== 0) return completeness;
  const source = compareText(left.source, right.source);
  return source !== 0 ? source : compareText(left.source_key, right.source_key);
}

export function recomputeStoryPrimary(db: DB, storyId: string): void {
  const rows = db
    .prepare('SELECT * FROM source_sightings WHERE story_id = ?')
    .all(storyId) as SightingRow[];
  if (rows.length === 0) return;

  rows.sort(comparePrimary);
  const primary = rows[0]!;
  db.prepare('UPDATE source_sightings SET is_primary = 0 WHERE story_id = ?').run(storyId);
  db.prepare('UPDATE source_sightings SET is_primary = 1 WHERE id = ?').run(primary.id);
  db.prepare(
    `UPDATE items SET
       source = @source,
       type = @type,
       title = @title,
       url = @url,
       summary = @summary,
       author = @author,
       score = @score,
       comments_count = @commentsCount,
       tags = @tags,
       published_at = @publishedAt,
       raw = @raw,
       last_seen_at = @lastSeenAt
     WHERE id = @storyId`,
  ).run({
    storyId,
    source: primary.source,
    type: primary.type,
    title: primary.title,
    url: primary.source_url,
    summary: primary.summary,
    author: primary.author,
    score: primary.score,
    commentsCount: primary.comments_count,
    tags: primary.tags,
    publishedAt: primary.published_at,
    raw: primary.raw,
    lastSeenAt: primary.last_seen_at,
  });
}

export interface UpsertSightingsResult {
  found: number;
  created: number;
  sightingIds: string[];
}

/** 기존 upsertItems 경로가 v2 DB에서도 호환 Sighting을 유지하게 한다. */
export function upsertLegacySighting(
  db: DB,
  storyId: string,
  canonicalUrl: string,
  input: CollectedItem,
  observedAt: string,
): string {
  const observedAtIso = normalizeIsoTime(observedAt, 'observedAt');
  const rawObject = objectRaw(input.raw);
  let sourceKey = legacySourceKey(rawObject, canonicalUrl);
  let id = sightingId(input.source, sourceKey);
  const findIdentity = db.prepare(
    'SELECT id, story_id, quality FROM source_sightings WHERE source = ? AND source_key = ?',
  );
  let exact = findIdentity.get(input.source, sourceKey) as
    { id: string; story_id: string; quality: SightingQuality } | undefined;
  if (exact !== undefined && exact.story_id !== storyId) {
    sourceKey = canonicalUrl;
    id = sightingId(input.source, sourceKey);
    exact = findIdentity.get(input.source, sourceKey) as
      { id: string; story_id: string; quality: SightingQuality } | undefined;
    if (exact !== undefined && exact.story_id !== storyId) {
      throw new Error(
        `Legacy source identity collision for source=${JSON.stringify(input.source)}, ` +
          `canonical_url=${JSON.stringify(canonicalUrl)}`,
      );
    }
  }
  const raw = input.raw == null ? null : JSON.stringify(input.raw);
  const values = {
    id,
    storyId,
    source: input.source,
    sourceKey,
    type: input.type,
    sourceUrl: input.url,
    discussionUrl: legacyDiscussionUrl(input.source, rawObject),
    title: input.title,
    summary: input.summary,
    author: input.author,
    tags: JSON.stringify(input.tags),
    scoreKind: legacyScoreKind(input.source),
    score: input.score,
    commentsCount: input.commentsCount,
    publishedAt:
      input.publishedAt === null
        ? observedAtIso
        : normalizeIsoTime(input.publishedAt, 'publishedAt'),
    activityAt:
      input.source === 'github'
        ? normalizeOptionalIsoTime(sourceKeyPart(rawObject['pushed_at']), 'activityAt')
        : null,
    lastSeenAt: observedAtIso,
    raw,
  };

  if (exact?.quality === 'live') return exact.id;

  const sameSourceLegacy = db
    .prepare(
      `SELECT id FROM source_sightings
       WHERE story_id = ? AND source = ? AND quality = 'legacy_unverified'
       ORDER BY id`,
    )
    .all(storyId, input.source) as { id: string }[];

  const previousId = exact?.id ?? (sameSourceLegacy.length === 1 ? sameSourceLegacy[0]!.id : null);
  if (previousId !== null) {
    db.prepare(
      `UPDATE source_sightings SET
         id = @id,
         source_key = @sourceKey,
         type = @type,
         source_url = @sourceUrl,
         discussion_url = @discussionUrl,
         title = @title,
         summary = @summary,
         author = @author,
         tags = @tags,
         score_kind = @scoreKind,
         score = @score,
         comments_count = @commentsCount,
         published_at = @publishedAt,
         published_precision = 'inferred',
         activity_at = @activityAt,
         last_seen_at = @lastSeenAt,
         raw = @raw
       WHERE id = @previousId`,
    ).run({ ...values, previousId });
    return id;
  }

  const count = db
    .prepare('SELECT COUNT(*) AS count FROM source_sightings WHERE story_id = ?')
    .get(storyId) as { count: number };
  db.prepare(
    `INSERT INTO source_sightings
       (id, story_id, source, source_key, type, source_url, discussion_url, title,
        summary, author, tags, score_kind, score, comments_count, published_at,
        published_precision, activity_at, first_seen_at, last_seen_at, raw, quality,
        verified_at, is_primary)
     VALUES
       (@id, @storyId, @source, @sourceKey, @type, @sourceUrl, @discussionUrl, @title,
        @summary, @author, @tags, @scoreKind, @score, @commentsCount, @publishedAt,
        'inferred', @activityAt, @firstSeenAt, @lastSeenAt, @raw, 'legacy_unverified',
        NULL, @isPrimary)`,
  ).run({
    ...values,
    firstSeenAt: observedAtIso,
    isPrimary: count.count === 0 ? 1 : 0,
  });
  return id;
}

/** 정규화된 라이브 관측을 Story와 소스별 Sighting으로 저장한다. */
export function upsertSightings(
  db: DB,
  inputs: LiveSightingInput[],
  observedAt: string,
): UpsertSightingsResult {
  if (inputs.length === 0) return { found: 0, created: 0, sightingIds: [] };
  const observedAtIso = normalizeIsoTime(observedAt, 'observedAt');
  const normalizedInputs = inputs.map((input): LiveSightingInput => ({
    ...input,
    publishedAt:
      input.publishedAt === null
        ? observedAtIso
        : normalizeIsoTime(input.publishedAt, 'publishedAt'),
    publishedPrecision: input.publishedAt === null ? 'inferred' : input.publishedPrecision,
    activityAt: normalizeOptionalIsoTime(input.activityAt, 'activityAt'),
  }));
  const findExistingSighting = db.prepare(
    `SELECT id, story_id
     FROM source_sightings
     WHERE source = ? AND source_key = ?`,
  );
  const findStory = db.prepare('SELECT id FROM items WHERE canonical_url = ?');
  const findSameSourceLegacy = db.prepare(
    `SELECT id FROM source_sightings
     WHERE story_id = ? AND source = ? AND quality = 'legacy_unverified'
     ORDER BY id`,
  );
  const insertStory = db.prepare(
    `INSERT INTO items
       (id, source, type, title, url, canonical_url, summary, author, score,
        comments_count, tags, published_at, first_seen_at, last_seen_at, raw)
     VALUES
       (@id, @source, @type, @title, @url, @canonicalUrl, @summary, @author, @score,
        @commentsCount, @tags, @publishedAt, @firstSeenAt, @lastSeenAt, @raw)`,
  );
  const countSightings = db.prepare(
    'SELECT COUNT(*) AS count FROM source_sightings WHERE story_id = ?',
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
        @publishedPrecision, @activityAt, @firstSeenAt, @lastSeenAt, @raw, 'live',
        @verifiedAt, @isPrimary)`,
  );
  const updateSighting = db.prepare(
    `UPDATE source_sightings SET
       type = @type,
       source_url = @sourceUrl,
       discussion_url = @discussionUrl,
       title = @title,
       summary = @summary,
       author = @author,
       tags = @tags,
       score_kind = @scoreKind,
       score = @score,
       comments_count = @commentsCount,
       published_at = @publishedAt,
       published_precision = @publishedPrecision,
       activity_at = @activityAt,
       last_seen_at = @lastSeenAt,
       raw = @raw,
       quality = 'live',
       verified_at = @verifiedAt
     WHERE id = @id
       AND julianday(@lastSeenAt) >= julianday(last_seen_at)`,
  );
  const promoteLegacySighting = db.prepare(
    `UPDATE source_sightings SET
       id = @id,
       source_key = @sourceKey,
       type = @type,
       source_url = @sourceUrl,
       discussion_url = @discussionUrl,
       title = @title,
       summary = @summary,
       author = @author,
       tags = @tags,
       score_kind = @scoreKind,
       score = @score,
       comments_count = @commentsCount,
       published_at = @publishedAt,
       published_precision = @publishedPrecision,
       activity_at = @activityAt,
       last_seen_at = @lastSeenAt,
       raw = @raw,
       quality = 'live',
       verified_at = @verifiedAt
     WHERE id = @previousId`,
  );
  const upsertSnapshot = db.prepare(
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

  const tx = db.transaction((list: LiveSightingInput[]) => {
    let created = 0;
    const sightingIds: string[] = [];
    const affectedStoryIds = new Set<string>();

    for (const input of list) {
      const existing = findExistingSighting.get(input.source, input.sourceKey) as
        { id: string; story_id: string } | undefined;
      const values = {
        id: existing?.id ?? sightingId(input.source, input.sourceKey),
        source: input.source,
        sourceKey: input.sourceKey,
        type: input.type,
        sourceUrl: input.url,
        discussionUrl: input.discussionUrl,
        title: input.title,
        summary: input.summary,
        author: input.author,
        tags: JSON.stringify(input.tags),
        scoreKind: input.scoreKind,
        score: input.score,
        commentsCount: input.commentsCount,
        publishedAt: input.publishedAt ?? observedAtIso,
        publishedPrecision: input.publishedPrecision,
        activityAt: input.activityAt,
        lastSeenAt: observedAtIso,
        raw: input.raw == null ? null : JSON.stringify(input.raw),
        verifiedAt: observedAtIso,
      };

      if (existing !== undefined) {
        updateSighting.run(values);
        upsertSnapshot.run({
          sightingId: existing.id,
          bucketAt: floorToUtcHour(observedAtIso),
          observedAt: observedAtIso,
          score: input.score,
          commentsCount: input.commentsCount,
        });
        sightingIds.push(existing.id);
        affectedStoryIds.add(existing.story_id);
        continue;
      }

      const canonicalUrl = canonicalizeUrl(input.url);
      let story = findStory.get(canonicalUrl) as { id: string } | undefined;
      if (story === undefined) {
        story = { id: itemId(canonicalUrl) };
        insertStory.run({
          id: story.id,
          source: input.source,
          type: input.type,
          title: input.title,
          url: input.url,
          canonicalUrl,
          summary: input.summary,
          author: input.author,
          score: input.score,
          commentsCount: input.commentsCount,
          tags: values.tags,
          publishedAt: values.publishedAt,
          firstSeenAt: observedAtIso,
          lastSeenAt: observedAtIso,
          raw: values.raw,
        });
        created++;
      }

      const legacyCandidates = findSameSourceLegacy.all(story.id, input.source) as {
        id: string;
      }[];
      if (legacyCandidates.length === 1) {
        promoteLegacySighting.run({
          ...values,
          previousId: legacyCandidates[0]!.id,
        });
        upsertSnapshot.run({
          sightingId: values.id,
          bucketAt: floorToUtcHour(observedAtIso),
          observedAt: observedAtIso,
          score: input.score,
          commentsCount: input.commentsCount,
        });
        sightingIds.push(values.id);
        affectedStoryIds.add(story.id);
        continue;
      }

      const existingCount = countSightings.get(story.id) as { count: number };
      insertSighting.run({
        ...values,
        storyId: story.id,
        firstSeenAt: observedAtIso,
        isPrimary: existingCount.count === 0 ? 1 : 0,
      });
      upsertSnapshot.run({
        sightingId: values.id,
        bucketAt: floorToUtcHour(observedAtIso),
        observedAt: observedAtIso,
        score: input.score,
        commentsCount: input.commentsCount,
      });
      sightingIds.push(values.id);
      affectedStoryIds.add(story.id);
    }

    for (const storyId of affectedStoryIds) recomputeStoryPrimary(db, storyId);

    return { created, sightingIds };
  });

  const result = tx(normalizedInputs);
  return { found: inputs.length, created: result.created, sightingIds: result.sightingIds };
}

/** Story에 연결된 모든 Sighting을 원천 identity 순서로 조회한다. */
export function getSightingsByStory(db: DB, storyId: string): SourceSighting[] {
  const rows = db
    .prepare(
      `SELECT * FROM source_sightings
       WHERE story_id = ?
       ORDER BY source ASC, source_key ASC`,
    )
    .all(storyId) as SightingRow[];
  return rows.map((row) => rowToSighting(row, getMetricHistory(db, row.id)));
}

/** 안정적인 원천 identity로 Sighting 하나를 조회한다. */
export function getSightingBySourceKey(
  db: DB,
  source: string,
  sourceKey: string,
): SourceSighting | null {
  const row = db
    .prepare('SELECT * FROM source_sightings WHERE source = ? AND source_key = ?')
    .get(source, sourceKey) as SightingRow | undefined;
  return row === undefined ? null : rowToSighting(row, getMetricHistory(db, row.id));
}

/** 재관측할 소스의 Sighting을 최근 관측 우선으로 제한 조회한다. */
export function listTrackedSightings(db: DB, source: string, limit: number): SourceSighting[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0) return [];
  const rows = db
    .prepare(
      `SELECT * FROM source_sightings
       WHERE source = ?
       ORDER BY last_seen_at DESC, source_key ASC, id ASC
       LIMIT ?`,
    )
    .all(source, safeLimit) as SightingRow[];
  return rows.map((row) => rowToSighting(row, getMetricHistory(db, row.id)));
}

/** Sighting 하나를 삭제하고 남은 Story의 primary를 원자적으로 복구한다. */
export function deleteSighting(db: DB, sightingIdValue: string): boolean {
  const tx = db.transaction((id: string): boolean => {
    const row = db.prepare('SELECT story_id FROM source_sightings WHERE id = ?').get(id) as
      { story_id: string } | undefined;
    if (row === undefined) return false;

    db.prepare('DELETE FROM source_sightings WHERE id = ?').run(id);
    const remaining = db
      .prepare('SELECT COUNT(*) AS count FROM source_sightings WHERE story_id = ?')
      .get(row.story_id) as { count: number };
    if (remaining.count === 0) {
      db.prepare('DELETE FROM items WHERE id = ?').run(row.story_id);
    } else {
      recomputeStoryPrimary(db, row.story_id);
    }
    return true;
  });
  return tx(sightingIdValue);
}

/** Sighting의 시간 버킷 지표를 실제 관측 시각 오름차순으로 반환한다. */
export function getMetricHistory(db: DB, sightingIdValue: string): MetricSnapshot[] {
  const rows = db
    .prepare(
      `SELECT sighting_id, bucket_at, observed_at, score, comments_count
       FROM metric_snapshots
       WHERE sighting_id = ?
       ORDER BY observed_at ASC, bucket_at ASC`,
    )
    .all(sightingIdValue) as MetricSnapshotRow[];
  return rows.map(rowToMetricSnapshot);
}

const BASELINE_WINDOWS: Record<BaselineHorizon, { ageMs: number; toleranceMs: number }> = {
  '6h': { ageMs: 6 * 3_600_000, toleranceMs: 2 * 3_600_000 },
  '24h': { ageMs: 24 * 3_600_000, toleranceMs: 4 * 3_600_000 },
  '7d': { ageMs: 7 * 86_400_000, toleranceMs: 12 * 3_600_000 },
};

/** 목표 시각 주변의 가장 가까운 live 지표 관측을 기준점으로 반환한다. */
export function getNearestBaseline(
  db: DB,
  sightingIdValue: string,
  observedAt: string,
  horizon: BaselineHorizon,
): MetricSnapshot | null {
  const sighting = db
    .prepare('SELECT quality FROM source_sightings WHERE id = ?')
    .get(sightingIdValue) as { quality: SightingQuality } | undefined;
  if (sighting?.quality !== 'live') return null;

  const currentMs = new Date(observedAt).getTime();
  if (Number.isNaN(currentMs)) throw new Error(`Invalid observation time: ${observedAt}`);
  const window = BASELINE_WINDOWS[horizon];
  const targetMs = currentMs - window.ageMs;

  return (
    getMetricHistory(db, sightingIdValue)
      .map((snapshot) => ({ snapshot, timeMs: new Date(snapshot.observedAt).getTime() }))
      .filter(
        (candidate) =>
          !Number.isNaN(candidate.timeMs) &&
          Math.abs(candidate.timeMs - targetMs) <= window.toleranceMs,
      )
      .sort((left, right) => {
        const distance = Math.abs(left.timeMs - targetMs) - Math.abs(right.timeMs - targetMs);
        return distance !== 0 ? distance : left.timeMs - right.timeMs;
      })[0]?.snapshot ?? null
  );
}

/** 일반 Sighting snapshot 중 기준 시각에서 14일보다 오래된 행을 삭제한다. */
export function purgeMetricSnapshots(db: DB, nowIso: string = new Date().toISOString()): number {
  const nowMs = new Date(nowIso).getTime();
  if (Number.isNaN(nowMs)) throw new Error(`Invalid observation time: ${nowIso}`);
  const cutoff = new Date(nowMs - 14 * 86_400_000).toISOString();
  return db.prepare('DELETE FROM metric_snapshots WHERE observed_at < ?').run(cutoff).changes;
}
