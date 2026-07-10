import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildRedditUserAgent,
  redditCollector,
  resetRedditTokenCache,
} from '../../src/collectors/reddit.js';
import type { FetchContext } from '../../src/collectors/types.js';
import { defaultConfig, type ResolvedConfig } from '../../src/core/config.js';
import { logger } from '../../src/core/logger.js';
import { stubHttp, type StubRequest } from '../helpers/stubHttp.js';

const listing = readFileSync(
  fileURLToPath(new URL('../fixtures/reddit-hot.json', import.meta.url)),
  'utf8',
);
const infoListing = readFileSync(
  fileURLToPath(new URL('../fixtures/reddit-info.json', import.meta.url)),
  'utf8',
);

function ctx(
  http: FetchContext['http'],
  config: ResolvedConfig,
  trackedSightings: FetchContext['trackedSightings'] = [],
  log: FetchContext['log'] = logger,
): FetchContext {
  return {
    config,
    http,
    state: null,
    log,
    now: new Date('2026-07-09T12:00:00Z'),
    trackedSightings,
  };
}

function configWithCreds(): ResolvedConfig {
  const c = defaultConfig();
  c.tokens.reddit.clientId = 'id';
  c.tokens.reddit.clientSecret = 'secret';
  c.tokens.reddit.username = 'fixture-user';
  return c;
}

