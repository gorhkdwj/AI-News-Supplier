import { XMLParser } from 'fast-xml-parser';
import type { LiveSightingInput } from '../core/types.js';
import { CollectorError, type Collector, type FetchContext } from './types.js';

interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  published?: string;
  author?: { name: string } | { name: string }[];
  category?: { '@_term': string } | { '@_term': string }[];
}

function toArray<T>(v: T | T[] | undefined): T[] {
  return Array.isArray(v) ? v : v != null ? [v] : [];
}

function cleanText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** http://arxiv.org/abs/2607.06565v1 → https://arxiv.org/abs/2607.06565 (버전 접미사 제거로 dedup) */
function absUrl(id: string): string {
  return id.replace(/^http:/, 'https:').replace(/v\d+$/, '');
}

function entryToItem(entry: ArxivEntry): LiveSightingInput {
  const cats = toArray(entry.category)
    .map((c) => c['@_term'])
    .filter((t): t is string => Boolean(t));
  const authors = toArray(entry.author).map((a) => a.name);
  const url = absUrl(entry.id);
  const sourceKey = url.slice(url.lastIndexOf('/') + 1);
  const publishedAt = entry.published ?? null;
  return {
    source: 'arxiv',
    sourceKey,
    type: 'paper',
    title: cleanText(entry.title),
    url,
    discussionUrl: null,
    summary: cleanText(entry.summary).slice(0, 2000),
    author: authors[0] ?? null,
    score: null,
    scoreKind: null,
    commentsCount: null,
    tags: cats,
    publishedAt,
    publishedPrecision: publishedAt === null ? 'inferred' : 'exact_time',
    activityAt: null,
    raw: { categories: cats, authors: authors.slice(0, 5) },
  };
}

export const arxivCollector: Collector = {
  name: 'arxiv',
  defaultTtlMinutes: 360,
  isEnabled: (config) => config.sources.arxiv.enabled,
  async fetch(ctx: FetchContext): Promise<{ items: LiveSightingInput[] }> {
    const cats = ctx.config.sources.arxiv.categories;
    // arXiv는 raw '+OR+' 문법을 기대하므로 encodeURIComponent를 쓰지 않는다.
    const searchQuery = cats.map((c) => `cat:${c}`).join('+OR+');
    const url = `http://export.arxiv.org/api/query?search_query=${searchQuery}&sortBy=submittedDate&sortOrder=descending&max_results=75`;

    const res = await ctx.http.get(url, { timeoutMs: 20_000 });
    if (!res.ok) {
      throw new CollectorError('arxiv', 'http', `arXiv 실패 ${res.status}`, res.status);
    }
    let entries: ArxivEntry[];
    try {
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
      const parsed = parser.parse(res.text) as { feed?: { entry?: ArxivEntry | ArxivEntry[] } };
      entries = toArray(parsed.feed?.entry);
    } catch (err) {
      throw new CollectorError('arxiv', 'parse', `arXiv 파싱 실패: ${String(err)}`);
    }
    return { items: entries.filter((e) => e.id && e.title).map(entryToItem) };
  },
};
