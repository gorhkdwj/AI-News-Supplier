import type { DB } from '../db/connection.js';
import type { CollectedItem, ItemType, NewsItem } from '../types.js';
import { canonicalizeUrl, itemId } from '../normalize.js';
import { recomputeStoryPrimary, upsertLegacySighting } from './sightingStore.js';

interface ItemRow {
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

function rowToItem(row: ItemRow): NewsItem {
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
    tags: JSON.parse(row.tags) as string[],
    publishedAt: row.published_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    raw: row.raw != null ? JSON.parse(row.raw) : null,
  };
}

/** FTS5 MATCH 안전 쿼리로 변환한다(각 토큰을 따옴표로 감싸 특수문자 문법 오류 회피). */
function toFtsQuery(query: string, operator: 'and' | 'or'): string {
  const tokens = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"`).join(operator === 'or' ? ' OR ' : ' ');
}

export interface UpsertResult {
  found: number;
  created: number;
}

/**
 * 항목들을 canonical URL 기준으로 upsert한다. 신규는 삽입, 기존은 휘발 필드만 갱신하고
 * first_seen_at을 보존한다. 점수가 바뀌면 score_history에 스냅샷을 남긴다(항목당 최근 20개).
 */
export function upsertItems(db: DB, items: CollectedItem[], nowIso?: string): UpsertResult {
  const rawNow = nowIso ?? new Date().toISOString();
  const parsedNow = new Date(rawNow);
  if (Number.isNaN(parsedNow.getTime())) throw new Error(`Invalid observedAt: ${rawNow}`);
  const now = parsedNow.toISOString();

  const selectExisting = db.prepare('SELECT score FROM items WHERE id = ?');
  const insert = db.prepare(
    `INSERT INTO items
       (id, source, type, title, url, canonical_url, summary, author, score,
        comments_count, tags, published_at, first_seen_at, last_seen_at, raw)
     VALUES
       (@id, @source, @type, @title, @url, @canonicalUrl, @summary, @author, @score,
        @commentsCount, @tags, @publishedAt, @firstSeenAt, @lastSeenAt, @raw)`,
  );
  const update = db.prepare(
    `UPDATE items SET
       score = @score,
       comments_count = @commentsCount,
       last_seen_at = @lastSeenAt,
       summary = COALESCE(@summary, summary),
       tags = @tags,
       title = @title
     WHERE id = @id`,
  );
  const addScore = db.prepare(
    'INSERT OR REPLACE INTO score_history (item_id, observed_at, score) VALUES (?, ?, ?)',
  );
  const capScore = db.prepare(
    `DELETE FROM score_history
     WHERE item_id = ?
       AND observed_at NOT IN (
         SELECT observed_at FROM score_history WHERE item_id = ? ORDER BY observed_at DESC LIMIT 20
       )`,
  );

  const tx = db.transaction((list: CollectedItem[]): number => {
    let created = 0;
    const affectedStoryIds = new Set<string>();
    for (const it of list) {
      const canonical = canonicalizeUrl(it.url);
      const id = itemId(canonical);
      const publishedAt = it.publishedAt ?? now;
      const tags = JSON.stringify(it.tags ?? []);
      const raw = it.raw != null ? JSON.stringify(it.raw) : null;
      const existing = selectExisting.get(id) as { score: number | null } | undefined;

      if (!existing) {
        insert.run({
          id,
          source: it.source,
          type: it.type,
          title: it.title,
          url: it.url,
          canonicalUrl: canonical,
          summary: it.summary,
          author: it.author,
          score: it.score,
          commentsCount: it.commentsCount,
          tags,
          publishedAt,
          firstSeenAt: now,
          lastSeenAt: now,
          raw,
        });
        created++;
        if (it.score != null) addScore.run(id, now, it.score);
      } else {
        update.run({
          id,
          score: it.score,
          commentsCount: it.commentsCount,
          lastSeenAt: now,
          summary: it.summary,
          tags,
          title: it.title,
        });
        if (it.score != null && it.score !== existing.score) {
          addScore.run(id, now, it.score);
          capScore.run(id, id);
        }
      }
      upsertLegacySighting(db, id, canonical, it, now);
      affectedStoryIds.add(id);
    }
    for (const storyId of affectedStoryIds) recomputeStoryPrimary(db, storyId);
    return created;
  });

  const created = tx(items);
  return { found: items.length, created };
}

