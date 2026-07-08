import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, type DB } from '../../src/core/db/connection.js';
import { refreshStale } from '../../src/core/refresh.js';
import { defaultConfig } from '../../src/core/config.js';
import { countItems } from '../../src/core/store/itemStore.js';
import { stubHttp } from '../helpers/stubHttp.js';

const hnFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/hn-search.json', import.meta.url)),
  'utf8',
);

describe('refreshStale', () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('활성 수집기를 실행하고 DB에 항목을 축적한다', async () => {
    const http = stubHttp([{ match: 'hn.algolia.com', body: hnFixture }]);
    const summary = await refreshStale(db, defaultConfig(), { http, now: new Date('2026-07-09T12:00:00Z') });

    const hn = summary.results.find((r) => r.source === 'hackernews');
    expect(hn?.status).toBe('ok');
    expect(hn?.itemsNew).toBe(2);
    expect(countItems(db)).toBe(2);
  });

  it('TTL 이내 재실행은 skip한다', async () => {
    const http = stubHttp([{ match: 'hn.algolia.com', body: hnFixture }]);
    const t1 = new Date('2026-07-09T12:00:00Z');
    const t2 = new Date('2026-07-09T12:05:00Z'); // 5분 후 (hackernews TTL 30분 이내)
    await refreshStale(db, defaultConfig(), { http, now: t1 });
    const second = await refreshStale(db, defaultConfig(), { http, now: t2 });
    expect(second.results.find((r) => r.source === 'hackernews')?.status).toBe('skipped');
  });

  it('force면 TTL을 무시하고 다시 수집한다', async () => {
    const http = stubHttp([{ match: 'hn.algolia.com', body: hnFixture }]);
    const t1 = new Date('2026-07-09T12:00:00Z');
    await refreshStale(db, defaultConfig(), { http, now: t1 });
    const forced = await refreshStale(db, defaultConfig(), { http, now: t1, force: true });
    expect(forced.results.find((r) => r.source === 'hackernews')?.status).toBe('ok');
  });

  it('수집기 실패는 격리되어 예외를 던지지 않고 error 상태로 보고한다', async () => {
    const http = stubHttp([{ match: 'hn.algolia.com', status: 500 }]);
    const summary = await refreshStale(db, defaultConfig(), { http, now: new Date('2026-07-09T12:00:00Z') });
    const hn = summary.results.find((r) => r.source === 'hackernews');
    expect(hn?.status).toBe('error');
    expect(hn?.error).toBeTruthy();
    expect(countItems(db)).toBe(0);
  });
});
