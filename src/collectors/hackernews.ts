import type { CollectedItem } from '../core/types.js';
import { isAiRelevant } from './keywords.js';
import { CollectorError, type Collector, type FetchContext } from './types.js';

interface HnHit {
  objectID: string;
  title: string | null;
  url: string | null;
  author: string | null;
  points: number | null;
  num_comments: number | null;
  created_at: string | null;
  created_at_i: number | null;
  story_text?: string | null;
}

interface HnSearchResponse {
  hits: HnHit[];
}

const QUERIES = ['AI', 'LLM', 'GPT', 'AI agent', 'open source model'];
const WINDOW_HOURS = 72;

function hitToItem(hit: HnHit, extraKeywords: readonly string[]): CollectedItem | null {
  if (!hit.title) return null;
  const haystack = `${hit.title} ${hit.story_text ?? ''}`;
  if (!isAiRelevant(haystack, extraKeywords)) return null;

  const url = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;
  const publishedAt = hit.created_at ?? (hit.created_at_i != null ? new Date(hit.created_at_i * 1000).toISOString() : null);

  return {
    source: 'hackernews',
    type: 'community',
    title: hit.title,
    url,
    summary: hit.story_text ?? null,
    author: hit.author,
    score: hit.points,
    commentsCount: hit.num_comments,
    tags: [],
    publishedAt,
    raw: {
      objectID: hit.objectID,
      points: hit.points,
      num_comments: hit.num_comments,
    },
  };
}

export const hackernewsCollector: Collector = {
  name: 'hackernews',
  defaultTtlMinutes: 30,
  isEnabled: (config) => config.sources.hackernews.enabled,
  async fetch(ctx: FetchContext): Promise<{ items: CollectedItem[] }> {
    const minPoints = ctx.config.sources.hackernews.minPoints;
    const sinceI = Math.floor((ctx.now.getTime() - WINDOW_HOURS * 3_600_000) / 1000);
    const seen = new Map<string, CollectedItem>();

    for (const q of QUERIES) {
      // HN Algolia는 points를 numericFilters로 지원하지 않는다(400). 시간만 필터하고
      // minPoints는 클라이언트에서 거른다.
      const numeric = encodeURIComponent(`created_at_i>${sinceI}`);
      const url = `https://hn.algolia.com/api/v1/search?tags=story&numericFilters=${numeric}&query=${encodeURIComponent(q)}&hitsPerPage=50`;
      const res = await ctx.http.get(url, { timeoutMs: 15_000 });
      if (!res.ok) {
        throw new CollectorError('hackernews', 'http', `HN search 실패 ${res.status}`, res.status);
      }
      let data: HnSearchResponse;
      try {
        data = res.json<HnSearchResponse>();
      } catch (err) {
        throw new CollectorError('hackernews', 'parse', `HN 응답 파싱 실패: ${String(err)}`);
      }
      for (const hit of data.hits) {
        if (seen.has(hit.objectID)) continue;
        if ((hit.points ?? 0) < minPoints) continue;
        const item = hitToItem(hit, ctx.config.extraKeywords);
        if (item) seen.set(hit.objectID, item);
      }
    }

    return { items: [...seen.values()] };
  },
};
