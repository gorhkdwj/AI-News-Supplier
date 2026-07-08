import Parser from 'rss-parser';
import type { ResolvedConfig, RssFeed } from '../core/config.js';
import type { CollectedItem } from '../core/types.js';
import { CollectorError, type Collector, type FetchContext } from './types.js';

/** rss-parser가 필드를 문자열/객체(CDATA·속성) 등 다양하게 줄 수 있어 안전하게 문자열화한다. */
function asString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const inner = (v as Record<string, unknown>)['_'];
    return typeof inner === 'string' ? inner : null;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function makeRssCollector(feed: RssFeed): Collector {
  const name = `rss:${feed.id}`;
  return {
    name,
    defaultTtlMinutes: 120,
    isEnabled: (config) => config.sources.rss.enabled,
    async fetch(ctx: FetchContext): Promise<{
      items: CollectedItem[];
      notModified?: boolean;
      etag?: string | null;
      lastModified?: string | null;
    }> {
      const res = await ctx.http.get(feed.url, {
        timeoutMs: 15_000,
        etag: ctx.state?.etag,
        lastModified: ctx.state?.lastModified,
      });
      if (res.notModified) return { items: [], notModified: true };
      if (!res.ok) {
        throw new CollectorError(name, 'http', `RSS ${feed.id} 실패 ${res.status}`, res.status);
      }

      let parsed: Parser.Output<Record<string, unknown>>;
      try {
        parsed = await new Parser().parseString(res.text);
      } catch (err) {
        throw new CollectorError(name, 'parse', `RSS ${feed.id} 파싱 실패: ${String(err)}`);
      }

      const items: CollectedItem[] = [];
      for (const it of parsed.items) {
        const title = asString(it.title);
        const link = asString(it.link);
        if (!title || !link) continue;
        const summary = asString(it.contentSnippet);
        items.push({
          source: name,
          type: 'official_update',
          title,
          url: link,
          summary: summary ? summary.slice(0, 2000) : null,
          author: asString(it.creator),
          score: null,
          commentsCount: null,
          tags: [feed.id],
          publishedAt: asString(it.isoDate),
          raw: { feedId: feed.id },
        });
      }
      return { items, etag: res.etag, lastModified: res.lastModified };
    },
  };
}

/** 설정의 각 RSS 피드마다 개별 수집기 인스턴스를 만든다(피드별 상태/오류 격리). */
export function makeRssCollectors(config: ResolvedConfig): Collector[] {
  if (!config.sources.rss.enabled) return [];
  return config.sources.rss.feeds.map(makeRssCollector);
}
