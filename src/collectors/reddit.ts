import type { LiveSightingInput } from '../core/types.js';
import {
  CollectorError,
  type Collector,
  type FetchContext,
  type SafeRateLimitStatus,
} from './types.js';

interface RedditPost {
  id: string;
  title: string;
  url: string;
  permalink: string;
  ups: number;
  num_comments: number;
  author: string;
  created_utc: number;
  subreddit: string;
  stickied?: boolean;
  selftext?: string;
  removed_by_category?: string | null;
  banned_by?: string | null;
}

interface RedditTokenResponse {
  access_token: string;
  expires_in: number;
}

type RedditHttpResponse = Awaited<ReturnType<FetchContext['http']['get']>>;

export type RedditRateLimitStatus = SafeRateLimitStatus;

// 액세스 토큰은 메모리에만 캐시한다(디스크/로그에 남기지 않는다).
let cachedToken: { token: string; expiresAtMs: number } | null = null;

function runtimeVersion(): string {
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.1';
}

export function buildRedditUserAgent(username: string, version: string = runtimeVersion()): string {
  return `desktop:ai-news-supplier:v${version} (by /u/${username.trim()})`;
}

/** 테스트에서 토큰 캐시를 초기화한다. */
export function resetRedditTokenCache(): void {
  cachedToken = null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseRedditListing(response: RedditHttpResponse): RedditPost[] {
  const value = response.json<unknown>();
  if (!isRecord(value) || !isRecord(value['data']) || !Array.isArray(value['data']['children'])) {
    throw new Error('Invalid Reddit listing shape');
  }
  return value['data']['children'].map((child) => {
    if (!isRecord(child) || !isRecord(child['data'])) {
      throw new Error('Invalid Reddit listing child');
    }
    const post = child['data'];
    if (
      typeof post['id'] !== 'string' ||
      typeof post['title'] !== 'string' ||
      typeof post['url'] !== 'string' ||
      typeof post['permalink'] !== 'string' ||
      typeof post['ups'] !== 'number' ||
      typeof post['num_comments'] !== 'number' ||
      typeof post['author'] !== 'string' ||
      typeof post['created_utc'] !== 'number' ||
      typeof post['subreddit'] !== 'string'
    ) {
      throw new Error('Invalid Reddit post shape');
    }
    return post as unknown as RedditPost;
  });
}

async function getAccessToken(ctx: FetchContext): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs > ctx.now.getTime()) return cachedToken.token;
  const { clientId, clientSecret } = ctx.config.tokens.reddit;
  const username = ctx.config.tokens.reddit.username!;
  const userAgent = buildRedditUserAgent(username);
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await ctx.http.postForm(
    'https://www.reddit.com/api/v1/access_token',
    { grant_type: 'client_credentials' },
    {
      headers: { authorization: `Basic ${basic}`, 'user-agent': userAgent },
      timeoutMs: 15_000,
    },
  );
  if (!res.ok) {
    throw new CollectorError('reddit', 'auth', `Reddit 토큰 발급 실패 ${res.status}`, res.status);
  }
  let data: RedditTokenResponse;
  try {
    const parsed = res.json<unknown>();
    if (
      !isRecord(parsed) ||
      typeof parsed['access_token'] !== 'string' ||
      parsed['access_token'].length === 0 ||
      typeof parsed['expires_in'] !== 'number' ||
      !Number.isFinite(parsed['expires_in'])
    ) {
      throw new Error('Invalid Reddit token shape');
    }
    data = parsed as unknown as RedditTokenResponse;
  } catch {
    throw new CollectorError('reddit', 'auth', 'Reddit 토큰 응답 검증 실패');
  }
  cachedToken = {
    token: data.access_token,
    expiresAtMs: ctx.now.getTime() + Math.max(0, data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

function postToItem(p: RedditPost): LiveSightingInput {
  const publishedAt = p.created_utc ? new Date(p.created_utc * 1000).toISOString() : null;
  return {
    source: 'reddit',
    sourceKey: p.id,
    type: 'community',
    title: p.title,
    url: p.url || `https://www.reddit.com${p.permalink}`,
    discussionUrl: new URL(p.permalink, 'https://www.reddit.com').toString(),
    summary: p.selftext ? p.selftext.slice(0, 2000) : null,
    author: p.author ?? null,
    score: p.ups ?? null,
    scoreKind: 'upvotes',
    commentsCount: p.num_comments ?? null,
    tags: [`r/${p.subreddit}`],
    publishedAt,
    publishedPrecision: publishedAt === null ? 'inferred' : 'exact_time',
    activityAt: null,
    raw: { id: p.id, permalink: p.permalink },
  };
}

function readRateLimitNumber(response: RedditHttpResponse, headerName: string): number | null {
  const value = Number.parseFloat(response.header(headerName) ?? '');
  return Number.isFinite(value) ? value : null;
}

export function readRedditRateLimit(
  response: RedditHttpResponse,
): RedditRateLimitStatus | undefined {
  const status = {
    used: readRateLimitNumber(response, 'x-ratelimit-used'),
    remaining: readRateLimitNumber(response, 'x-ratelimit-remaining'),
    resetSeconds: readRateLimitNumber(response, 'x-ratelimit-reset'),
  };
  return Object.values(status).some((value) => value !== null) ? status : undefined;
}

function shouldStopForRateLimit(
  response: RedditHttpResponse,
  status: RedditRateLimitStatus | undefined,
): boolean {
  return (
    response.status === 429 ||
    (status?.remaining !== null && status?.remaining !== undefined && status.remaining <= 1)
  );
}

function isDeletedPost(post: RedditPost): boolean {
  const deletedValues = new Set(['[deleted]', '[removed]']);
  return (
    deletedValues.has(post.author?.toLowerCase()) ||
    deletedValues.has(post.title?.toLowerCase()) ||
    deletedValues.has(post.selftext?.toLowerCase() ?? '') ||
    post.removed_by_category != null ||
    post.banned_by != null
  );
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export const redditCollector: Collector = {
  name: 'reddit',
  defaultTtlMinutes: 60,
  // 자격증명이 모두 있을 때만 활성(없으면 오류가 아니라 조용히 비활성).
  isEnabled: (config) =>
    config.sources.reddit.enabled &&
    Boolean(config.tokens.reddit.clientId) &&
    Boolean(config.tokens.reddit.clientSecret) &&
    Boolean(config.tokens.reddit.username?.trim()),
  async fetch(ctx: FetchContext): Promise<{
    items: LiveSightingInput[];
    deletedSourceKeys: string[];
    rateLimit?: RedditRateLimitStatus;
  }> {
    const token = await getAccessToken(ctx);
    const username = ctx.config.tokens.reddit.username!;
    const userAgent = buildRedditUserAgent(username);
    const posts = new Map<string, RedditPost>();
    const tracked = [
      ...new Map(
        (ctx.trackedSightings ?? []).map((reference) => [reference.sourceKey, reference]),
      ).values(),
    ];
    const trackedKeys = new Set(tracked.map((reference) => reference.sourceKey));
    const removedHotSourceKeys = new Set<string>();
    let successfulRequests = 0;
    let stopAdditionalRequests = false;
    let rateLimit: RedditRateLimitStatus | undefined;

    for (const subreddit of ctx.config.sources.reddit.subreddits) {
      const url = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/hot?limit=25&raw_json=1`;
      let res: RedditHttpResponse;
      try {
        res = await ctx.http.get(url, {
          headers: { authorization: `Bearer ${token}`, 'user-agent': userAgent },
          timeoutMs: 15_000,
        });
      } catch {
        ctx.log.warn(`Reddit r/${subreddit} 요청 실패`);
        continue;
      }
      const observedRateLimit = readRedditRateLimit(res);
      if (observedRateLimit !== undefined) rateLimit = observedRateLimit;
      if (!res.ok) {
        ctx.log.warn(`Reddit r/${subreddit} 수집 실패 ${res.status}`);
        if (shouldStopForRateLimit(res, observedRateLimit)) {
          stopAdditionalRequests = true;
          break;
        }
        continue;
      }
      let listing: RedditPost[];
      try {
        listing = parseRedditListing(res);
      } catch {
        ctx.log.warn(`Reddit r/${subreddit} 응답 파싱 실패`);
        if (shouldStopForRateLimit(res, observedRateLimit)) {
          stopAdditionalRequests = true;
          break;
        }
        continue;
      }
      successfulRequests++;
      for (const post of listing) {
        if (post.stickied) continue;
        if (isDeletedPost(post)) {
          if (trackedKeys.has(post.id)) removedHotSourceKeys.add(post.id);
          continue;
        }
        if (!posts.has(post.id)) posts.set(post.id, post);
      }
      if (shouldStopForRateLimit(res, observedRateLimit)) {
        stopAdditionalRequests = true;
        break;
      }
    }
    if (successfulRequests === 0) {
      throw new CollectorError('reddit', 'http', 'Reddit subreddit 수집 전체 실패');
    }
    const deletedSourceKeys = [...removedHotSourceKeys];
    if (!stopAdditionalRequests) {
      for (const chunk of chunks(tracked, 50)) {
        const fullnames = chunk.map((reference) => `t3_${reference.sourceKey}`).join(',');
        const url = `https://oauth.reddit.com/api/info?id=${fullnames}&raw_json=1`;
        let response: RedditHttpResponse;
        try {
          response = await ctx.http.get(url, {
            headers: { authorization: `Bearer ${token}`, 'user-agent': userAgent },
            timeoutMs: 15_000,
          });
        } catch {
          ctx.log.warn('Reddit retained post 재검증 요청 실패');
          continue;
        }
        const observedRateLimit = readRedditRateLimit(response);
        if (observedRateLimit !== undefined) rateLimit = observedRateLimit;
        if (!response.ok) {
          ctx.log.warn(`Reddit retained post 재검증 실패 ${response.status}`);
          if (shouldStopForRateLimit(response, observedRateLimit)) break;
          continue;
        }

        let listing: RedditPost[];
        try {
          listing = parseRedditListing(response);
        } catch {
          ctx.log.warn('Reddit retained post 재검증 응답 파싱 실패');
          if (shouldStopForRateLimit(response, observedRateLimit)) break;
          continue;
        }
        const returned = new Map(listing.map((post) => [post.id, post]));
        for (const reference of chunk) {
          const post = returned.get(reference.sourceKey);
          if (post === undefined || isDeletedPost(post)) {
            deletedSourceKeys.push(reference.sourceKey);
            posts.delete(reference.sourceKey);
          } else {
            posts.set(reference.sourceKey, post);
          }
        }
        if (shouldStopForRateLimit(response, observedRateLimit)) break;
      }
    }

    return {
      items: [...posts.values()].map(postToItem),
      deletedSourceKeys: [...new Set(deletedSourceKeys)],
      rateLimit,
    };
  },
};
