import type { Database } from 'better-sqlite3';

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
];

function getVersion(db: Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

function setVersion(db: Database, version: number): void {
  db.pragma(`user_version = ${version}`);
}

/** 미적용 마이그레이션을 트랜잭션으로 순서대로 적용한다. 멱등하다. */
export function runMigrations(db: Database): void {
  const current = getVersion(db);
  if (current >= MIGRATIONS.length) return;

  const apply = db.transaction(() => {
    for (let i = current; i < MIGRATIONS.length; i++) {
      db.exec(MIGRATIONS[i] as string);
    }
    setVersion(db, MIGRATIONS.length);
  });
  apply();
}

export const SCHEMA_VERSION = MIGRATIONS.length;
