import BetterSqlite3, { type Database } from 'better-sqlite3';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { sightingId } from '../normalize.js';

/**
 * 번호형 마이그레이션. 배열 인덱스+1 이 스키마 버전이며, SQLite 내장
 * PRAGMA user_version 으로 추적한다(meta 테이블 부트스트랩 문제 회피).
 * 각 항목은 db.exec로 실행되므로 여러 statement를 포함할 수 있다.
 */
const MIGRATIONS: string[] = [
  // v1 — 초기 스키마
  `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE items (
    id             TEXT PRIMARY KEY,
    source         TEXT NOT NULL,
    type           TEXT NOT NULL CHECK (type IN
                     ('community','official_update','hot_repo','model','paper','article')),
    title          TEXT NOT NULL,
    url            TEXT NOT NULL,
    canonical_url  TEXT NOT NULL,
    summary        TEXT,
    author         TEXT,
    score          REAL,
    comments_count INTEGER,
    tags           TEXT NOT NULL DEFAULT '[]',
    published_at   TEXT,
    first_seen_at  TEXT NOT NULL,
    last_seen_at   TEXT NOT NULL,
    raw            TEXT
  );
  CREATE UNIQUE INDEX idx_items_canonical        ON items(canonical_url);
  CREATE INDEX idx_items_published               ON items(published_at DESC);
  CREATE INDEX idx_items_source_published        ON items(source, published_at DESC);
  CREATE INDEX idx_items_type_published          ON items(type, published_at DESC);

  CREATE VIRTUAL TABLE items_fts USING fts5(
    title, summary, tags,
    content='items', content_rowid='rowid',
    tokenize='porter unicode61'
  );
  CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
    INSERT INTO items_fts(rowid, title, summary, tags)
    VALUES (new.rowid, new.title, new.summary, new.tags);
  END;
  CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN
    INSERT INTO items_fts(items_fts, rowid, title, summary, tags)
    VALUES ('delete', old.rowid, old.title, old.summary, old.tags);
  END;
  CREATE TRIGGER items_au AFTER UPDATE ON items BEGIN
    INSERT INTO items_fts(items_fts, rowid, title, summary, tags)
    VALUES ('delete', old.rowid, old.title, old.summary, old.tags);
    INSERT INTO items_fts(rowid, title, summary, tags)
    VALUES (new.rowid, new.title, new.summary, new.tags);
  END;

  CREATE TABLE score_history (
    item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    observed_at TEXT NOT NULL,
    score       REAL,
    PRIMARY KEY (item_id, observed_at)
  ) WITHOUT ROWID;

  CREATE TABLE source_state (
    source               TEXT PRIMARY KEY,
    last_attempt_at      TEXT,
    last_success_at      TEXT,
    etag                 TEXT,
    last_modified        TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    last_error           TEXT
  );

  CREATE TABLE fetch_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL CHECK (status IN ('ok','error','not_modified','skipped')),
    items_found INTEGER NOT NULL DEFAULT 0,
    items_new   INTEGER NOT NULL DEFAULT 0,
    error       TEXT
  );
  CREATE INDEX idx_fetch_log_source ON fetch_log(source, started_at DESC);

  CREATE TABLE learning_history (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    topic            TEXT NOT NULL,
    normalized_topic TEXT NOT NULL,
    learned_at       TEXT NOT NULL,
    level            TEXT CHECK (level IN ('beginner','intermediate','advanced')),
    time_spent_min   INTEGER,
    notes            TEXT,
    item_ids         TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX idx_learning_norm ON learning_history(normalized_topic, learned_at DESC);
  `,
  // v2 — Story별 소스 관측과 시간 버킷 지표
  `
  CREATE TABLE source_sightings (
    id                  TEXT PRIMARY KEY,
    story_id            TEXT NOT NULL REFERENCES items(id) ON UPDATE CASCADE ON DELETE CASCADE,
    source              TEXT NOT NULL,
    source_key          TEXT NOT NULL,
    type                TEXT NOT NULL CHECK (type IN
                          ('community','official_update','hot_repo','model','paper','article')),
    source_url          TEXT NOT NULL,
    discussion_url      TEXT,
    title               TEXT NOT NULL,
    summary             TEXT,
    author              TEXT,
    tags                TEXT NOT NULL DEFAULT '[]',
    score_kind          TEXT,
    score               REAL,
    comments_count      INTEGER,
    published_at        TEXT,
    published_precision TEXT NOT NULL CHECK (published_precision IN
                          ('exact_time','date_only','inferred')),
    activity_at         TEXT,
    first_seen_at       TEXT NOT NULL,
    last_seen_at        TEXT NOT NULL,
    raw                 TEXT,
    quality             TEXT NOT NULL CHECK (quality IN ('live','legacy_unverified')),
    verified_at         TEXT,
    is_primary          INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
    UNIQUE (source, source_key)
  );
  CREATE INDEX idx_source_sightings_story
    ON source_sightings(story_id);
  CREATE INDEX idx_source_sightings_type_published
    ON source_sightings(type, published_at DESC);
  CREATE INDEX idx_source_sightings_source_published
    ON source_sightings(source, published_at DESC);
  CREATE INDEX idx_source_sightings_type_activity
    ON source_sightings(type, activity_at DESC);
  CREATE UNIQUE INDEX idx_source_sightings_primary
    ON source_sightings(story_id) WHERE is_primary = 1;

  CREATE TABLE metric_snapshots (
    sighting_id    TEXT NOT NULL REFERENCES source_sightings(id)
                   ON UPDATE CASCADE ON DELETE CASCADE,
    bucket_at      TEXT NOT NULL,
    observed_at    TEXT NOT NULL,
    score          REAL,
    comments_count INTEGER,
    PRIMARY KEY (sighting_id, bucket_at)
  ) WITHOUT ROWID;
  CREATE INDEX idx_metric_snapshots_observed
    ON metric_snapshots(sighting_id, observed_at DESC);
  `,
];

