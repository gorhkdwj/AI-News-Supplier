import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, type DB } from '../../src/core/db/connection.js';
import { resetRedditTokenCache } from '../../src/collectors/reddit.js';
import { refreshStale } from '../../src/core/refresh.js';
import { defaultConfig } from '../../src/core/config.js';
import { countItems } from '../../src/core/store/itemStore.js';
import { getSightingBySourceKey, upsertSightings } from '../../src/core/store/sightingStore.js';
import { stubHttp, type StubRequest } from '../helpers/stubHttp.js';

const hnFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/hn-search.json', import.meta.url)),
  'utf8',
);
const sharedOfficialFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/shared-official.rss.xml', import.meta.url)),
  'utf8',
);
const cursorFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/cursor-changelog.rss.xml', import.meta.url)),
  'utf8',
);
const geminiReleaseFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/gemini-cli-releases.json', import.meta.url)),
  'utf8',
);
const redditHotFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/reddit-hot.json', import.meta.url)),
  'utf8',
);
const redditInfoFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/reddit-info.json', import.meta.url)),
  'utf8',
);

describe('refreshStale', () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  const ONLY_HN = { sources: ['hackernews'] };

  it('활성 수집기를 실행하고 DB에 항목을 축적한다', async () => {
    const http = stubHttp([{ match: 'hn.algolia.com', body: hnFixture }]);
    const summary = await refreshStale(db, defaultConfig(), {
      http,
      now: new Date('2026-07-09T12:00:00Z'),
      ...ONLY_HN,
    });

    const hn = summary.results.find((r) => r.source === 'hackernews');
    expect(hn?.status).toBe('ok');
    expect(hn?.itemsNew).toBe(2);
    expect(countItems(db)).toBe(2);
    expect(
      db.prepare('SELECT source_key, quality FROM source_sightings ORDER BY source_key').all(),
    ).toEqual([
      { source_key: '100', quality: 'live' },
      { source_key: '102', quality: 'live' },
    ]);
    expect(db.prepare('SELECT COUNT(*) FROM metric_snapshots').pluck().get()).toBe(2);
  });

  it('TTL 이내 재실행은 skip한다', async () => {
    const http = stubHttp([{ match: 'hn.algolia.com', body: hnFixture }]);
    const t1 = new Date('2026-07-09T12:00:00Z');
    const t2 = new Date('2026-07-09T12:05:00Z'); // 5분 후 (hackernews TTL 30분 이내)
    await refreshStale(db, defaultConfig(), { http, now: t1, ...ONLY_HN });
    const second = await refreshStale(db, defaultConfig(), { http, now: t2, ...ONLY_HN });
    expect(second.results.find((r) => r.source === 'hackernews')?.status).toBe('skipped');
  });

  it('force면 TTL을 무시하고 다시 수집한다', async () => {
    const http = stubHttp([{ match: 'hn.algolia.com', body: hnFixture }]);
    const t1 = new Date('2026-07-09T12:00:00Z');
    await refreshStale(db, defaultConfig(), { http, now: t1, ...ONLY_HN });
    const forced = await refreshStale(db, defaultConfig(), {
      http,
      now: t1,
      force: true,
      ...ONLY_HN,
    });
    expect(forced.results.find((r) => r.source === 'hackernews')?.status).toBe('ok');
  });

  it('수집기 실패는 격리되어 예외를 던지지 않고 error 상태로 보고한다', async () => {
    const http = stubHttp([{ match: 'hn.algolia.com', status: 500 }]);
    const summary = await refreshStale(db, defaultConfig(), {
      http,
      now: new Date('2026-07-09T12:00:00Z'),
      ...ONLY_HN,
    });
    const hn = summary.results.find((r) => r.source === 'hackernews');
    expect(hn?.status).toBe('error');
    expect(hn?.error).toBeTruthy();
    expect(countItems(db)).toBe(0);
  });

  it('한 소스가 실패해도 다른 소스 수집은 성공한다(격리)', async () => {
    // hackernews만 응답하고 github는 매칭 실패(404)로 둔다.
    const http = stubHttp([{ match: 'hn.algolia.com', body: hnFixture }]);
    const summary = await refreshStale(db, defaultConfig(), {
      http,
      now: new Date('2026-07-09T12:00:00Z'),
      sources: ['hackernews', 'github'],
    });
    expect(summary.results.find((r) => r.source === 'hackernews')?.status).toBe('ok');
    expect(summary.results.find((r) => r.source === 'github')?.status).toBe('error');
    expect(countItems(db)).toBe(2); // hackernews 항목은 정상 저장
  });

  it('item retention과 독립적으로 14일 초과 metric snapshot을 정리한다', async () => {
    upsertSightings(
      db,
      [
        {
          source: 'hackernews',
          sourceKey: 'old-snapshot',
          type: 'community',
          title: 'Old snapshot story',
          url: 'https://example.com/old-snapshot',
          discussionUrl: 'https://news.ycombinator.com/item?id=old-snapshot',
          summary: null,
          author: null,
          score: 10,
          scoreKind: 'points',
          commentsCount: 1,
          tags: [],
          publishedAt: '2026-06-01T00:00:00Z',
          publishedPrecision: 'exact_time',
          activityAt: null,
          raw: { objectID: 'old-snapshot' },
        },
      ],
      '2026-06-01T01:00:00Z',
    );
    const config = defaultConfig();
    config.retentionDays = null;

    await refreshStale(db, config, {
      now: new Date('2026-07-10T12:00:00Z'),
      sources: ['not-registered'],
    });

    expect(countItems(db)).toBe(1);
    expect(db.prepare('SELECT COUNT(*) FROM metric_snapshots').pluck().get()).toBe(0);
  });

  it('Reddit이 비활성이어도 매 refresh마다 first_seen 48시간 초과 Sighting을 hard purge한다', async () => {
    upsertSightings(
      db,
      [
        {
          source: 'reddit',
          sourceKey: 'expired-reddit',
          type: 'community',
          title: 'Expired Reddit',
          url: 'https://example.com/expired-reddit',
          discussionUrl: 'https://www.reddit.com/r/ai/comments/expired-reddit',
          summary: null,
          author: null,
          score: 1,
          scoreKind: 'upvotes',
          commentsCount: 0,
          tags: ['r/ai'],
          publishedAt: '2026-07-08T00:00:00.000Z',
          publishedPrecision: 'exact_time',
          activityAt: null,
          raw: { id: 'expired-reddit' },
        },
      ],
      '2026-07-08T11:59:59.999Z',
    );
    const config = defaultConfig();
    config.retentionDays = null;

    await refreshStale(db, config, {
      now: new Date('2026-07-10T12:00:00.000Z'),
      sources: ['not-registered'],
    });

    expect(getSightingBySourceKey(db, 'reddit', 'expired-reddit')).toBeNull();
    expect(countItems(db)).toBe(0);
  });

  it('collector에 기존 Reddit 추적 참조를 전달하고 공식 missing key 삭제를 저장소에 반영한다', async () => {
    resetRedditTokenCache();
    const seeded = upsertSightings(
      db,
      [
        {
          source: 'reddit',
          sourceKey: 'missing',
          type: 'community',
          title: 'Tracked missing Reddit',
          url: 'https://example.com/tracked-missing',
          discussionUrl: 'https://www.reddit.com/r/ai/comments/missing',
          summary: null,
          author: null,
          score: 1,
          scoreKind: 'upvotes',
          commentsCount: 0,
          tags: ['r/ai'],
          publishedAt: '2026-07-10T09:00:00.000Z',
          publishedPrecision: 'exact_time',
          activityAt: null,
          raw: { id: 'missing' },
        },
      ],
      '2026-07-10T10:00:00.000Z',
    );
    const config = defaultConfig();
    config.retentionDays = null;
    config.tokens.reddit = {
      clientId: 'fixture-id',
      clientSecret: 'fixture-secret',
      username: 'fixture-user',
    };
    config.sources.reddit.subreddits = ['MachineLearning'];
    const requests: StubRequest[] = [];
    const http = stubHttp(
      [
        { match: 'access_token', body: '{"access_token":"fixture-token","expires_in":3600}' },
        { match: '/api/info', body: redditInfoFixture },
        { match: '/hot?', body: redditHotFixture },
      ],
      requests,
    );

    const summary = await refreshStale(db, config, {
      http,
      now: new Date('2026-07-10T12:00:00.000Z'),
      sources: ['reddit'],
      force: true,
    });

    expect(summary.results).toEqual([expect.objectContaining({ source: 'reddit', status: 'ok' })]);
    expect(requests.some((request) => request.url.includes('/api/info?id=t3_missing'))).toBe(true);
    expect(getSightingBySourceKey(db, 'reddit', 'missing')).toBeNull();
    expect(
      db
        .prepare('SELECT COUNT(*) FROM metric_snapshots WHERE sighting_id = ?')
        .pluck()
        .get(seeded.sightingIds[0]),
    ).toBe(0);
  });

  it('48시간 초과 Reddit 글이 같은 refresh의 hot 결과에 있어도 first_seen 수명을 초기화하지 않는다', async () => {
    resetRedditTokenCache();
    upsertSightings(
      db,
      [
        {
          source: 'reddit',
          sourceKey: 'abc',
          type: 'community',
          title: 'Old tracked Reddit',
          url: 'https://example.com/new-llm',
          discussionUrl: 'https://www.reddit.com/r/LocalLLaMA/comments/abc/new_open_llm/',
          summary: null,
          author: null,
          score: 1,
          scoreKind: 'upvotes',
          commentsCount: 0,
          tags: ['r/LocalLLaMA'],
          publishedAt: '2026-07-08T00:00:00.000Z',
          publishedPrecision: 'exact_time',
          activityAt: null,
          raw: { id: 'abc' },
        },
      ],
      '2026-07-08T11:59:59.999Z',
    );
    const config = defaultConfig();
    config.retentionDays = null;
    config.tokens.reddit = {
      clientId: 'fixture-id',
      clientSecret: 'fixture-secret',
      username: 'fixture-user',
    };
    config.sources.reddit.subreddits = ['MachineLearning'];
    const http = stubHttp([
      { match: 'access_token', body: '{"access_token":"fixture-token","expires_in":3600}' },
      { match: '/api/info', body: redditInfoFixture },
      { match: '/hot?', body: redditHotFixture },
    ]);

    await refreshStale(db, config, {
      http,
      now: new Date('2026-07-10T12:00:00.000Z'),
      sources: ['reddit'],
      force: true,
    });

    expect(getSightingBySourceKey(db, 'reddit', 'abc')).toBeNull();
  });

  it('같은 공식 URL의 RSS와 HN을 Story 하나와 독립 Sighting 둘로 저장한다', async () => {
    const config = defaultConfig();
    config.sources.rss.feeds = [
      { id: 'shared', title: 'Shared Official', url: 'https://example.com/shared.xml' },
    ];
    const http = stubHttp([
      { match: 'hn.algolia.com', body: hnFixture },
      { match: 'example.com/shared.xml', body: sharedOfficialFixture },
    ]);

    await refreshStale(db, config, {
      http,
      now: new Date('2026-07-09T12:00:00Z'),
      sources: ['hackernews', 'rss:shared'],
    });

    const story = db
      .prepare("SELECT id FROM items WHERE canonical_url = 'https://openai.com/index/gpt-5'")
      .get() as { id: string };
    expect(
      db
        .prepare(
          'SELECT source, source_key FROM source_sightings WHERE story_id = ? ORDER BY source',
        )
        .all(story.id),
    ).toEqual([
      { source: 'hackernews', source_key: '100' },
      { source: 'rss:shared', source_key: 'official-gpt-5' },
    ]);
    expect(
      db
        .prepare(
          'SELECT COUNT(*) FROM metric_snapshots WHERE sighting_id IN (SELECT id FROM source_sightings WHERE story_id = ?)',
        )
        .pluck()
        .get(story.id),
    ).toBe(2);
    expect(countItems(db)).toBe(2);
  });

  it('점수가 같아도 다음 시간 refresh는 새 metric snapshot을 저장한다', async () => {
    const http = stubHttp([{ match: 'hn.algolia.com', body: hnFixture }]);
    const config = defaultConfig();
    await refreshStale(db, config, {
      http,
      now: new Date('2026-07-09T12:05:00Z'),
      ...ONLY_HN,
    });
    await refreshStale(db, config, {
      http,
      now: new Date('2026-07-09T13:05:00Z'),
      force: true,
      ...ONLY_HN,
    });

    const sightingId = db
      .prepare("SELECT id FROM source_sightings WHERE source = 'hackernews' AND source_key = '100'")
      .pluck()
      .get() as string;
    expect(
      db
        .prepare(
          'SELECT observed_at FROM metric_snapshots WHERE sighting_id = ? ORDER BY observed_at',
        )
        .pluck()
        .all(sightingId),
    ).toEqual(['2026-07-09T12:05:00.000Z', '2026-07-09T13:05:00.000Z']);
  });

  it('한 공식 source가 실패해도 다른 공식 source는 저장한다', async () => {
    const http = stubHttp([
      { match: 'claude-code/main/feed.xml', status: 503 },
      { match: 'cursor.com/changelog/rss.xml', body: cursorFixture },
    ]);
    const summary = await refreshStale(db, defaultConfig(), {
      http,
      now: new Date('2026-07-10T00:00:00Z'),
      sources: ['rss:claude-code', 'rss:cursor'],
    });

    expect(summary.results.find((result) => result.source === 'rss:claude-code')?.status).toBe(
      'error',
    );
    expect(summary.results.find((result) => result.source === 'rss:cursor')?.status).toBe('ok');
    expect(countItems(db)).toBe(1);
  });

  it('Gemini release collector는 GitHub TTL 설정을 사용한다', async () => {
    const config = defaultConfig();
    config.defaultTtlMinutes = 1;
    config.sources.github.ttlMinutes = 120;
    const http = stubHttp([
      { match: '/google-gemini/gemini-cli/releases', body: geminiReleaseFixture },
    ]);
    const source = { sources: ['github_release:gemini-cli'] };

    await refreshStale(db, config, {
      http,
      now: new Date('2026-07-10T00:00:00Z'),
      ...source,
    });
    const second = await refreshStale(db, config, {
      http,
      now: new Date('2026-07-10T01:30:00Z'),
      ...source,
    });

    expect(second.results[0]?.status).toBe('skipped');
  });
});
