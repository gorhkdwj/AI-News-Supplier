import type { LiveSightingInput } from '../core/types.js';
import { CollectorError, type Collector, type FetchContext } from './types.js';

interface HfModel {
  id: string;
  likes?: number;
  downloads?: number;
  pipeline_tag?: string;
  trendingScore?: number;
  createdAt?: string;
  tags?: string[];
}

interface HfDailyPaper {
  paper: {
    id: string;
    title: string;
    summary?: string;
    upvotes?: number;
    publishedAt?: string;
  };
  publishedAt?: string;
  title?: string;
}

function truncate(s: string | undefined, max: number): string | null {
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function modelToItem(m: HfModel): LiveSightingInput {
  const tags = [m.pipeline_tag, ...(m.tags ?? [])]
    .filter((t): t is string => Boolean(t))
    .slice(0, 12);
  return {
    source: 'huggingface',
    sourceKey: `model:${m.id}`,
    type: 'model',
    title: m.id,
    url: `https://huggingface.co/${m.id}`,
    discussionUrl: null,
    summary: m.pipeline_tag ? `pipeline: ${m.pipeline_tag}` : null,
    author: m.id.includes('/') ? (m.id.split('/')[0] ?? null) : null,
    score: m.likes ?? null,
    scoreKind: 'likes',
    commentsCount: null,
    tags,
    publishedAt: m.createdAt ?? null,
    publishedPrecision: m.createdAt == null ? 'inferred' : 'exact_time',
    activityAt: null,
    raw: { downloads: m.downloads, trendingScore: m.trendingScore },
  };
}

function paperToItem(p: HfDailyPaper): LiveSightingInput {
  const publishedAt = p.publishedAt ?? p.paper.publishedAt ?? null;
  return {
    source: 'huggingface',
    sourceKey: `paper:${p.paper.id}`,
    type: 'paper',
    title: p.paper.title || p.title || p.paper.id,
    url: `https://huggingface.co/papers/${p.paper.id}`,
    discussionUrl: null,
    summary: truncate(p.paper.summary, 2000),
    author: null,
    score: p.paper.upvotes ?? null,
    scoreKind: 'upvotes',
    commentsCount: null,
    tags: ['paper'],
    publishedAt,
    publishedPrecision: publishedAt === null ? 'inferred' : 'exact_time',
    activityAt: null,
    raw: { paperId: p.paper.id },
  };
}

export const huggingfaceCollector: Collector = {
  name: 'huggingface',
  defaultTtlMinutes: 120,
  isEnabled: (config) => config.sources.huggingface.enabled,
  async fetch(ctx: FetchContext): Promise<{ items: LiveSightingInput[] }> {
    const items: LiveSightingInput[] = [];

    const modelsRes = await ctx.http.get(
      'https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=25',
      { timeoutMs: 15_000 },
    );
    if (!modelsRes.ok) {
      throw new CollectorError(
        'huggingface',
        'http',
        `HF models 실패 ${modelsRes.status}`,
        modelsRes.status,
      );
    }
    try {
      for (const m of modelsRes.json<HfModel[]>()) items.push(modelToItem(m));
    } catch (err) {
      throw new CollectorError('huggingface', 'parse', `HF models 파싱 실패: ${String(err)}`);
    }

    const papersRes = await ctx.http.get('https://huggingface.co/api/daily_papers?limit=30', {
      timeoutMs: 15_000,
    });
    if (!papersRes.ok) {
      throw new CollectorError(
        'huggingface',
        'http',
        `HF papers 실패 ${papersRes.status}`,
        papersRes.status,
      );
    }
    try {
      for (const p of papersRes.json<HfDailyPaper[]>()) {
        if (p.paper?.id) items.push(paperToItem(p));
      }
    } catch (err) {
      throw new CollectorError('huggingface', 'parse', `HF papers 파싱 실패: ${String(err)}`);
    }

    return { items };
  },
};