interface LegacyItemRow {
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

function parseLegacyRaw(raw: string | null): Record<string, unknown> {
  if (raw == null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function sourceKeyPart(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function legacySourceKey(raw: Record<string, unknown>, canonicalUrl: string): string {
  const objectId = sourceKeyPart(raw['objectID']);
  if (objectId !== null) return objectId;
  const id = sourceKeyPart(raw['id']);
  if (id !== null) return id;
  const permalink = sourceKeyPart(raw['permalink']);
  if (permalink !== null) return permalink;
  const feedId = sourceKeyPart(raw['feedId']);
  if (feedId !== null) return `${feedId}:${canonicalUrl}`;
  return canonicalUrl;
}

function assertNoDuplicateLegacySourceKeys(db: Database): void {
  const rows = db
    .prepare('SELECT id, source, canonical_url, raw FROM items ORDER BY rowid')
    .all() as Pick<LegacyItemRow, 'id' | 'source' | 'canonical_url' | 'raw'>[];
  const seen = new Map<string, { source: string; sourceKey: string; storyId: string }>();
  for (const row of rows) {
    const sourceKey = legacySourceKey(parseLegacyRaw(row.raw), row.canonical_url);
    const identity = `${row.source}\0${sourceKey}`;
    const previous = seen.get(identity);
    if (previous !== undefined) {
      throw new Error(
        `Duplicate legacy source identity: source=${JSON.stringify(row.source)}, ` +
          `source_key=${JSON.stringify(sourceKey)}, ` +
          `story_ids=${JSON.stringify(previous.storyId)},${JSON.stringify(row.id)}`,
      );
    }
    seen.set(identity, { source: row.source, sourceKey, storyId: row.id });
  }
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

function backfillLegacySightings(db: Database): void {
  const rows = db.prepare('SELECT * FROM items ORDER BY rowid').all() as LegacyItemRow[];
  const insert = db.prepare(
    `INSERT INTO source_sightings
       (id, story_id, source, source_key, type, source_url, discussion_url, title,
        summary, author, tags, score_kind, score, comments_count, published_at,
        published_precision, activity_at, first_seen_at, last_seen_at, raw, quality,
        verified_at, is_primary)
     VALUES
       (@id, @storyId, @source, @sourceKey, @type, @sourceUrl, @discussionUrl, @title,
        @summary, @author, @tags, @scoreKind, @score, @commentsCount, @publishedAt,
        'inferred', @activityAt, @firstSeenAt, @lastSeenAt, @raw, 'legacy_unverified',
        NULL, 1)`,
  );

  for (const row of rows) {
    const raw = parseLegacyRaw(row.raw);
    const sourceKey = legacySourceKey(raw, row.canonical_url);
    insert.run({
      id: sightingId(row.source, sourceKey),
      storyId: row.id,
      source: row.source,
      sourceKey,
      type: row.type,
      sourceUrl: row.url,
      discussionUrl: legacyDiscussionUrl(row.source, raw),
      title: row.title,
      summary: row.summary,
      author: row.author,
      tags: row.tags,
      scoreKind: legacyScoreKind(row.source),
      score: row.score,
      commentsCount: row.comments_count,
      publishedAt: row.published_at,
      activityAt: row.source === 'github' ? sourceKeyPart(raw['pushed_at']) : null,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      raw: row.raw,
    });
  }
}

interface LegacyStateSnapshot {
  items: string;
  ftsRows: string;
  ftsMatches: string;
  ftsTriggers: string;
  scoreHistory: string;
  sourceState: string;
  fetchLog: string;
  learningHistory: string;
}

function serializeSnapshot(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}

function serializedRows(db: Database, sql: string): string {
  return serializeSnapshot(db.prepare(sql).all());
}

function captureFtsMatches(db: Database): string {
  const rows = db.prepare('SELECT title, summary, tags FROM items ORDER BY rowid').all() as {
    title: string;
    summary: string | null;
    tags: string;
  }[];
  const terms = new Set<string>();
  for (const row of rows) {
    const term = `${row.title} ${row.summary ?? ''} ${row.tags}`.match(/[\p{L}\p{N}]+/u)?.[0];
    if (term !== undefined) terms.add(term);
  }

  const match = db
    .prepare('SELECT rowid FROM items_fts WHERE items_fts MATCH ? ORDER BY rowid')
    .pluck();
  return serializeSnapshot(
    [...terms]
      .sort()
      .map((term) => ({ term, rowids: match.all(`"${term}"`) as (number | bigint)[] })),
  );
}

function captureLegacyState(db: Database): LegacyStateSnapshot {
  return {
    items: serializedRows(db, 'SELECT rowid, * FROM items ORDER BY rowid'),
    ftsRows: serializedRows(db, 'SELECT rowid, title, summary, tags FROM items_fts ORDER BY rowid'),
    ftsMatches: captureFtsMatches(db),
    ftsTriggers: serializedRows(
      db,
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'items' ORDER BY name",
    ),
    scoreHistory: serializedRows(db, 'SELECT * FROM score_history ORDER BY item_id, observed_at'),
    sourceState: serializedRows(db, 'SELECT * FROM source_state ORDER BY source'),
    fetchLog: serializedRows(db, 'SELECT * FROM fetch_log ORDER BY id'),
    learningHistory: serializedRows(db, 'SELECT * FROM learning_history ORDER BY id'),
  };
}

function assertLegacyStateUnchanged(
  expected: LegacyStateSnapshot,
  actual: LegacyStateSnapshot,
  context: string,
): void {
  for (const key of Object.keys(expected) as (keyof LegacyStateSnapshot)[]) {
    if (actual[key] !== expected[key]) {
      throw new Error(`Schema v2 invariant failed: ${context} changed ${key}`);
    }
  }
}

function scalarCount(db: Database, sql: string): number {
  return db.prepare(sql).pluck().get() as number;
}

function assertV2Invariants(db: Database, legacyState: LegacyStateSnapshot | null): void {
  if (legacyState !== null) {
    assertLegacyStateUnchanged(legacyState, captureLegacyState(db), 'migration');
  }

  const itemCount = scalarCount(db, 'SELECT COUNT(*) FROM items');
  const sightingCount = scalarCount(db, 'SELECT COUNT(*) FROM source_sightings');
  const primaryCount = scalarCount(
    db,
    'SELECT COUNT(*) FROM source_sightings WHERE is_primary = 1',
  );
  if (sightingCount !== itemCount || primaryCount !== itemCount) {
    throw new Error(
      `Schema v2 invariant failed: items=${itemCount}, sightings=${sightingCount}, primary=${primaryCount}`,
    );
  }

  const foreignKeyViolations = db.pragma('foreign_key_check') as unknown[];
  if (foreignKeyViolations.length > 0) {
    throw new Error(
      `Schema v2 invariant failed: foreign_key_check reported ${foreignKeyViolations.length} violation(s)`,
    );
  }
}

function getVersion(db: Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

function setVersion(db: Database, version: number): void {
  db.pragma(`user_version = ${version}`);
}

export interface MigrationOptions {
  dbPath?: string;
}

function databaseFilePath(db: Database, explicitPath?: string): string | null {
  if (explicitPath === ':memory:') return null;
  if (explicitPath !== undefined) return resolve(explicitPath);
  const databases = db.pragma('database_list') as { name: string; file: string }[];
  const main = databases.find((database) => database.name === 'main');
  return main?.file ? resolve(main.file) : null;
}

function backupTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '');
}

function validateV1Backup(backupPath: string, expectedState: LegacyStateSnapshot): void {
  try {
    const backup = new BetterSqlite3(backupPath, { readonly: true, fileMustExist: true });
    try {
      const integrity = backup.pragma('integrity_check', { simple: true }) as string;
      if (integrity !== 'ok') throw new Error(`integrity_check returned ${integrity}`);
      const version = backup.pragma('user_version', { simple: true }) as number;
      if (version !== 1) throw new Error(`expected user_version 1, received ${version}`);
      assertLegacyStateUnchanged(expectedState, captureLegacyState(backup), 'backup');
    } finally {
      backup.close();
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to validate pre-v2 backup at ${backupPath}: ${detail}`, {
      cause: error,
    });
  }
}

function backupV1Database(db: Database, dbPath: string): void {
  const parsed = parse(dbPath);
  const backupPath = join(
    dirname(dbPath),
    `${parsed.name}.pre-v2.${backupTimestamp(new Date())}.bak`,
  );
  const temporaryPath = `${backupPath}.tmp`;
  const expectedState = captureLegacyState(db);
  if (existsSync(backupPath) || existsSync(temporaryPath)) {
    throw new Error(`Failed to create pre-v2 backup at ${backupPath}: output file already exists`);
  }
  try {
    db.prepare('VACUUM INTO ?').run(temporaryPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create pre-v2 backup at ${backupPath}: ${detail}`, { cause: error });
  }
  try {
    validateV1Backup(temporaryPath, expectedState);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
  try {
    renameSync(temporaryPath, backupPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create pre-v2 backup at ${backupPath}: ${detail}`, { cause: error });
  }
}

/** 미적용 마이그레이션을 트랜잭션으로 순서대로 적용한다. 멱등하다. */
export function runMigrations(db: Database, options: MigrationOptions = {}): void {
  const current = getVersion(db);
  if (current > MIGRATIONS.length) {
    throw new Error(
      `Unsupported database schema version ${current}; maximum supported version is ${MIGRATIONS.length}`,
    );
  }
  if (current === MIGRATIONS.length) return;

  const dbPath = databaseFilePath(db, options.dbPath);
  if (current === 1 && dbPath !== null) backupV1Database(db, dbPath);

  const apply = db.transaction(() => {
    const legacyState = current === 1 ? captureLegacyState(db) : null;
    for (let i = current; i < MIGRATIONS.length; i++) {
      if (i === 1) assertNoDuplicateLegacySourceKeys(db);
      db.exec(MIGRATIONS[i] as string);
      if (i === 1) backfillLegacySightings(db);
    }
    assertV2Invariants(db, legacyState);
    setVersion(db, MIGRATIONS.length);
  });
  apply();
}

export const SCHEMA_VERSION = MIGRATIONS.length;
