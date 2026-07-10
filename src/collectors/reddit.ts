import type { LiveSightingInput } from '../core/types.js';
import { CollectorError, type Collector, type FetchContext } from './types.js';

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
}

interface RedditListing {
  data?: { children?: { data: RedditPost }[] };
}

interface RedditTokenResponse {
  access_token: string;
  expires_in: number;
}

// 액세스 토큰은 메모리에만 캐시한다(디스크/로그에 남기지 않는다).
let cachedToken: { token: string; expiresAtMs: number } | null = null;

/** 테스트에서 토큰 캐시를 초기화한다. */
export function resetRedditTokenCache(): void {
  cachedToken = null;
}

async function getAccessToken(ctx: FetchContext): Promise<string> {
  if (cachedToken && cachedToken.expiresAtMs > ctx.now.getTime()) return cachedToken.token;
  const { clientId, clientSecret } = ctx.config.tokens.reddit;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await ctx.http.postForm(
    'https://www.reddit.com/api/v1/access_token',
    { grant_type: 'client_credentials' },
    { headers: { authorization: `Basic ${basic}` }, timeoutMs: 15_000 },
  );
  if (!res.ok) {
    throw new CollectorError('reddit', 'auth', `Reddit 토큰 발급 실패 ${res.status}`, res.status);
  }
  const data = res.json<RedditTokenResponse>();
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

export const redditCollector: Collector = {
  name: 'reddit',
  defaultTtlMinutes: 60,
  // 자격증명이 모두 있을 때만 활성(없으면 오류가 아니라 조용히 비활성).
  isEnabled: (config) =>
    config.sources.reddit.enabled &&
    Boolean(config.tokens.reddit.clientId) &&
    Boolean(config.tokens.reddit.clientSecret),
  async fetch(ctx: FetchContext): Promise<{ items: LiveSightingInput[] }> {
    const token = await getAccessToken(ctx);
    const subs = ctx.config.sources.reddit.subreddits.join('+');
    const url = `https://oauth.reddit.com/r/${subs}/hot?limit=50`;
    const res = await ctx.http.get(url, {
      headers: { authorization: `Bearer ${token}` },
      timeoutMs: 15_000,
    });
    if (!res.ok) {
      throw new CollectorError('reddit', 'http', `Reddit 실패 ${res.status}`, res.status);
    }
    let listing: RedditListing;
    try {
      listing = res.json<RedditListing>();
    } catch (err) {
      throw new CollectorError('reddit', 'parse', `Reddit 파싱 실패: ${String(err)}`);
    }
    const posts = (listing.data?.children ?? []).map((c) => c.data).filter((p) => !p.stickied);
    return { items: posts.map(postToItem) };
  },
};