export interface RecentQuery {
  sinceHours: number;
  sources?: string[];
  types?: ItemType[];
  limit: number;
}

/** 조회 윈도(sinceHours) 내 항목을 최신순으로 반환한다. 랭킹은 상위 계층에서 적용. */
export function queryRecent(db: DB, opts: RecentQuery): NewsItem[] {
  const sinceIso = new Date(Date.now() - opts.sinceHours * 3600_000).toISOString();
  const conds: string[] = ['(published_at >= ? OR published_at IS NULL)'];
  const params: unknown[] = [sinceIso];

  if (opts.sources && opts.sources.length > 0) {
    conds.push(`source IN (${opts.sources.map(() => '?').join(',')})`);
    params.push(...opts.sources);
  }
  if (opts.types && opts.types.length > 0) {
    conds.push(`type IN (${opts.types.map(() => '?').join(',')})`);
    params.push(...opts.types);
  }

  const sql = `SELECT * FROM items WHERE ${conds.join(' AND ')} ORDER BY COALESCE(published_at, '') DESC LIMIT ?`;
  params.push(opts.limit);
  const rows = db.prepare(sql).all(...params) as ItemRow[];
  return rows.map(rowToItem);
}

export interface SearchQuery {
  sinceDays: number;
  types?: ItemType[];
  limit: number;
  /** 'and'(기본): 모든 토큰 일치 / 'or': 토큰 중 하나라도 일치(완화 검색) */
  operator?: 'and' | 'or';
}

/** FTS5 전문 검색. bm25 관련도 순으로 반환한다. */
export function searchItems(db: DB, query: string, opts: SearchQuery): NewsItem[] {
  const sinceIso = new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString();
  const conds: string[] = [
    'items_fts MATCH ?',
    '(items.published_at >= ? OR items.published_at IS NULL)',
  ];
  const params: unknown[] = [toFtsQuery(query, opts.operator ?? 'and'), sinceIso];

  if (opts.types && opts.types.length > 0) {
    conds.push(`items.type IN (${opts.types.map(() => '?').join(',')})`);
    params.push(...opts.types);
  }

  const sql = `SELECT items.* FROM items_fts
     JOIN items ON items.rowid = items_fts.rowid
     WHERE ${conds.join(' AND ')}
     ORDER BY bm25(items_fts) LIMIT ?`;
  params.push(opts.limit);
  const rows = db.prepare(sql).all(...params) as ItemRow[];
  return rows.map(rowToItem);
}

export function getItemById(db: DB, id: string): NewsItem | null {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
  return row ? rowToItem(row) : null;
}

export function countItems(db: DB): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM items').get() as { c: number };
  return row.c;
}

export function countItemsBySource(db: DB): Record<string, number> {
  const rows = db.prepare('SELECT source, COUNT(*) AS c FROM items GROUP BY source').all() as {
    source: string;
    c: number;
  }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.source] = r.c;
  return out;
}

/** 점수 이력을 관측시각 오름차순으로 반환한다(velocity 계산용). */
export function getScoreHistory(
  db: DB,
  itemId: string,
): { observedAt: string; score: number | null }[] {
  const rows = db
    .prepare(
      'SELECT observed_at, score FROM score_history WHERE item_id = ? ORDER BY observed_at ASC',
    )
    .all(itemId) as { observed_at: string; score: number | null }[];
  return rows.map((r) => ({ observedAt: r.observed_at, score: r.score }));
}

/**
 * retentionDays보다 오래된 항목을 삭제한다. 단, 학습 이력이 참조하는 항목은 보존한다.
 * 반환값은 삭제된 항목 수.
 */
export function purgeOld(db: DB, retentionDays: number): number {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const result = db
    .prepare(
      `DELETE FROM items
       WHERE COALESCE(published_at, first_seen_at) < ?
         AND id NOT IN (
           SELECT je.value FROM learning_history, json_each(learning_history.item_ids) AS je
         )`,
    )
    .run(cutoff);
  return result.changes;
}
