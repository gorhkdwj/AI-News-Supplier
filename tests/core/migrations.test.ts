import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { openDb } from '../../src/core/db/connection.js';
import { runMigrations, SCHEMA_VERSION } from '../../src/core/db/migrations.js';
import * as normalize from '../../src/core/normalize.js';

const tempDirs: string[] = [];
const V1_SCHEMA_SQL = readFileSync(new URL('../fixtures/schema-v1.sql', import.meta.url), 'utf8');

function makeTempDir(): string {
  const outDir = join(process.cwd(), 'out');
  mkdirSync(outDir, { recursive: true });
  const dir = mkdtempSync(join(outDir, 'migration-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.useRealTimers();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface LegacyItemSeed {
  rowid: number;
  id: string;
  source: string;
  type: string;
  title: string;
  url: string;
  canonicalUrl: string;
  summary: string | null;
  author: string | null;
  score: number | null;
  commentsCount: number | null;
  tags: string;
  publishedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  raw: string | null;
}

function createV1Db(): Database.Database {
  const db = new Database(':memory:');
  db.exec(V1_SCHEMA_SQL);
  db.pragma('foreign_keys = ON');
  return db;
}

function createV1File(dbPath: string, item?: LegacyItemSeed): void {
  const db = new Database(dbPath);
  db.exec(V1_SCHEMA_SQL);
  if (item) insertLegacyItem(db, item);
  db.close();
}

function insertLegacyItem(db: Database.Database, item: LegacyItemSeed): void {
  db.prepare(
    `INSERT INTO items
       (rowid, id, source, type, title, url, canonical_url, summary, author, score,
        comments_count, tags, published_at, first_seen_at, last_seen_at, raw)
     VALUES
       (@rowid, @id, @source, @type, @title, @url, @canonicalUrl, @summary, @author, @score,
        @commentsCount, @tags, @publishedAt, @firstSeenAt, @lastSeenAt, @raw)`,
  ).run(item);
}

function selectAll(db: Database.Database, table: string, orderBy: string): unknown[] {
  return db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all();
}

describe('sightingId', () => {
  it('source와 source key를 NUL로 구분해 SHA-256 앞 24자리로 만든다', () => {
    expect('sightingId' in normalize).toBe(true);
    const sightingId = (
      normalize as typeof normalize & {
        sightingId(source: string, sourceKey: string): string;
      }
    ).sightingId;

    expect(sightingId('hackernews', '42')).toBe('6a8a6a1a66bb72f210243b80');
  });
});

describe('migrations', () => {
  it('빈 DB에 v2 Sighting과 metric snapshot 스키마를 적용한다', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(SCHEMA_VERSION).toBe(2);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toContain('items');
    expect(tables).toContain('learning_history');
    expect(tables).toContain('source_sightings');
    expect(tables).toContain('metric_snapshots');

    const sightingColumns = (db.pragma("table_info('source_sightings')") as { name: string }[]).map(
      (column) => column.name,
    );
    expect(sightingColumns).toEqual([
      'id',
      'story_id',
      'source',
      'source_key',
      'type',
      'source_url',
      'discussion_url',
      'title',
      'summary',
      'author',
      'tags',
      'score_kind',
      'score',
      'comments_count',
      'published_at',
      'published_precision',
      'activity_at',
      'first_seen_at',
      'last_seen_at',
      'raw',
      'quality',
      'verified_at',
      'is_primary',
    ]);

    const sightingIndexes = (db.pragma("index_list('source_sightings')") as { name: string }[]).map(
      (index) => index.name,
    );
    expect(sightingIndexes).toEqual(
      expect.arrayContaining([
        'idx_source_sightings_story',
        'idx_source_sightings_type_published',
        'idx_source_sightings_source_published',
        'idx_source_sightings_type_activity',
        'idx_source_sightings_primary',
      ]),
    );

    const sightingForeignKeys = db.pragma("foreign_key_list('source_sightings')") as {
      table: string;
      from: string;
      to: string;
      on_update: string;
      on_delete: string;
    }[];
    expect(sightingForeignKeys).toEqual([
      expect.objectContaining({
        table: 'items',
        from: 'story_id',
        to: 'id',
        on_update: 'CASCADE',
        on_delete: 'CASCADE',
      }),
    ]);

    const metricColumns = (
      db.pragma("table_info('metric_snapshots')") as {
        name: string;
        pk: number;
      }[]
    ).map(({ name, pk }) => ({ name, pk }));
    expect(metricColumns).toEqual([
      { name: 'sighting_id', pk: 1 },
      { name: 'bucket_at', pk: 2 },
      { name: 'observed_at', pk: 0 },
      { name: 'score', pk: 0 },
      { name: 'comments_count', pk: 0 },
    ]);
    const metricTableSql = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'metric_snapshots'")
      .pluck()
      .get() as string;
    expect(metricTableSql).toMatch(/WITHOUT ROWID/i);
    expect(
      (db.pragma("index_list('metric_snapshots')") as { name: string }[]).map(
        (index) => index.name,
      ),
    ).toContain('idx_metric_snapshots_observed');
    expect(db.pragma("foreign_key_list('metric_snapshots')")).toEqual([
      expect.objectContaining({
        table: 'source_sightings',
        from: 'sighting_id',
        to: 'id',
        on_update: 'CASCADE',
        on_delete: 'CASCADE',
      }),
    ]);

    db.close();
  });

  it('v1 데이터를 보존하고 item마다 legacy primary Sighting을 백필한다', () => {
    const db = createV1Db();
    const items: LegacyItemSeed[] = [
      {
        rowid: 11,
        id: '1111111111111111',
        source: 'hackernews',
        type: 'community',
        title: 'Legacy Neural HN story',
        url: 'https://example.com/hn?utm_source=legacy',
        canonicalUrl: 'https://example.com/hn',
        summary: 'HN summary',
        author: 'alice',
        score: 123,
        commentsCount: 45,
        tags: '["ai","hn"]',
        publishedAt: '2026-07-01T01:02:03.000Z',
        firstSeenAt: '2026-07-01T02:00:00.000Z',
        lastSeenAt: '2026-07-02T02:00:00.000Z',
        raw: '{"objectID":"42","id":"ignored","points":123}',
      },
      {
        rowid: 22,
        id: '2222222222222222',
        source: 'reddit',
        type: 'community',
        title: 'Legacy Reddit story',
        url: 'https://example.com/reddit',
        canonicalUrl: 'https://example.com/reddit',
        summary: null,
        author: 'bob',
        score: 0,
        commentsCount: 0,
        tags: '["r/LocalLLaMA"]',
        publishedAt: '2026-07-02T03:00:00.000Z',
        firstSeenAt: '2026-07-02T03:10:00.000Z',
        lastSeenAt: '2026-07-02T03:20:00.000Z',
        raw: '{"permalink":"/r/LocalLLaMA/comments/abc123/a_post/"}',
      },
      {
        rowid: 33,
        id: '3333333333333333',
        source: 'devto',
        type: 'article',
        title: 'Legacy DEV story',
        url: 'https://dev.to/example/legacy',
        canonicalUrl: 'https://dev.to/example/legacy',
        summary: 'DEV summary',
        author: 'carol',
        score: 17,
        commentsCount: 3,
        tags: '["ai"]',
        publishedAt: '2026-07-03T00:00:00.000Z',
        firstSeenAt: '2026-07-03T01:00:00.000Z',
        lastSeenAt: '2026-07-03T02:00:00.000Z',
        raw: '{"id":987}',
      },
      {
        rowid: 44,
        id: '4444444444444444',
        source: 'github',
        type: 'hot_repo',
        title: 'legacy/repository',
        url: 'https://github.com/legacy/repository',
        canonicalUrl: 'https://github.com/legacy/repository',
        summary: 'Repository summary',
        author: 'legacy',
        score: 500,
        commentsCount: null,
        tags: '["llm"]',
        publishedAt: '2026-06-20T00:00:00.000Z',
        firstSeenAt: '2026-07-04T00:00:00.000Z',
        lastSeenAt: '2026-07-05T00:00:00.000Z',
        raw: '{"pushed_at":"2026-07-08T12:00:00.000Z","stars":500}',
      },
      {
        rowid: 55,
        id: '5555555555555555',
        source: 'rss:openai',
        type: 'official_update',
        title: 'Legacy RSS update',
        url: 'https://openai.com/news/legacy',
        canonicalUrl: 'https://openai.com/news/legacy',
        summary: 'Official summary',
        author: null,
        score: null,
        commentsCount: null,
        tags: '["openai"]',
        publishedAt: '2026-07-05T00:00:00.000Z',
        firstSeenAt: '2026-07-05T01:00:00.000Z',
        lastSeenAt: '2026-07-05T02:00:00.000Z',
        raw: '{"feedId":"openai"}',
      },
      {
        rowid: 66,
        id: '6666666666666666',
        source: 'arxiv',
        type: 'paper',
        title: 'Legacy paper without raw identity',
        url: 'https://arxiv.org/abs/2607.00001',
        canonicalUrl: 'https://arxiv.org/abs/2607.00001',
        summary: 'Paper summary',
        author: 'Dana',
        score: null,
        commentsCount: null,
        tags: '["cs.AI"]',
        publishedAt: null,
        firstSeenAt: '2026-07-06T01:00:00.000Z',
        lastSeenAt: '2026-07-06T02:00:00.000Z',
        raw: null,
      },
    ];
    for (const item of items) insertLegacyItem(db, item);

    db.prepare('INSERT INTO score_history (item_id, observed_at, score) VALUES (?, ?, ?)').run(
      items[0]?.id,
      '2026-07-02T00:00:00.000Z',
      123,
    );
    db.prepare(
      `INSERT INTO source_state
         (source, last_attempt_at, last_success_at, etag, last_modified, consecutive_failures, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('hackernews', 'attempt', 'success', 'etag-value', 'modified-value', 0, null);
    db.prepare(
      `INSERT INTO fetch_log
         (id, source, started_at, finished_at, status, items_found, items_new, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(7, 'hackernews', 'start', 'finish', 'ok', 6, 6, null);
    const learningItemIds = JSON.stringify([items[0]?.id, items[3]?.id]);
    db.prepare(
      `INSERT INTO learning_history
         (id, topic, normalized_topic, learned_at, level, time_spent_min, notes, item_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      9,
      'Legacy AI',
      'legacy ai',
      '2026-07-09T00:00:00.000Z',
      'beginner',
      30,
      'notes',
      learningItemIds,
    );

    const before = {
      items: db.prepare('SELECT rowid, * FROM items ORDER BY rowid').all(),
      itemSchema: db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'items'")
        .pluck()
        .get(),
      ftsRows: db.prepare('SELECT rowid, title, summary, tags FROM items_fts ORDER BY rowid').all(),
      ftsMatch: db
        .prepare(
          `SELECT items.id, items.rowid FROM items_fts
           JOIN items ON items.rowid = items_fts.rowid
           WHERE items_fts MATCH 'neural'
           ORDER BY items.rowid`,
        )
        .all(),
      ftsTriggers: db
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'items' ORDER BY name",
        )
        .all(),
      scoreHistory: selectAll(db, 'score_history', 'item_id, observed_at'),
      sourceState: selectAll(db, 'source_state', 'source'),
      fetchLog: selectAll(db, 'fetch_log', 'id'),
      learningHistory: selectAll(db, 'learning_history', 'id'),
    };

    runMigrations(db);

    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(db.prepare('SELECT rowid, * FROM items ORDER BY rowid').all()).toEqual(before.items);
    expect(
      db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'items'")
        .pluck()
        .get(),
    ).toBe(before.itemSchema);
    expect(
      db.prepare('SELECT rowid, title, summary, tags FROM items_fts ORDER BY rowid').all(),
    ).toEqual(before.ftsRows);
    expect(
      db
        .prepare(
          `SELECT items.id, items.rowid FROM items_fts
           JOIN items ON items.rowid = items_fts.rowid
           WHERE items_fts MATCH 'neural'
           ORDER BY items.rowid`,
        )
        .all(),
    ).toEqual(before.ftsMatch);
    expect(
      db
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'items' ORDER BY name",
        )
        .all(),
    ).toEqual(before.ftsTriggers);
    expect(selectAll(db, 'score_history', 'item_id, observed_at')).toEqual(before.scoreHistory);
    expect(selectAll(db, 'source_state', 'source')).toEqual(before.sourceState);
    expect(selectAll(db, 'fetch_log', 'id')).toEqual(before.fetchLog);
    expect(selectAll(db, 'learning_history', 'id')).toEqual(before.learningHistory);

    const sightings = db
      .prepare('SELECT * FROM source_sightings ORDER BY story_id')
      .all() as Record<string, unknown>[];
    expect(sightings).toHaveLength(items.length);
    expect(sightings).toEqual([
      expect.objectContaining({
        id: normalize.sightingId('hackernews', '42'),
        story_id: items[0]?.id,
        source_key: '42',
        source_url: items[0]?.url,
        discussion_url: 'https://news.ycombinator.com/item?id=42',
        score_kind: 'points',
        published_precision: 'inferred',
        activity_at: null,
        quality: 'legacy_unverified',
        verified_at: null,
        is_primary: 1,
        raw: items[0]?.raw,
      }),
      expect.objectContaining({
        id: normalize.sightingId('reddit', '/r/LocalLLaMA/comments/abc123/a_post/'),
        story_id: items[1]?.id,
        source_key: '/r/LocalLLaMA/comments/abc123/a_post/',
        discussion_url: 'https://www.reddit.com/r/LocalLLaMA/comments/abc123/a_post/',
        score_kind: 'upvotes',
        published_precision: 'inferred',
      }),
      expect.objectContaining({
        id: normalize.sightingId('devto', '987'),
        story_id: items[2]?.id,
        source_key: '987',
        score_kind: 'reactions',
        published_precision: 'inferred',
      }),
      expect.objectContaining({
        id: normalize.sightingId('github', items[3]?.canonicalUrl ?? ''),
        story_id: items[3]?.id,
        source_key: items[3]?.canonicalUrl,
        score_kind: 'stars',
        activity_at: '2026-07-08T12:00:00.000Z',
        published_precision: 'inferred',
      }),
      expect.objectContaining({
        id: normalize.sightingId('rss:openai', `openai:${items[4]?.canonicalUrl}`),
        story_id: items[4]?.id,
        source_key: `openai:${items[4]?.canonicalUrl}`,
        score_kind: null,
        published_precision: 'inferred',
      }),
      expect.objectContaining({
        id: normalize.sightingId('arxiv', items[5]?.canonicalUrl ?? ''),
        story_id: items[5]?.id,
        source_key: items[5]?.canonicalUrl,
        score_kind: null,
        published_precision: 'inferred',
      }),
    ]);
    expect(db.prepare('SELECT COUNT(*) FROM metric_snapshots').pluck().get()).toBe(0);
    expect(
      db
        .prepare(
          `SELECT COUNT(*) FROM (
             SELECT story_id FROM source_sightings WHERE is_primary = 1 GROUP BY story_id
           )`,
        )
        .pluck()
        .get(),
    ).toBe(items.length);
    expect(db.pragma('foreign_key_check')).toEqual([]);

    db.exec('BEGIN');
    db.prepare('UPDATE items SET title = ? WHERE id = ?').run(
      'Migrated trigger sentinel',
      items[0]?.id,
    );
    expect(
      db
        .prepare(
          `SELECT items.id FROM items_fts
           JOIN items ON items.rowid = items_fts.rowid
           WHERE items_fts MATCH 'sentinel'`,
        )
        .pluck()
        .all(),
    ).toEqual([items[0]?.id]);
    db.exec('ROLLBACK');
    db.close();
  });

  it('두 번 실행해도 오류 없이 멱등하다', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('파일 v1 DB를 v2 DDL 전에 sibling VACUUM 백업한다', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'data.db');
    const item: LegacyItemSeed = {
      rowid: 71,
      id: '7777777777777777',
      source: 'hackernews',
      type: 'community',
      title: 'Backup sentinel story',
      url: 'https://example.com/backup',
      canonicalUrl: 'https://example.com/backup',
      summary: 'must survive in backup',
      author: null,
      score: 10,
      commentsCount: 2,
      tags: '[]',
      publishedAt: '2026-07-01T00:00:00.000Z',
      firstSeenAt: '2026-07-01T00:01:00.000Z',
      lastSeenAt: '2026-07-01T00:02:00.000Z',
      raw: '{"objectID":"backup-71"}',
    };
    createV1File(dbPath, item);
    const secondItem: LegacyItemSeed = {
      ...item,
      rowid: 701,
      id: '7070707070707070',
      source: 'github',
      type: 'hot_repo',
      title: 'Backup gapped rowid repository',
      url: 'https://example.com/backup-gap',
      canonicalUrl: 'https://example.com/backup-gap',
      score: 20,
      commentsCount: null,
      raw: '{"pushed_at":"2026-07-09T00:00:00.000Z"}',
    };
    const seed = new Database(dbPath);
    insertLegacyItem(seed, secondItem);
    seed
      .prepare('INSERT INTO score_history (item_id, observed_at, score) VALUES (?, ?, ?)')
      .run(item.id, '2026-07-01T00:03:00.000Z', item.score);
    seed
      .prepare(
        `INSERT INTO source_state
           (source, last_attempt_at, last_success_at, consecutive_failures)
         VALUES (?, ?, ?, ?)`,
      )
      .run('hackernews', 'attempt', 'success', 0);
    seed
      .prepare(
        `INSERT INTO fetch_log
           (id, source, started_at, finished_at, status, items_found, items_new)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(17, 'hackernews', 'start', 'finish', 'ok', 2, 2);
    seed
      .prepare(
        `INSERT INTO learning_history
           (id, topic, normalized_topic, learned_at, item_ids)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        19,
        'Backup topic',
        'backup topic',
        '2026-07-01T00:04:00.000Z',
        JSON.stringify([item.id]),
      );
    const expectedBackupFts = seed
      .prepare(
        `SELECT items.id, items.rowid FROM items_fts
         JOIN items ON items.rowid = items_fts.rowid
         WHERE items_fts MATCH 'backup'
         ORDER BY items.rowid`,
      )
      .all();
    seed.close();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T01:02:03.456Z'));

    const backupPath = join(dir, 'data.pre-v2.20260710T010203456Z.bak');
    const migrated = openDb(dbPath);
    try {
      expect(existsSync(backupPath)).toBe(true);
      const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
      try {
        expect(migrated.pragma('user_version', { simple: true })).toBe(2);
        expect(backup.pragma('user_version', { simple: true })).toBe(1);
        expect(backup.prepare('SELECT rowid, id, title FROM items ORDER BY rowid').all()).toEqual([
          { rowid: item.rowid, id: item.id, title: item.title },
          { rowid: secondItem.rowid, id: secondItem.id, title: secondItem.title },
        ]);
        expect(
          backup
            .prepare(
              `SELECT items.id, items.rowid FROM items_fts
               JOIN items ON items.rowid = items_fts.rowid
               WHERE items_fts MATCH 'backup'
               ORDER BY items.rowid`,
            )
            .all(),
        ).toEqual(expectedBackupFts);
        expect(selectAll(backup, 'score_history', 'item_id, observed_at')).toEqual([
          { item_id: item.id, observed_at: '2026-07-01T00:03:00.000Z', score: item.score },
        ]);
        expect(selectAll(backup, 'source_state', 'source')).toHaveLength(1);
        expect(selectAll(backup, 'fetch_log', 'id')).toHaveLength(1);
        expect(selectAll(backup, 'learning_history', 'id')).toEqual([
          expect.objectContaining({ id: 19, item_ids: JSON.stringify([item.id]) }),
        ]);
        expect(
          backup
            .prepare(
              "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'source_sightings'",
            )
            .pluck()
            .get(),
        ).toBe(0);
      } finally {
        backup.close();
      }
    } finally {
      migrated.close();
    }
  });

  it('새 빈 파일 DB는 pre-v2 백업 없이 v2로 직접 생성한다', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'fresh.db');
    const db = openDb(dbPath);
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(2);
      expect(readdirSync(dir).filter((name) => name.includes('.pre-v2.'))).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('v1 백업 실패 시 v2 스키마를 적용하지 않고 중단한다', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'failure.db');
    createV1File(dbPath);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T04:05:06.789Z'));
    const occupiedBackupPath = join(dir, 'failure.pre-v2.20260710T040506789Z.bak');
    writeFileSync(occupiedBackupPath, 'occupied');
    const db = new Database(dbPath);
    try {
      expect(() => runMigrations(db, { dbPath })).toThrow(/Failed to create pre-v2 backup/);
      expect(db.pragma('user_version', { simple: true })).toBe(1);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'source_sightings'",
          )
          .pluck()
          .get(),
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  it('생성된 v1 백업 검증 실패 시 v2 스키마를 적용하지 않는다', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'invalid-backup.db');
    createV1File(dbPath);
    const db = new Database(dbPath);
    const originalPragma = Database.prototype.pragma;
    const pragmaSpy = vi.spyOn(Database.prototype, 'pragma').mockImplementation(function (
      this: Database.Database,
      source: string,
      options?: unknown,
    ) {
      if (source === 'integrity_check' && this.name.includes('.pre-v2.')) return 'corrupt';
      const args = options === undefined ? [source] : [source, options];
      return Reflect.apply(originalPragma, this, args) as never;
    } as typeof Database.prototype.pragma);

    try {
      expect(() => runMigrations(db, { dbPath })).toThrow(/Failed to validate pre-v2 backup/);
      expect(db.pragma('user_version', { simple: true })).toBe(1);
      expect(
        db
          .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'source_sightings'",
          )
          .pluck()
          .get(),
      ).toBe(0);
      expect(readdirSync(dir).some((name) => name.endsWith('.tmp'))).toBe(false);
    } finally {
      pragmaSpy.mockRestore();
      db.close();
    }
  });

  it('openDb는 마이그레이션 실패 시 열린 연결을 닫는다', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'open-failure.db');
    createV1File(dbPath);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T07:08:09.123Z'));
    writeFileSync(join(dir, 'open-failure.pre-v2.20260710T070809123Z.bak'), 'occupied');

    const closeSpy = vi.spyOn(Database.prototype, 'close');

    try {
      expect(() => openDb(dbPath)).toThrow(/Failed to create pre-v2 backup/);
      const closedInstances = closeSpy.mock.instances as Database.Database[];
      const closedMainDb = closedInstances.find((instance) => instance.name === dbPath);
      expect(closedMainDb).toBeDefined();
      expect(closedMainDb?.open).toBe(false);
    } finally {
      closeSpy.mockRestore();
    }
  });

  it('중복 legacy source identity를 Story ID가 포함된 오류로 거부한다', () => {
    const db = createV1Db();
    const shared = {
      source: 'hackernews',
      type: 'community',
      summary: null,
      author: null,
      score: 1,
      commentsCount: 0,
      tags: '[]',
      publishedAt: '2026-07-01T00:00:00.000Z',
      firstSeenAt: '2026-07-01T00:01:00.000Z',
      lastSeenAt: '2026-07-01T00:02:00.000Z',
      raw: '{"objectID":"duplicate-key"}',
    };
    insertLegacyItem(db, {
      ...shared,
      rowid: 81,
      id: '8888888888888888',
      title: 'First rollback sentinel',
      url: 'https://example.com/rollback/first',
      canonicalUrl: 'https://example.com/rollback/first',
    });
    insertLegacyItem(db, {
      ...shared,
      rowid: 82,
      id: '9999999999999999',
      title: 'Second rollback sentinel',
      url: 'https://example.com/rollback/second',
      canonicalUrl: 'https://example.com/rollback/second',
    });
    const beforeItems = db.prepare('SELECT rowid, * FROM items ORDER BY rowid').all();
    const beforeFts = db
      .prepare('SELECT rowid, title, summary, tags FROM items_fts ORDER BY rowid')
      .all();

    expect(() => runMigrations(db)).toThrow(
      /Duplicate legacy source identity: source="hackernews", source_key="duplicate-key", story_ids="8888888888888888","9999999999999999"/,
    );
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    expect(
      db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name IN ('source_sightings', 'metric_snapshots')`,
        )
        .all(),
    ).toEqual([]);
    expect(db.prepare('SELECT rowid, * FROM items ORDER BY rowid').all()).toEqual(beforeItems);
    expect(
      db.prepare('SELECT rowid, title, summary, tags FROM items_fts ORDER BY rowid').all(),
    ).toEqual(beforeFts);
    db.close();
  });

  it('트랜잭션 내부 불변식 검증 실패 시 v2 전체를 롤백한다', () => {
    const db = createV1Db();
    db.pragma('foreign_keys = OFF');
    db.prepare('INSERT INTO score_history (item_id, observed_at, score) VALUES (?, ?, ?)').run(
      'missing-story-id',
      '2026-07-10T08:00:00.000Z',
      1,
    );
    const beforeScoreHistory = selectAll(db, 'score_history', 'item_id, observed_at');

    expect(() => runMigrations(db)).toThrow(/foreign_key_check reported 1 violation/);
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    expect(
      db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name IN ('source_sightings', 'metric_snapshots')`,
        )
        .all(),
    ).toEqual([]);
    expect(selectAll(db, 'score_history', 'item_id, observed_at')).toEqual(beforeScoreHistory);
    db.close();
  });

  it('v2 CHECK·유일성·연쇄 외래키 제약을 적용한다', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    const story: LegacyItemSeed = {
      rowid: 91,
      id: 'aaaaaaaaaaaaaaaa',
      source: 'hackernews',
      type: 'community',
      title: 'Constraint story',
      url: 'https://example.com/constraints',
      canonicalUrl: 'https://example.com/constraints',
      summary: null,
      author: null,
      score: 1,
      commentsCount: 1,
      tags: '[]',
      publishedAt: '2026-07-01T00:00:00.000Z',
      firstSeenAt: '2026-07-01T00:01:00.000Z',
      lastSeenAt: '2026-07-01T00:02:00.000Z',
      raw: null,
    };
    insertLegacyItem(db, story);
    const insertSighting = db.prepare(
      `INSERT INTO source_sightings
         (id, story_id, source, source_key, type, source_url, title, tags,
          published_precision, first_seen_at, last_seen_at, quality, is_primary)
       VALUES
         (@id, @storyId, @source, @sourceKey, @type, @sourceUrl, @title, '[]',
          @publishedPrecision, @firstSeenAt, @lastSeenAt, @quality, @isPrimary)`,
    );
    const valid = {
      id: 'sighting-primary',
      storyId: story.id,
      source: 'hackernews',
      sourceKey: 'constraint-1',
      type: 'community',
      sourceUrl: story.url,
      title: story.title,
      publishedPrecision: 'exact_time',
      firstSeenAt: story.firstSeenAt,
      lastSeenAt: story.lastSeenAt,
      quality: 'live',
      isPrimary: 1,
    };

    expect(() => insertSighting.run({ ...valid, id: 'bad-type', type: 'unknown' })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() =>
      insertSighting.run({ ...valid, id: 'bad-precision', publishedPrecision: 'minute' }),
    ).toThrow(/CHECK constraint failed/);
    expect(() => insertSighting.run({ ...valid, id: 'bad-quality', quality: 'unknown' })).toThrow(
      /CHECK constraint failed/,
    );
    expect(() => insertSighting.run({ ...valid, id: 'bad-primary', isPrimary: 2 })).toThrow(
      /CHECK constraint failed/,
    );

    insertSighting.run(valid);
    expect(() =>
      insertSighting.run({ ...valid, id: 'duplicate-source-key', isPrimary: 0 }),
    ).toThrow(/UNIQUE constraint failed/);
    expect(() =>
      insertSighting.run({ ...valid, id: 'second-primary', sourceKey: 'constraint-2' }),
    ).toThrow(/UNIQUE constraint failed/);
    insertSighting.run({
      ...valid,
      id: 'sighting-secondary',
      source: 'reddit',
      sourceKey: 'constraint-3',
      isPrimary: 0,
    });
    db.prepare(
      `INSERT INTO metric_snapshots
         (sighting_id, bucket_at, observed_at, score, comments_count)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('sighting-primary', '2026-07-10T01:00:00.000Z', '2026-07-10T01:02:00.000Z', 1, 1);

    db.prepare('UPDATE source_sightings SET id = ? WHERE id = ?').run(
      'sighting-primary-updated',
      'sighting-primary',
    );
    expect(db.prepare('SELECT sighting_id FROM metric_snapshots').pluck().get()).toBe(
      'sighting-primary-updated',
    );
    db.prepare('UPDATE items SET id = ? WHERE id = ?').run('bbbbbbbbbbbbbbbb', story.id);
    expect(db.prepare('SELECT DISTINCT story_id FROM source_sightings').pluck().all()).toEqual([
      'bbbbbbbbbbbbbbbb',
    ]);
    db.prepare('DELETE FROM items WHERE id = ?').run('bbbbbbbbbbbbbbbb');
    expect(db.prepare('SELECT COUNT(*) FROM source_sightings').pluck().get()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM metric_snapshots').pluck().get()).toBe(0);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    db.close();
  });

  it('지원 버전보다 높은 DB를 명시적 오류로 거부한다', () => {
    const db = new Database(':memory:');
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);

    expect(() => runMigrations(db)).toThrow(
      `Unsupported database schema version ${SCHEMA_VERSION + 1}; maximum supported version is ${SCHEMA_VERSION}`,
    );
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION + 1);
    db.close();
  });
});
