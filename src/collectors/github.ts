import type { CollectedItem } from '../core/types.js';
import { CollectorError, type Collector, type FetchContext } from './types.js';

interface GhRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  topics?: string[];
  owner: { login: string } | null;
  created_at: string;
  pushed_at: string;
}

interface GhSearchResponse {
  items?: GhRepo[];
  message?: string;
}

function dateDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

function repoToItem(repo: GhRepo): CollectedItem {
  return {
    source: 'github',
    type: 'hot_repo',
    title: repo.full_name,
    url: repo.html_url,
    summary: repo.description,
    author: repo.owner?.login ?? null,
    score: repo.stargazers_count,
    commentsCount: null,
    tags: repo.topics ?? [],
    publishedAt: repo.created_at,
    raw: { stars: repo.stargazers_count, pushed_at: repo.pushed_at },
  };
}

export const githubCollector: Collector = {
  name: 'github',
  defaultTtlMinutes: 120,
  isEnabled: (config) => config.sources.github.enabled,
  async fetch(ctx: FetchContext): Promise<{ items: CollectedItem[] }> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    };
    const token = ctx.config.tokens.github;
    if (token) headers['authorization'] = `Bearer ${token}`;

    const queries = [
      `topic:llm topic:ai created:>${dateDaysAgo(ctx.now, 14)}`,
      `(llm OR "ai agent" OR rag) in:name,description pushed:>${dateDaysAgo(ctx.now, 7)} stars:>100`,
    ];

    const seen = new Map<string, CollectedItem>();
    for (const q of queries) {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`;
      const res = await ctx.http.get(url, { headers, timeoutMs: 15_000 });
      if (res.status === 403 || res.status === 429) {
        throw new CollectorError('github', 'http', `GitHub rate limit(${res.status})`, res.status);
      }
      if (!res.ok) {
        throw new CollectorError('github', 'http', `GitHub search 실패 ${res.status}`, res.status);
      }
      let data: GhSearchResponse;
      try {
        data = res.json<GhSearchResponse>();
      } catch (err) {
        throw new CollectorError('github', 'parse', `GitHub 응답 파싱 실패: ${String(err)}`);
      }
      for (const repo of data.items ?? []) {
        if (seen.has(repo.full_name)) continue;
        seen.set(repo.full_name, repoToItem(repo));
      }
    }
    return { items: [...seen.values()] };
  },
};
