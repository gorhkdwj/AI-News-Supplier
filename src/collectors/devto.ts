import type { LiveSightingInput } from '../core/types.js';
import { isAiRelevant } from './keywords.js';
import { CollectorError, type Collector, type FetchContext } from './types.js';

interface DevtoArticle {
  id: number;
  title: string;
  url: string;
  description: string | null;
  positive_reactions_count: number;
  comments_count: number;
  published_at: string | null;
  tag_list: string[] | string;
  user?: { name?: string };
}

function toTags(tagList: string[] | string): string[] {
  if (Array.isArray(tagList)) return tagList;
  return tagList
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function articleToItem(a: DevtoArticle): LiveSightingInput {
  return {
    source: 'devto',
    sourceKey: String(a.id),
    type: 'article',
    title: a.title,
    url: a.url,
    discussionUrl: null,
    summary: a.description,
    author: a.user?.name ?? null,
    score: a.positive_reactions_count,
    scoreKind: 'reactions',
    commentsCount: a.comments_count,
    tags: toTags(a.tag_list),
    publishedAt: a.published_at,
    publishedPrecision: a.published_at === null ? 'inferred' : 'exact_time',
    activityAt: null,
    raw: { id: a.id },
  };
}

export const devtoCollector: Collector = {
  name: 'devto',
  defaultTtlMinutes: 180,
  isEnabled: (config) => config.sources.devto.enabled,
  async fetch(ctx: FetchContext): Promise<{ items: LiveSightingInput[] }> {
    const { tags, minReactions } = ctx.config.sources.devto;
    const seen = new Map<number, LiveSightingInput>();

    for (const tag of tags) {
      const url = `https://dev.to/api/articles?tag=${encodeURIComponent(tag)}&top=7&per_page=30`;
      const res = await ctx.http.get(url, { timeoutMs: 15_000 });
      if (!res.ok) {
        throw new CollectorError('devto', 'http', `DEV.to 실패 ${res.status}`, res.status);
      }
      let articles: DevtoArticle[];
      try {
        articles = res.json<DevtoArticle[]>();
      } catch (err) {
        throw new CollectorError('devto', 'parse', `DEV.to 응답 파싱 실패: ${String(err)}`);
      }
      for (const a of articles) {
        if (seen.has(a.id)) continue;
        if (a.positive_reactions_count < minReactions) continue;
        // 태그로 넓게 걸러오므로 제목/요약에 AI 관련성을 한 번 더 확인한다.
        if (!isAiRelevant(`${a.title} ${a.description ?? ''}`, ctx.config.extraKeywords)) continue;
        seen.set(a.id, articleToItem(a));
      }
    }
    return { items: [...seen.values()] };
  },
};