describe('redditCollector', () => {
  it('자격증명이 없으면 비활성이다', () => {
    expect(redditCollector.isEnabled(defaultConfig())).toBe(false);
  });

  it('client 자격증명과 username이 모두 있으면 활성이다', () => {
    expect(redditCollector.isEnabled(configWithCreds())).toBe(true);
  });

  it.each([
    ['enabled', (config: ResolvedConfig) => (config.sources.reddit.enabled = false)],
    ['clientId', (config: ResolvedConfig) => (config.tokens.reddit.clientId = null)],
    ['clientSecret', (config: ResolvedConfig) => (config.tokens.reddit.clientSecret = null)],
    ['username', (config: ResolvedConfig) => (config.tokens.reddit.username = null)],
  ])('%s gate가 없으면 조용히 비활성이다', (_gate, removeGate) => {
    const config = configWithCreds();
    removeGate(config);
    expect(redditCollector.isEnabled(config)).toBe(false);
  });

  it('공백 username은 활성 자격증명으로 인정하지 않는다', () => {
    const config = configWithCreds();
    config.tokens.reddit.username = '   ';
    expect(redditCollector.isEnabled(config)).toBe(false);
  });

  it('User-Agent username의 앞뒤 공백을 제거한다', () => {
    expect(buildRedditUserAgent('  fixture-user  ', '1.2.3')).toBe(
      'desktop:ai-news-supplier:v1.2.3 (by /u/fixture-user)',
    );
  });

  it('기본 subreddit 7개를 사용한다', () => {
    expect(defaultConfig().sources.reddit.subreddits).toEqual([
      'MachineLearning',
      'LocalLLaMA',
      'artificial',
      'ClaudeCode',
      'ClaudeAI',
      'cursor',
      'OpenAI',
    ]);
  });

  it('토큰 발급 후 hot 게시물을 수집하고 stickied·removed 항목은 제외한다', async () => {
    resetRedditTokenCache();
    const requests: StubRequest[] = [];
    const http = stubHttp(
      [
        { match: 'access_token', body: '{"access_token":"tok","expires_in":3600}' },
        { match: 'oauth.reddit.com', body: listing },
      ],
      requests,
    );
    const { items } = await redditCollector.fetch(ctx(http, configWithCreds()));

    expect(items).toHaveLength(1);
    expect(items.map((item) => item.sourceKey)).not.toContain('removed-hot');
    expect(items[0]!.title).toContain('open LLM');
    expect(items[0]!.score).toBe(342);
    expect(items[0]!.type).toBe('community');
    expect(items[0]!.tags).toEqual(['r/LocalLLaMA']);
    expect(items[0]).toMatchObject({
      sourceKey: 'abc',
      url: 'https://example.com/new-llm',
      discussionUrl: 'https://www.reddit.com/r/LocalLLaMA/comments/abc/new_open_llm/',
      scoreKind: 'upvotes',
      activityAt: null,
      publishedPrecision: 'exact_time',
    });

    const expectedUserAgent = 'desktop:ai-news-supplier:v0.0.1 (by /u/fixture-user)';
    expect(requests.find((request) => request.url.includes('access_token'))?.headers).toMatchObject(
      {
        'user-agent': expectedUserAgent,
      },
    );
    const hotRequests = requests.filter((request) => request.url.includes('/hot?'));
    expect(hotRequests.map((request) => request.url)).toEqual(
      configWithCreds().sources.reddit.subreddits.map(
        (subreddit) => `https://oauth.reddit.com/r/${subreddit}/hot?limit=25&raw_json=1`,
      ),
    );
    expect(
      hotRequests.every((request) => request.headers?.['user-agent'] === expectedUserAgent),
    ).toBe(true);
  });

  it('한 subreddit 실패를 격리하고 다른 subreddit 성공 결과를 보존한다', async () => {
    resetRedditTokenCache();
    const http = stubHttp([
      { match: 'access_token', body: '{"access_token":"tok","expires_in":3600}' },
      { match: '/r/ClaudeAI/hot', status: 503 },
      { match: 'oauth.reddit.com', body: listing },
    ]);

    const result = await redditCollector.fetch(ctx(http, configWithCreds()));
    expect(result.items).toHaveLength(1);
  });

  it('한 subreddit 요청 예외를 격리하고 앞선 성공 결과를 보존한다', async () => {
    resetRedditTokenCache();
    const config = configWithCreds();
    config.sources.reddit.subreddits = ['MachineLearning', 'ClaudeAI'];
    const fallback = stubHttp([
      { match: 'access_token', body: '{"access_token":"tok","expires_in":3600}' },
      { match: '/hot?', body: listing },
    ]);
    const http: FetchContext['http'] = {
      ...fallback,
      async get(url, options) {
        if (url.includes('/r/ClaudeAI/hot')) throw new Error('fixture network failure');
        return fallback.get(url, options);
      },
    };

    const result = await redditCollector.fetch(ctx(http, config));
    expect(result.items).toHaveLength(1);
  });

  it('rate remaining이 소진되면 성공 결과를 유지하고 뒤 요청을 중단한다', async () => {
    resetRedditTokenCache();
    const requests: StubRequest[] = [];
    const http = stubHttp(
      [
        { match: 'access_token', body: '{"access_token":"tok","expires_in":3600}' },
        {
          match: '/r/MachineLearning/hot',
          body: listing,
          headers: {
            'X-Ratelimit-Used': '60',
            'x-ratelimit-remaining': '0',
            'X-Ratelimit-Reset': '300',
          },
        },
        { match: 'oauth.reddit.com', body: listing },
      ],
      requests,
    );

    const result = await redditCollector.fetch(
      ctx(http, configWithCreds(), [
        {
          sourceKey: 'not-requested',
          sourceUrl: 'https://www.reddit.com/comments/not-requested',
          firstSeenAt: '2026-07-09T00:00:00.000Z',
          lastSeenAt: '2026-07-09T01:00:00.000Z',
        },
      ]),
    );
    expect(result.items).toHaveLength(1);
    expect(result.deletedSourceKeys).toEqual([]);
    expect(result.rateLimit).toEqual({
      used: 60,
      remaining: 0,
      resetSeconds: 300,
    });
    expect(requests.filter((request) => request.url.includes('/hot?'))).toHaveLength(1);
    expect(requests.some((request) => request.url.includes('/api/info'))).toBe(false);
  });

  it('hot 응답의 tracked removed 게시물은 info 재검증 없이 즉시 삭제 대상으로 반환한다', async () => {
    resetRedditTokenCache();
    const config = configWithCreds();
    config.sources.reddit.subreddits = ['MachineLearning'];
    const requests: StubRequest[] = [];
    const http = stubHttp(
      [
        { match: 'access_token', body: '{"access_token":"tok","expires_in":3600}' },
        {
          match: '/hot?',
          body: listing,
          headers: { 'x-ratelimit-remaining': '0' },
        },
      ],
      requests,
    );

    const result = await redditCollector.fetch(
      ctx(http, config, [
        {
          sourceKey: 'removed-hot',
          sourceUrl: 'https://www.reddit.com/comments/removed-hot',
          firstSeenAt: '2026-07-09T00:00:00.000Z',
          lastSeenAt: '2026-07-09T01:00:00.000Z',
        },
      ]),
    );

    expect(result.items.map((item) => item.sourceKey)).not.toContain('removed-hot');
    expect(result.deletedSourceKeys).toEqual(['removed-hot']);
    expect(requests.some((request) => request.url.includes('/api/info'))).toBe(false);
  });

  it('Remaining 헤더 없는 429도 뒤 subreddit 요청을 즉시 중단한다', async () => {
    resetRedditTokenCache();
    const config = configWithCreds();
    config.sources.reddit.subreddits = ['MachineLearning', 'ClaudeAI'];
    const requests: StubRequest[] = [];
    const http = stubHttp(
      [
        { match: 'access_token', body: '{"access_token":"tok","expires_in":3600}' },
        { match: '/r/MachineLearning/hot', status: 429 },
        { match: '/r/ClaudeAI/hot', body: listing },
      ],
      requests,
    );

    await expect(redditCollector.fetch(ctx(http, config))).rejects.toMatchObject({
      source: 'reddit',
    });
    expect(requests.filter((request) => request.url.includes('/hot?'))).toHaveLength(1);
  });

  it('파싱 실패 응답에서도 rate remaining 소진을 확인해 뒤 subreddit 요청을 중단한다', async () => {
    resetRedditTokenCache();
    const config = configWithCreds();
    config.sources.reddit.subreddits = ['MachineLearning', 'ClaudeAI'];
    const requests: StubRequest[] = [];
    const http = stubHttp(
      [
        { match: 'access_token', body: '{"access_token":"tok","expires_in":3600}' },
        {
          match: '/r/MachineLearning/hot',
          body: '{not-json',
          headers: {
            'X-Ratelimit-Used': '60',
            'X-Ratelimit-Remaining': '0',
            'X-Ratelimit-Reset': '300',
          },
        },
        { match: '/r/ClaudeAI/hot', body: listing },
      ],
      requests,
    );

    await expect(redditCollector.fetch(ctx(http, config))).rejects.toMatchObject({
      source: 'reddit',
    });
    expect(requests.filter((request) => request.url.includes('/hot?'))).toHaveLength(1);
  });

  it('tracked post를 info로 재검증하고 성공 응답의 deleted·missing key만 반환한다', async () => {
    resetRedditTokenCache();
    const config = configWithCreds();
    config.sources.reddit.subreddits = ['MachineLearning'];
    const requests: StubRequest[] = [];
    const http = stubHttp(
      [
        { match: 'access_token', body: '{"access_token":"tok","expires_in":3600}' },
        { match: '/api/info', body: infoListing },
        { match: '/hot?', body: listing },
      ],
      requests,
    );
    const tracked = ['abc', 'gone', 'missing', 'removed-hot'].map((sourceKey) => ({
      sourceKey,
      sourceUrl: `https://www.reddit.com/comments/${sourceKey}`,
      firstSeenAt: '2026-07-09T00:00:00.000Z',
      lastSeenAt: '2026-07-09T01:00:00.000Z',
    }));

    const result = await redditCollector.fetch(ctx(http, config, tracked));

    expect(result.deletedSourceKeys).toEqual(['removed-hot', 'gone', 'missing']);
    expect(result.items).toEqual([
      expect.objectContaining({ sourceKey: 'abc', score: 400, commentsCount: 100 }),
    ]);
    const infoRequest = requests.find((request) => request.url.includes('/api/info'));
    expect(infoRequest).toMatchObject({
      url: 'https://oauth.reddit.com/api/info?id=t3_abc,t3_gone,t3_missing,t3_removed-hot&raw_json=1',
      headers: {
        'user-agent': 'desktop:ai-news-supplier:v0.0.1 (by /u/fixture-user)',
      },
    });
  });

  it('구조가 잘못된 info 200 응답은 missing 확정으로 사용하지 않는다', async () => {
    resetRedditTokenCache();
    const config = configWithCreds();
    config.sources.reddit.subreddits = ['MachineLearning'];
    const http = stubHttp([
      { match: 'access_token', body: '{"access_token":"tok","expires_in":3600}' },
      { match: '/api/info', body: '{}' },
      { match: '/hot?', body: listing },
    ]);

    const result = await redditCollector.fetch(
      ctx(http, config, [
        {
          sourceKey: 'missing',
          sourceUrl: 'https://www.reddit.com/comments/missing',
          firstSeenAt: '2026-07-09T00:00:00.000Z',
          lastSeenAt: '2026-07-09T01:00:00.000Z',
        },
      ]),
    );

    expect(result.deletedSourceKeys).toEqual([]);
  });

  it('오류와 로그에 client 자격증명·access token·username을 노출하지 않는다', async () => {
    resetRedditTokenCache();
    const config = defaultConfig();
    const markers = {
      clientId: 'private-client-id-marker',
      clientSecret: 'private-client-secret-marker',
      username: 'private-username-marker',
      token: 'private-access-token-marker',
    };
    config.tokens.reddit = {
      clientId: markers.clientId,
      clientSecret: markers.clientSecret,
      username: markers.username,
    };
    config.sources.reddit.subreddits = ['MachineLearning'];
    const logs: string[] = [];
    const recordingLogger: FetchContext['log'] = {
      debug: (message, ...args) => logs.push([message, ...args].join(' ')),
      info: (message, ...args) => logs.push([message, ...args].join(' ')),
      warn: (message, ...args) => logs.push([message, ...args].join(' ')),
      error: (message, ...args) => logs.push([message, ...args].join(' ')),
    };
    const http = stubHttp([
      {
        match: 'access_token',
        body: JSON.stringify({ access_token: markers.token, expires_in: 3600 }),
      },
      { match: '/hot?', status: 503 },
    ]);

    let failure: unknown;
    try {
      await redditCollector.fetch(ctx(http, config, [], recordingLogger));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    const observable = `${String(failure)} ${logs.join(' ')}`;
    expect(observable).not.toContain(markers.clientId);
    expect(observable).not.toContain(markers.clientSecret);
    expect(observable).not.toContain(markers.username);
    expect(observable).not.toContain(markers.token);
  });

  it('손상된 token 응답 원문을 오류에 노출하지 않고 OAuth 호출에서 중단한다', async () => {
    resetRedditTokenCache();
    const marker = 'private-token-fragment-marker';
    const requests: StubRequest[] = [];
    const http = stubHttp(
      [
        { match: 'access_token', body: `{"access_token":"${marker}", BAD` },
        { match: '/hot?', body: listing },
      ],
      requests,
    );

    let failure: unknown;
    try {
      await redditCollector.fetch(ctx(http, configWithCreds()));
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ source: 'reddit', kind: 'auth' });
    expect(String(failure)).not.toContain(marker);
    expect(requests.some((request) => request.url.includes('/hot?'))).toBe(false);
  });
});
