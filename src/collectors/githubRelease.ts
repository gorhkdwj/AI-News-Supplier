import type { LiveSightingInput } from '../core/types.js';
import { CollectorError, type Collector, type FetchContext } from './types.js';

const SOURCE = 'github_release:gemini-cli';
const RELEASES_URL = 'https://api.github.com/repos/google-gemini/gemini-cli/releases?per_page=100';

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  html_url: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  author?: { login?: string } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isGitHubRelease(value: unknown): value is GitHubRelease {
  if (!isRecord(value)) return false;
  const author = value['author'];
  return (
    typeof value['id'] === 'number' &&
    Number.isFinite(value['id']) &&
    typeof value['tag_name'] === 'string' &&
    (value['name'] === null || typeof value['name'] === 'string') &&
    typeof value['html_url'] === 'string' &&
    (value['body'] === null || typeof value['body'] === 'string') &&
    typeof value['draft'] === 'boolean' &&
    typeof value['prerelease'] === 'boolean' &&
    (value['published_at'] === null || typeof value['published_at'] === 'string') &&
    (author === undefined ||
      author === null ||
      (isRecord(author) && (author['login'] === undefined || typeof author['login'] === 'string')))
  );
}

function releaseToSighting(release: GitHubRelease): LiveSightingInput {
  return {
    source: SOURCE,
    sourceKey: String(release.id),
    type: 'official_update',
    title: release.name || release.tag_name,
    url: release.html_url,
    discussionUrl: null,
    summary: release.body ? release.body.slice(0, 2000) : null,
    author: release.author?.login ?? null,
    score: null,
    scoreKind: null,
    commentsCount: null,
    tags: ['gemini-cli', 'release'],
    publishedAt: release.published_at,
    publishedPrecision: release.published_at === null ? 'inferred' : 'exact_time',
    activityAt: null,
    raw: { tagName: release.tag_name },
  };
}

export const geminiCliReleaseCollector: Collector = {
  name: SOURCE,
  defaultTtlMinutes: 120,
  isEnabled: (config) => config.sources.github.enabled,
  async fetch(ctx: FetchContext): Promise<{ items: LiveSightingInput[] }> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    };
    if (ctx.config.tokens.github) {
      headers['authorization'] = `Bearer ${ctx.config.tokens.github}`;
    }

    const response = await ctx.http.get(RELEASES_URL, { headers, timeoutMs: 15_000 });
    if (response.status === 403 || response.status === 429) {
      throw new CollectorError(
        SOURCE,
        'http',
        `GitHub rate limit(${response.status})`,
        response.status,
      );
    }
    if (!response.ok) {
      throw new CollectorError(
        SOURCE,
        'http',
        `Gemini CLI releases 실패 ${response.status}`,
        response.status,
      );
    }

    let releases: GitHubRelease[];
    try {
      const parsed = response.json<unknown>();
      if (!Array.isArray(parsed) || !parsed.every(isGitHubRelease)) {
        throw new Error('Invalid GitHub releases shape');
      }
      releases = parsed;
    } catch {
      throw new CollectorError(SOURCE, 'parse', 'Gemini CLI releases 응답 검증 실패');
    }
    return {
      items: releases
        .filter((release) => !release.draft && !release.prerelease)
        .map(releaseToSighting),
    };
  },
};
