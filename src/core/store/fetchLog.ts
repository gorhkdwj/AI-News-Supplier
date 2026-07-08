import type { DB } from '../db/connection.js';

export interface SourceState {
  source: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  etag: string | null;
  lastModified: string | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export type FetchStatus = 'ok' | 'error' | 'not_modified' | 'skipped';

export interface FetchLogEntry {
  source: string;
  startedAt: string;
  finishedAt: string | null;
  status: FetchStatus;
  itemsFound: number;
  itemsNew: number;
  error: string | null;
}

interface SourceStateRow {
  source: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  etag: string | null;
  last_modified: string | null;
  consecutive_failures: number;
  last_error: string | null;
}

export function getSourceState(db: DB, source: string): SourceState | null {
  const row = db.prepare('SELECT * FROM source_state WHERE source = ?').get(source) as
    | SourceStateRow
    | undefined;
  if (!row) return null;
  return {
    source: row.source,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    etag: row.etag,
    lastModified: row.last_modified,
    consecutiveFailures: row.consecutive_failures,
    lastError: row.last_error,
  };
}

export function markAttempt(db: DB, source: string, now: string): void {
  db.prepare(
    `INSERT INTO source_state (source, last_attempt_at)
     VALUES (?, ?)
     ON CONFLICT(source) DO UPDATE SET last_attempt_at = excluded.last_attempt_at`,
  ).run(source, now);
}

export function markSuccess(
  db: DB,
  source: string,
  opts: { now: string; etag?: string | null; lastModified?: string | null },
): void {
  db.prepare(
    `INSERT INTO source_state (source, last_attempt_at, last_success_at, etag, last_modified, consecutive_failures, last_error)
     VALUES (@source, @now, @now, @etag, @lastModified, 0, NULL)
     ON CONFLICT(source) DO UPDATE SET
       last_success_at = @now,
       etag = @etag,
       last_modified = @lastModified,
       consecutive_failures = 0,
       last_error = NULL`,
  ).run({
    source,
    now: opts.now,
    etag: opts.etag ?? null,
    lastModified: opts.lastModified ?? null,
  });
}

export function markFailure(db: DB, source: string, opts: { now: string; error: string }): void {
  db.prepare(
    `INSERT INTO source_state (source, last_attempt_at, consecutive_failures, last_error)
     VALUES (@source, @now, 1, @error)
     ON CONFLICT(source) DO UPDATE SET
       consecutive_failures = source_state.consecutive_failures + 1,
       last_error = @error`,
  ).run({ source, now: opts.now, error: opts.error });
}

export function insertFetchLog(db: DB, entry: FetchLogEntry): void {
  db.prepare(
    `INSERT INTO fetch_log (source, started_at, finished_at, status, items_found, items_new, error)
     VALUES (@source, @startedAt, @finishedAt, @status, @itemsFound, @itemsNew, @error)`,
  ).run(entry);
}

/** 지정 일수보다 오래된 fetch_log 행을 정리한다. */
export function purgeOldFetchLogs(db: DB, olderThanIso: string): number {
  const result = db.prepare('DELETE FROM fetch_log WHERE started_at < ?').run(olderThanIso);
  return result.changes;
}
