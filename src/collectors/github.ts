import type { LiveSightingInput } from '../core/types.js';
import { isAiRelevant } from './keywords.js';
import { CollectorError, type Collector, type FetchContext } from './types.js';

interface GhRepo {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  topics?: string[];
  owner: { login: string } | null;
  created_at: string | null;
  pushed_at: string | null;
  fork: boolean;
  archived: boolean;
}

interface GhSearchResponse {
  items: GhRepo[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isGhRepo(value: unknown): value is GhRepo {
  if (!isRecord(value)) return false;
  const owner = value['owner'];
  return (
    typeof value['id'] === 'number' &&
    Number.isFinite(value['id']) &&
    typeof value['full_name'] === 'string' &&
    typeof value['html_url'] === 'string' &&
    (value['description'] === null || typeof value['description'] === 'string') &&
    typeof value['stargazers_count'] === 'number' &&
    Number.isFinite(value['stargazers_count']) &&
    (value['topics'] === undefined ||
      (Array.isArray(value['topics']) &&
        value['topics'].every((topic) => typeof topic === 'string'))) &&
    (owner === null || (isRecord(owner) && typeof owner['login'] === 'string')) &&
    (value['created_at'] === null || typeof value['created_at'] === 'string') &&
    (value['pushed_at'] === null || typeof value['pushed_at'] === 'string') &&
    typeof value['fork'] === 'boolean' &&
    typeof value['archived'] === 'boolean'
  );
}

function dateDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

function repoToItem(repo: GhRepo): LiveSightingInput {
  return {
    source: 'github',
    sourceKey: String(repo.id),
    type: 'hot_repo',
    title: repo.full_name,
    url: repo.html_url,
    discussionUrl: null,
    summary: repo.description,
    author: repo.owner?.login ?? null,
    score: repo.stargazers_count,
    scoreKind: 'stars',
    commentsCount: null,
    tags: repo.topics ?? [],
    publishedAt: repo.created_at,
    publishedPrecision: repo.created_at === null ? 'inferred' : 'exact_time',
    activityAt: repo.pushed_at,
    raw: { stars: repo.stargazers_count, pushed_at: repo.pushed_at },
  };
}

function isEligibleRepo(repo: GhRepo, extraKeywords: readonly string[]): boolean {
  if (repo.fork || repo.archived) return false;
  const relevanceText = [repo.full_name, repo.description ?? '', ...(repo.topics ?? [])].join(' ');
  return isAiRelevant(relevanceText, extraKeywords);
}

function repositoryCoordinates(sourceUrl: string): { owner: string; repo: string } | null {
  try {
    const url = new URL(sourceUrl);
    if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2) return null;
    const owner = decodeURIComponent(segments[0]!);
    const repo = decodeURIComponent(segments[1]!).replace(/\.git$/i, '');
    return owner && repo ? { owner, repo } : null;
  } catch {
    return null;
  }
}

export const githubCollector: Collector = {
  name: 'github',
  defaultTtlMinutes: 120,
  isEnabled: (config) => config.sources.github.enabled,
  async fetch(ctx: FetchContext): Promise<{
    items: LiveSightingInput[];
    deletedSourceKeys: string[];
  }> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    };
    const token = ctx.config.tokens.github;
    if (token) headers['authorization'] = `Bearer ${token}`;

    const aiTerms = '(ai OR llm OR gpt OR rag OR agentic)';
    const fourteenDaysAgo = dateDaysAgo(ctx.now, 14);
    const queries = [
      `${aiTerms} in:name,description,topics created:>=${fourteenDaysAgo}`,
      `${aiTerms} in:name,description,topics pushed:>=${fourteenDaysAgo} stars:>=100`,
    ];

    const seen = new Map<number, LiveSightingInput>();
    const observedIds = new Set<string>();
    for (const q of queries) {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=100`;
      const res = await ctx.http.get(url, { headers, timeoutMs: 15_000 });
      if (res.status === 403 || res.status === 429) {
        throw new CollectorError('github', 'http', `GitHub rate limit(${res.status})`, res.status);
      }
      if (!res.ok) {
        throw new CollectorError('github', 'http', `GitHub search 실패 ${res.status}`, res.status);
      }
      let data: GhSearchResponse;
      try {
        const parsed = res.json<unknown>();
        if (
          !isRecord(parsed) ||
          !Array.isArray(parsed['items']) ||
          !parsed['items'].every(isGhRepo)
        ) {
          throw new Error('Invalid GitHub search shape');
        }
        data = parsed as unknown as GhSearchResponse;
      } catch {
        throw new CollectorError('github', 'parse', 'GitHub 응답 검증 실패');
      }
      for (const repo of data.items ?? []) {
        observedIds.add(String(repo.id));
        if (seen.has(repo.id) || !isEligibleRepo(repo, ctx.config.extraKeywords)) continue;
        seen.set(repo.id, repoToItem(repo));
      }
    }

    const deletedSourceKeys: string[] = [];
    const tracked = [
      ...new Map(
        (ctx.trackedSightings ?? []).map((reference) => [reference.sourceKey, reference]),
      ).values(),
    ];
    const omitted = tracked
      .filter((reference) => {
        if (observedIds.has(reference.sourceKey)) {
          if (!seen.has(Number(reference.sourceKey))) deletedSourceKeys.push(reference.sourceKey);
          return false;
        }
        return repositoryCoordinates(reference.sourceUrl) !== null;
      })
      .sort(
        (left, right) =>
          left.lastSeenAt.localeCompare(right.lastSeenAt) ||
          left.sourceKey.localeCompare(right.sourceKey),
      )
      .slice(0, 50);

    for (const reference of omitted) {
      const coordinates = repositoryCoordinates(reference.sourceUrl)!;
      const url = `https://api.github.com/repos/${encodeURIComponent(coordinates.owner)}/${encodeURIComponent(coordinates.repo)}`;
      const response = await ctx.http.get(url, { headers, timeoutMs: 15_000 });
      if (response.status === 403 || response.status === 429) {
        throw new CollectorError(
          'github',
          'http',
          `GitHub rate limit(${response.status})`,
          response.status,
        );
      }
      if (response.status === 404) {
        deletedSourceKeys.push(reference.sourceKey);
        continue;
      }
      if (!response.ok) {
        ctx.log.warn(`GitHub tracked repository 재확인 실패 ${response.status}`);
        continue;
      }

      let repo: GhRepo;
      try {
        const parsed = response.json<unknown>();
        if (!isGhRepo(parsed)) throw new Error('Invalid GitHub repository shape');
        repo = parsed;
      } catch {
        ctx.log.warn('GitHub tracked repository 재확인 응답 파싱 실패');
        continue;
      }
      if (!isEligibleRepo(repo, ctx.config.extraKeywords)) {
        deletedSourceKeys.push(reference.sourceKey);
        continue;
      }
      seen.set(repo.id, repoToItem(repo));
    }

    return { items: [...seen.values()], deletedSourceKeys: [...new Set(deletedSourceKeys)] };
  },
};
