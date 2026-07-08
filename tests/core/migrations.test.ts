import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, SCHEMA_VERSION } from '../../src/core/db/migrations.js';

describe('migrations', () => {
  it('빈 DB에 스키마를 적용하고 user_version을 설정한다', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toContain('items');
    expect(tables).toContain('learning_history');
  });

  it('두 번 실행해도 오류 없이 멱등하다', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });
});
