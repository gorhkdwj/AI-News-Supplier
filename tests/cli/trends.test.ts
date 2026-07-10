import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { openDb } from '../../src/core/db/connection.js';
import { upsertSightings } from '../../src/core/store/sightingStore.js';
import type { LiveSightingInput } from '../../src/core/types.js';

const cliSrc = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));
const NOW = '2026-07-10T12:00:00.000Z';
let home: string;

function item(
  overrides: Partial<LiveSightingInput> & Pick<LiveSightingInput, 'sourceKey'>,
): LiveSightingInput {
  return {
    source: overrides.source ?? 'hackernews',
    sourceKey: overrides.sourceKey,
    type: overrides.type ?? 'community',
    title: overrides.title ?? overrides.sourceKey,
    url: overrides.url ?? `https://example.com/${overrides.sourceKey}`,
    discussionUrl: overrides.discussionUrl === undefined ? null : overrides.discussionUrl,
    summary: null,
    author: null,
    score: overrides.score === undefined ? 10 : overrides.score,
    scoreKind: overrides.scoreKind === undefined ? 'points' : overrides.scoreKind,
    commentsCount: overrides.commentsCount === undefined ? 1 : overrides.commentsCount,
    tags: ['ai'],
    publishedAt: overrides.publishedAt ?? NOW,
    publishedPrecision: 'exact_time',
    activityAt: overrides.activityAt === undefined ? null : overrides.activityAt,
    raw: null,
  };
}

function runCli(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', cliSrc, ...args], {
    encoding: 'utf8',
    env: { ...process.env, AINS_HOME: home },
    timeout: 30_000,
  });
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'ains-cli-trends-'));
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      sources: {
        hackernews: { enabled: false },
        github: { enabled: false },
        huggingface: { enabled: false },
        arxiv: { enabled: false },
        devto: { enabled: false },
        reddit: { enabled: false },
        rss: { enabled: false },
      },
    }),
  );
  const connection = openDb(join(home, 'data.db'));
  upsertSightings(
    connection,
    [
      item({ source: 'hackernews', sourceKey: 'hn', score: 11, scoreKind: 'points' }),
      item({ source: 'reddit', sourceKey: 'reddit', score: 22, scoreKind: 'upvotes' }),
      item({
        source: 'devto',
        sourceKey: 'dev',
        type: 'article',
        score: 33,
        scoreKind: 'reactions',
      }),
      item({
        source: 'github',
        sourceKey: 'repo',
        type: 'hot_repo',
        score: 44,
        scoreKind: 'stars',
        publishedAt: NOW,
        activityAt: NOW,
      }),
      item({
        source: 'rss:vendor',
        sourceKey: 'official',
        type: 'official_update',
        score: null,
        scoreKind: null,
        commentsCount: null,
      }),
      item({ source: 'arxiv', sourceKey: 'paper', type: 'paper', score: null, scoreKind: null }),
    ],
    NOW,
  );
  connection.close();
});

afterAll(() => {
  if (home) rmSync(home, { recursive: true, force: true });
});

describe('ains trends CLI process', () => {
  it('returns a top-level JSON array with contract snake_case fields', () => {
    const result = runCli(
      'trends',
      '--ranking',
      'v2',
      '--channel',
      'community',
      '--sort',
      'latest',
      '--no-refresh',
      '--json',
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const output = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
    expect(Array.isArray(output)).toBe(true);
    expect(output).toHaveLength(3);
    expect(output[0]).toMatchObject({
      sighting_id: expect.any(String),
      score_kind: expect.any(String),
      comments_count: expect.any(Number),
      published_precision: 'exact_time',
      ranking: { version: 'v2', channel: 'community', sort: 'latest' },
      hotness: null,
    });
    expect(output[0]).not.toHaveProperty('sightingId');
  });

  it('renders section headings and source-specific score labels without a generic star glyph', () => {
    const community = runCli(
      'trends',
      '--channel',
      'community',
      '--sort',
      'latest',
      '--no-refresh',
    );
    expect(community.status).toBe(0);
    expect(community.stdout).toContain('Community · latest');
    expect(community.stdout).toContain('points 11');
    expect(community.stdout).toContain('upvotes 22');
    expect(community.stdout).toContain('reactions 33');
    expect(community.stdout).not.toContain('★');

    const repos = runCli('trends', '--channel', 'repos', '--sort', 'discovery', '--no-refresh');
    expect(repos.status).toBe(0);
    expect(repos.stdout).toContain('Repos · discovery');
    expect(repos.stdout).toContain('stars 44');

    const overview = runCli('trends', '--ranking', 'v2', '--no-refresh');
    expect(overview.status).toBe(0);
    expect(overview.stdout).toContain('Official · important');
    expect(overview.stdout).toContain('Repos · trending');
    expect(overview.stdout).toContain('Community · hot');
    expect(overview.stdout).toContain('Research · hot');
  });

  it('exits 1 with stderr only for an invalid request', () => {
    const result = runCli(
      'trends',
      '--ranking',
      'v2',
      '--channel',
      'official',
      '--sort',
      'hot',
      '--no-refresh',
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('incompatible');
  });
});
