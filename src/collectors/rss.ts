import Parser from 'rss-parser';
import type { ResolvedConfig, RssFeed } from '../core/config.js';
import { canonicalizeUrl } from '../core/normalize.js';
import type { LiveSightingInput } from '../core/types.js';
import { CollectorError, type Collector, type FetchContext } from './types.js';

/** rss-parser가 필드를 문자열/객체(CDATA·속성) 등 다양하게 줄 수 있어 안전하게 문자열화한다. */
function asString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const object = v as Record<string, unknown>;
    const inner = object['_'];
    if (typeof inner === 'string') return inner;
    const attributes = object['$'];
    if (attributes !== null && typeof attributes === 'object') {
      const term = (attributes as Record<string, unknown>)['term'];
      if (typeof term === 'string') return term;
    }
    return null;
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function asNonBlankString(value: unknown): string | null {
  const text = asString(value)?.trim();
  return text ? text : null;
}

function asStrings(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.map(asString).filter((item): item is string => item !== null && item.length > 0);
}

const FIGMA_AI_TERMS = [
  'ai',
  'artificial intelligence',
  'machine learning',
  'generative',
  'llm',
  'prompt',
  'agent',
  'figma make',
  'make kits',
  'first draft',
] as const;

const FIGMA_AI_MATCHERS = FIGMA_AI_TERMS.map((term) => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu');
});

function isFigmaAiItem(title: string, summary: string | null, categories: string[]): boolean {
  const text = [title, summary ?? '', ...categories].join(' ').toLowerCase();
  return FIGMA_AI_MATCHERS.some((matcher) => matcher.test(text));
}

function publicationPrecision(
  feedId: string,
  publishedAt: string | null,
  rawPublishedAt: string | null,
): LiveSightingInput['publishedPrecision'] {
  if (publishedAt === null) return 'inferred';
  if (feedId === 'figma' || /^\d{4}-\d{2}-\d{2}$/.test(rawPublishedAt ?? '')) {
    return 'date_only';
  }
  return 'exact_time';
}

function makeRssCollector(feed: RssFeed): Collector {
  const name = `rss:${feed.id}`;
  return {
    name,
    defaultTtlMinutes: 120,
    isEnabled: (config) => config.sources.rss.enabled,
    async fetch(ctx: FetchContext): Promise<{
      items: LiveSightingInput[];
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
        parsed = await new Parser<Record<string, unknown>, Record<string, unknown>>({
          customFields: {
            item: [
              ['category', 'categories', { keepArray: true }],
              ['pubDate', 'rawPubDate'],
              ['updated', 'rawUpdated'],
              ['published', 'rawPublished'],
            ],
          },
        }).parseString(res.text);
      } catch (err) {
        throw new CollectorError(name, 'parse', `RSS ${feed.id} 파싱 실패: ${String(err)}`);
      }

      const items: LiveSightingInput[] = [];
      for (const it of parsed.items) {
        const title = asString(it.title);
        const link = asString(it.link);
        if (!title || !link) continue;
        const summary =
          asString(it.contentSnippet) ??
          asString(it.content) ??
          asString(it.summary) ??
          asString(it.description);
        const categories = asStrings(it.categories);
        const publishedAt = asString(it.isoDate);
        const rawPublishedAt =
          asNonBlankString(it.rawPubDate) ??
          asNonBlankString(it.rawUpdated) ??
          asNonBlankString(it.rawPublished);
        if (feed.id === 'figma') {
          if (!isFigmaAiItem(title, summary, categories)) continue;
          if (ctx.config.retentionDays !== null && publishedAt !== null) {
            const publishedMs = Date.parse(publishedAt);
            const cutoffMs = ctx.now.getTime() - ctx.config.retentionDays * 86_400_000;
            if (!Number.isNaN(publishedMs) && publishedMs < cutoffMs) continue;
          }
        }
        items.push({
          source: name,
          sourceKey: asNonBlankString(it.guid) ?? asNonBlankString(it.id) ?? canonicalizeUrl(link),
          type: 'official_update',
          title,
          url: link,
          discussionUrl: null,
          summary: summary ? summary.slice(0, 2000) : null,
          author: asString(it.creator),
          score: null,
          scoreKind: null,
          commentsCount: null,
          tags: [feed.id, ...categories],
          publishedAt,
          publishedPrecision: publicationPrecision(feed.id, publishedAt, rawPublishedAt),
          activityAt: null,
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
