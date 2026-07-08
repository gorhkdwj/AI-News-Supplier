import type { ResolvedConfig } from './config.js';
import type { DB } from './db/connection.js';
import { createHttpClient, type HttpClient } from './http.js';
import { logger } from './logger.js';
import { upsertItems } from './store/itemStore.js';
import {
  getSourceState,
  insertFetchLog,
  markAttempt,
  markFailure,
  markSuccess,
  type FetchStatus,
} from './store/fetchLog.js';
import { enabledCollectors } from '../collectors/registry.js';
import { CollectorError, type Collector, type FetchContext } from '../collectors/types.js';

export interface SourceRefreshResult {
  source: string;
  status: FetchStatus;
  itemsFound: number;
  itemsNew: number;
  error?: string;
}

export interface RefreshSummary {
  results: SourceRefreshResult[];
}

export interface RefreshOptions {
  sources?: string[];
  force?: boolean;
  now?: Date;
  http?: HttpClient;
  /** 수집기 하나당 전체 타임아웃(ms). */
  perSourceTimeoutMs?: number;
  concurrency?: number;
}

const BACKOFF_FAILURE_THRESHOLD = 3;
const BACKOFF_MULTIPLIER = 4;

function getConfiguredTtl(config: ResolvedConfig, sourceName: string): number {
  const key = sourceName.startsWith('rss:') ? 'rss' : sourceName;
  const sources = config.sources as Record<string, { ttlMinutes?: number } | undefined>;
  return sources[key]?.ttlMinutes ?? config.defaultTtlMinutes;
}

function withTimeout<T>(p: Promise<T>, ms: number, source: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new CollectorError(source, 'timeout', `${source} 수집 시간 초과(${ms}ms)`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

async function refreshOne(
  db: DB,
  config: ResolvedConfig,
  http: HttpClient,
  collector: Collector,
  now: Date,
  force: boolean,
  timeoutMs: number,
): Promise<SourceRefreshResult> {
  const state = getSourceState(db, collector.name);
  const nowIso = now.toISOString();

  // TTL 스킵 판정(백오프 반영).
  const baseTtl = getConfiguredTtl(config, collector.name);
  const effectiveTtl =
    state && state.consecutiveFailures >= BACKOFF_FAILURE_THRESHOLD
      ? baseTtl * BACKOFF_MULTIPLIER
      : baseTtl;
  if (!force && state?.lastSuccessAt) {
    const ageMin = (now.getTime() - Date.parse(state.lastSuccessAt)) / 60_000;
    if (ageMin < effectiveTtl) {
      insertFetchLog(db, {
        source: collector.name,
        startedAt: nowIso,
        finishedAt: nowIso,
        status: 'skipped',
        itemsFound: 0,
        itemsNew: 0,
        error: null,
      });
      return { source: collector.name, status: 'skipped', itemsFound: 0, itemsNew: 0 };
    }
  }

  markAttempt(db, collector.name, nowIso);
  const ctx: FetchContext = { config, http, state, log: logger, now };

  try {
    const result = await withTimeout(collector.fetch(ctx), timeoutMs, collector.name);

    if (result.notModified) {
      markSuccess(db, collector.name, {
        now: nowIso,
        etag: state?.etag,
        lastModified: state?.lastModified,
      });
      insertFetchLog(db, {
        source: collector.name,
        startedAt: nowIso,
        finishedAt: new Date().toISOString(),
        status: 'not_modified',
        itemsFound: 0,
        itemsNew: 0,
        error: null,
      });
      return { source: collector.name, status: 'not_modified', itemsFound: 0, itemsNew: 0 };
    }

    const { found, created } = upsertItems(db, result.items, nowIso);
    markSuccess(db, collector.name, {
      now: nowIso,
      etag: result.etag,
      lastModified: result.lastModified,
    });
    insertFetchLog(db, {
      source: collector.name,
      startedAt: nowIso,
      finishedAt: new Date().toISOString(),
      status: 'ok',
      itemsFound: found,
      itemsNew: created,
      error: null,
    });
    return { source: collector.name, status: 'ok', itemsFound: found, itemsNew: created };
  } catch (err) {
    // 한 소스의 실패는 전체를 깨지 않는다. 여기서 삼키고 결과로만 보고한다.
    const msg = err instanceof Error ? err.message : String(err);
    markFailure(db, collector.name, { now: nowIso, error: msg });
    insertFetchLog(db, {
      source: collector.name,
      startedAt: nowIso,
      finishedAt: new Date().toISOString(),
      status: 'error',
      itemsFound: 0,
      itemsNew: 0,
      error: msg,
    });
    logger.warn(`수집 실패: ${collector.name}`, msg);
    return { source: collector.name, status: 'error', itemsFound: 0, itemsNew: 0, error: msg };
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i] as T);
    }
  }
  const workerCount = Math.min(Math.max(1, limit), items.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * TTL이 만료된(또는 force인) 활성 수집기를 실행해 DB를 갱신한다.
 * 개별 수집기 실패는 격리되어 전체 실행을 중단시키지 않는다.
 */
export async function refreshStale(
  db: DB,
  config: ResolvedConfig,
  opts: RefreshOptions = {},
): Promise<RefreshSummary> {
  const now = opts.now ?? new Date();
  const http = opts.http ?? createHttpClient();
  const timeoutMs = opts.perSourceTimeoutMs ?? 30_000;
  const concurrency = opts.concurrency ?? 4;

  let collectors = enabledCollectors(config);
  if (opts.sources && opts.sources.length > 0) {
    const wanted = new Set(opts.sources);
    collectors = collectors.filter((c) => wanted.has(c.name));
  }

  const results = await runWithConcurrency(collectors, concurrency, (c) =>
    refreshOne(db, config, http, c, now, opts.force ?? false, timeoutMs),
  );
  return { results };
}
