import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type DB } from '../../src/core/db/connection.js';
import {
  upsertItems,
  queryRecent,
  searchItems,
  getItemById,
  countItems,
  getScoreHistory,
  purgeOld,
} from '../../src/core/store/itemStore.js';
import type { CollectedItem } from '../../src/core/types.js';

function makeItem(overrides: Partial<CollectedItem> = {}): CollectedItem {
  return {
    source: 'hackernews',
    type: 'community',
    title: 'A new AI agent framework',
    url: 'https://example.com/a',
    summary: 'about llm agents',
    author: 'alice',
    score: 10,
    commentsCount: 3,
    tags: ['ai', 'agent'],
    publishedAt: new Date().toISOString(),
    raw: { objectID: '1' },
    ...overrides,
  };
}

describe('itemStore', () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('신규 항목을 삽입하고 개수를 센다', () => {
    const res = upsertItems(db, [makeItem(), makeItem({ url: 'https://example.com/b' })]);
    expect(res.created).toBe(2);
    expect(countItems(db)).toBe(2);
  });

  it('같은 canonical URL은 중복 삽입하지 않는다(dedup)', () => {
    upsertItems(db, [makeItem()]);
    const res = upsertItems(db, [makeItem({ url: 'https://example.com/a?utm_source=x' })]);
    expect(res.created).toBe(0);
    expect(countItems(db)).toBe(1);
  });

  it('재삽입 시 first_seen_at을 보존하고 last_seen_at을 갱신한다', () => {
    upsertItems(db, [makeItem()], '2026-01-01T00:00:00.000Z');
    upsertItems(db, [makeItem({ score: 50 })], '2026-01-02T00:00:00.000Z');
    const items = queryRecent(db, { sinceHours: 24 * 365 * 100, limit: 10 });
    expect(items).toHaveLength(1);
    expect(items[0]!.firstSeenAt).toBe('2026-01-01T00:00:00.000Z');
    expect(items[0]!.lastSeenAt).toBe('2026-01-02T00:00:00.000Z');
    expect(items[0]!.score).toBe(50);
  });

  it('점수가 바뀌면 score_history에 스냅샷을 남긴다', () => {
    upsertItems(db, [makeItem({ score: 10 })], '2026-01-01T00:00:00.000Z');
    upsertItems(db, [makeItem({ score: 30 })], '2026-01-02T00:00:00.000Z');
    const id = getItemById(db, queryRecent(db, { sinceHours: 1e9, limit: 1 })[0]!.id)!.id;
    const history = getScoreHistory(db, id);
    expect(history.map((h) => h.score)).toEqual([10, 30]);
  });

  it('FTS 전문 검색이 동작한다', () => {
    upsertItems(db, [
      makeItem({ title: 'Transformer scaling laws', url: 'https://example.com/t' }),
      makeItem({ title: 'Cooking recipes', summary: 'pasta', url: 'https://example.com/c' }),
    ]);
    const hits = searchItems(db, 'transformer', { sinceDays: 3650, limit: 10 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.title).toBe('Transformer scaling laws');
  });

  it('retention purge는 오래된 항목을 지운다', () => {
    upsertItems(db, [makeItem({ url: 'https://example.com/old', publishedAt: '2000-01-01T00:00:00.000Z' })]);
    upsertItems(db, [makeItem({ url: 'https://example.com/new' })]);
    const deleted = purgeOld(db, 90);
    expect(deleted).toBe(1);
    expect(countItems(db)).toBe(1);
  });
});
