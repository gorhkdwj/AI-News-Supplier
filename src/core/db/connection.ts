import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { getDbPath } from '../paths.js';
import { runMigrations } from './migrations.js';

export type DB = Database.Database;

/**
 * SQLite DB를 연다. 경로가 없으면 디렉터리를 만들고, WAL 등 PRAGMA를 적용한 뒤
 * 마이그레이션을 실행한다. ':memory:' 는 테스트용 인메모리 DB.
 */
export function openDb(dbPath?: string): DB {
  const path = dbPath ?? getDbPath();
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}
