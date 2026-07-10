import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { mineLearningCandidates, type LearningCandidate } from '../../src/core/learning/candidates.js';
import { openDb, type DB } from '../../src/core/db/connection.js';
import { itemId } from '../../src/core/normalize.js';
import { recordLearning } from '../../src/core/store/learningStore.js';
import { upsertSightings } from '../../src/core/store/sightingStore.js';
import { getTrends } from '../../src/core/trends/service.js';
import type { LiveSightingInput, NewsItem } from '../../src/core/types.js';

const NOW = new Date('2026-07-10T12:00:00.000Z');
const openDbs: DB[] = [];

function db(): DB {
  const connection = openDb(':memory:');
  openDbs.push(connection);
  return connection;
}

afterEach(() => {
  while (openDbs.length > 0) openDbs.pop()?.close();
});

function live(
  overrides: Partial<LiveSightingInput> & Pick<LiveSightingInput, 'source' | 'sourceKey' | 'url'>,
): LiveSightingInput {
  return {
    source: overrides.source,
    sourceKey: overrides.sourceKey,
    type: overrides.type ?? 'community',
    title: overrides.title ?? 'Transformer systems update',
    url: overrides.url,
    discussionUrl: overrides.discussionUrl ?? null,
    summary: overrides.summary ?? null,
    author: overrides.author ?? null,
    score: overrides.score === undefined ? 10 : overrides.score,
    scoreKind: overrides.scoreKind === undefined ? 'points' : overrides.scoreKind,
    commentsCount: overrides.commentsCount === undefined ? 1 : overrides.commentsCount,
    tags: overrides.tags ?? ['transformer'],
    publishedAt: overrides.publishedAt ?? '2026-07-09T12:00:00.000Z',
    publishedPrecision: overrides.publishedPrecision ?? 'exact_time',
    activityAt: overrides.activityAt ?? null,
    raw: overrides.raw ?? null,
  };
}

function evidenceItems(candidate: LearningCandidate): NewsItem[] {
  return [
    ...candidate.evidence.official,
    ...candidate.evidence.papers,
    ...candidate.evidence.repos,
    ...candidate.evidence.discussion,
  ];
}

function transformerCandidate(connection: DB): LearningCandidate {
  const candidate = mineLearningCandidates(connection, {
    now: NOW,
    sinceDays: 7,
    limit: 10,
  }).find((entry) => entry.normalizedTopic === 'transformer');
  expect(candidate).toBeDefined();
  return candidate as LearningCandidate;
}

describe('v2 learning evidence', () => {
  it('deduplicates a multi-Sighting Story, uses its maximum available channel score, and retains warming evidence', () => {
    const connection = db();
    const sharedUrl = 'https://vendor.example.com/transformer-release';
    const sharedCommunity = live({
      source: 'hackernews',
      sourceKey: 'shared-hn',
      url: sharedUrl,
      score: 20,
      commentsCount: 5,
    });
    upsertSightings(connection, [sharedCommunity], '2026-07-09T12:00:00.000Z');
    upsertSightings(
      connection,
      [{ ...sharedCommunity, score: 50, commentsCount: 10 }],
      '2026-07-10T06:00:00.000Z',
    );
    upsertSightings(
      connection,
      [{ ...sharedCommunity, score: 100, commentsCount: 20 }],
      NOW.toISOString(),
    );
    upsertSightings(
      connection,
      [
        live({
          source: 'rss:vendor',
          sourceKey: 'release-feed',
          url: sharedUrl,
          type: 'official_update',
          title: 'Transformer customer story',
          score: null,
          scoreKind: null,
          commentsCount: null,
          publishedAt: '2026-07-10T11:00:00.000Z',
        }),
        live({
          source: 'reddit',
          sourceKey: 'warming-discussion',
          url: 'https://example.com/transformer-warming',
          score: 500,
          commentsCount: 50,
          publishedAt: '2026-07-10T10:00:00.000Z',
        }),
        live({
          source: 'github',
          sourceKey: 'warming-repo',
          url: 'https://github.com/example/transformer-warming',
          type: 'hot_repo',
          title: 'Transformer warming repository',
          score: 10,
          scoreKind: 'stars',
          commentsCount: null,
          publishedAt: '2026-07-09T18:00:00.000Z',
          activityAt: NOW.toISOString(),
        }),
      ],
      NOW.toISOString(),
    );

    const storyId = itemId(sharedUrl);
    const community = getTrends(
      connection,
      { rankingVersion: 'v2', channel: 'community', sort: 'hot', sinceHours: 168, limit: 20 },
      { now: NOW },
    );
    const official = getTrends(
      connection,
      { rankingVersion: 'v2', channel: 'official', sort: 'important', sinceHours: 168, limit: 20 },
      { now: NOW },
    );
    const sharedCommunityRank = community.items.find((entry) => entry.id === storyId);
    const sharedOfficialRank = official.items.find((entry) => entry.id === storyId);
    const warmingCommunityRank = community.items.find(
      (entry) => entry.id === itemId('https://example.com/transformer-warming'),
    );
    expect(sharedCommunityRank?.ranking.coverage).toBe('full');
    expect(sharedOfficialRank?.ranking.coverage).toBe('full');
    expect(warmingCommunityRank?.ranking.coverage).toBe('warming');
    expect(warmingCommunityRank?.ranking.score).not.toBeNull();

    const candidate = transformerCandidate(connection);
    const availableScores = [
      sharedCommunityRank?.ranking.score,
      sharedOfficialRank?.ranking.score,
    ].filter((score): score is number => score !== null && score !== undefined);
    const evidence = evidenceItems(candidate);

    expect(candidate.signals.itemCount).toBe(3);
    expect(candidate.signals.sourceSpread).toBe(4);
    expect(candidate.signals.hotSum).toBe(Math.max(...availableScores));
    expect(evidence.map((entry) => entry.id)).toHaveLength(3);
    expect(new Set(evidence.map((entry) => entry.id)).size).toBe(3);
    expect(evidence.map((entry) => entry.id)).toContain(
      itemId('https://example.com/transformer-warming'),
    );
    expect(evidence.map((entry) => entry.id)).toContain(
      itemId('https://github.com/example/transformer-warming'),
    );
  });

  it('sums only the top five unique Story scores while keeping every Story as evidence', () => {
    const connection = db();
    for (let index = 0; index < 6; index += 1) {
      upsertSightings(
        connection,
        [
          live({
            source: index % 2 === 0 ? 'rss:vendor-a' : 'rss:vendor-b',
            sourceKey: `official-${index}`,
            url: `https://vendor.example.com/transformer-${index}`,
            type: 'official_update',
            title: `Transformer API release ${index}`,
            score: null,
            scoreKind: null,
            commentsCount: null,
            publishedAt: new Date(NOW.getTime() - index * 3_600_000).toISOString(),
          }),
        ],
        NOW.toISOString(),
      );
    }

    const ranked = getTrends(
      connection,
      { rankingVersion: 'v2', channel: 'official', sort: 'important', sinceHours: 168, limit: 20 },
      { now: NOW },
    );
    const expected = Math.round(
      ranked.items
        .map((entry) => entry.ranking.score as number)
        .sort((left, right) => right - left)
        .slice(0, 5)
        .reduce((sum, score) => sum + score, 0) * 1_000,
    ) / 1_000;

    const candidate = transformerCandidate(connection);
    expect(candidate.signals.itemCount).toBe(6);
    expect(candidate.signals.hotSum).toBe(expected);
    expect(evidenceItems(candidate)).toHaveLength(6);
  });

  it('includes an established repository with recent activity and complete trend baselines', () => {
    const connection = db();
    const repoUrl = 'https://github.com/example/established-transformer';
    const repo = live({
      source: 'github',
      sourceKey: 'established-transformer',
      url: repoUrl,
      type: 'hot_repo',
      title: 'Established Transformer repository',
      score: 1_000,
      scoreKind: 'stars',
      commentsCount: null,
      publishedAt: '2025-01-01T00:00:00.000Z',
      activityAt: '2026-07-03T12:00:00.000Z',
    });
    upsertSightings(connection, [repo], '2026-07-03T12:00:00.000Z');
    upsertSightings(
      connection,
      [{ ...repo, score: 1_500, activityAt: '2026-07-09T12:00:00.000Z' }],
      '2026-07-09T12:00:00.000Z',
    );
    upsertSightings(
      connection,
      [{ ...repo, score: 2_000, activityAt: NOW.toISOString() }],
      NOW.toISOString(),
    );
    upsertSightings(
      connection,
      [
        live({
          source: 'rss:vendor',
          sourceKey: 'established-companion',
          url: 'https://vendor.example.com/transformer-companion',
          type: 'official_update',
          score: null,
          scoreKind: null,
          commentsCount: null,
          publishedAt: '2026-07-10T11:00:00.000Z',
        }),
      ],
      NOW.toISOString(),
    );

    const repositoryRank = getTrends(
      connection,
      { rankingVersion: 'v2', channel: 'repos', sort: 'trending', sinceHours: 168, limit: 20 },
      { now: NOW },
    ).items.find((entry) => entry.id === itemId(repoUrl));
    expect(repositoryRank?.ranking.coverage).toBe('full');

    const candidate = transformerCandidate(connection);
    expect(evidenceItems(candidate).map((entry) => entry.id)).toContain(itemId(repoUrl));
    expect(candidate.signals.hotSum).toBeGreaterThanOrEqual(repositoryRank!.ranking.score as number);
  });

  it('does not let an out-of-window alternate Sighting inflate sourceSpread', () => {
    const connection = db();
    const sharedUrl = 'https://vendor.example.com/transformer-window';
    upsertSightings(
      connection,
      [
        live({
          source: 'hackernews',
          sourceKey: 'old-window-discussion',
          url: sharedUrl,
          publishedAt: '2026-07-02T11:59:59.000Z',
        }),
      ],
      '2026-07-02T11:59:59.000Z',
    );
    upsertSightings(
      connection,
      [
        live({
          source: 'rss:vendor',
          sourceKey: 'current-window-official',
          url: sharedUrl,
          type: 'official_update',
          score: null,
          scoreKind: null,
          commentsCount: null,
          publishedAt: NOW.toISOString(),
        }),
        live({
          source: 'arxiv',
          sourceKey: 'current-window-paper',
          url: 'https://arxiv.org/abs/2607.00002',
          type: 'paper',
          score: null,
          scoreKind: null,
          commentsCount: null,
          publishedAt: NOW.toISOString(),
        }),
      ],
      NOW.toISOString(),
    );

    const candidate = transformerCandidate(connection);
    expect(candidate.signals.sourceSpread).toBe(2);
  });

  it('uses only live 24-hour Sighting snapshots for velocity and clamps the maximum ratio to two', () => {
    const connection = db();
    const fastUrl = 'https://example.com/transformer-fast';
    const fast = live({
      source: 'hackernews',
      sourceKey: 'fast',
      url: fastUrl,
      score: 10,
      commentsCount: 2,
    });
    upsertSightings(connection, [fast], '2026-07-09T12:00:00.000Z');
    upsertSightings(
      connection,
      [{ ...fast, score: 40, commentsCount: 4 }],
      NOW.toISOString(),
    );
    upsertSightings(
      connection,
      [
        live({
          source: 'rss:vendor',
          sourceKey: 'velocity-evidence',
          url: 'https://vendor.example.com/transformer-velocity',
          type: 'official_update',
          score: null,
          scoreKind: null,
          commentsCount: null,
        }),
      ],
      NOW.toISOString(),
    );

    const storyId = itemId(fastUrl);
    connection
      .prepare('INSERT INTO score_history(item_id, observed_at, score) VALUES (?, ?, ?)')
      .run(storyId, '2026-07-09T12:00:00.000Z', 10_000);
    connection
      .prepare('INSERT INTO score_history(item_id, observed_at, score) VALUES (?, ?, ?)')
      .run(storyId, NOW.toISOString(), 1);

    const candidate = transformerCandidate(connection);
    expect(candidate.signals.velocity).toBe(2);

    const source = readFileSync(
      new URL('../../src/core/learning/candidates.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/score_history|getScoreHistory/);
  });

  it('preserves the exact recent-learning novelty multiplier', () => {
    const connection = db();
    upsertSightings(
      connection,
      [
        live({
          source: 'rss:vendor',
          sourceKey: 'novelty-official',
          url: 'https://vendor.example.com/transformer-novelty',
          type: 'official_update',
          score: null,
          scoreKind: null,
          commentsCount: null,
        }),
        live({
          source: 'arxiv',
          sourceKey: 'novelty-paper',
          url: 'https://arxiv.org/abs/2607.00001',
          type: 'paper',
          score: null,
          scoreKind: null,
          commentsCount: null,
        }),
      ],
      NOW.toISOString(),
    );
    recordLearning(connection, { topic: 'transformer', now: NOW.toISOString() });

    const candidate = mineLearningCandidates(connection, {
      now: NOW,
      sinceDays: 7,
      includeLearned: true,
      limit: 10,
    }).find((entry) => entry.normalizedTopic === 'transformer');
    expect(candidate).toBeDefined();
    const signals = candidate!.signals;
    const expected = Math.round(
      0.15 *
        (2 * signals.sourceSpread +
          signals.hotSum +
          signals.velocity +
          Math.log(1 + signals.itemCount)) *
        1_000,
    ) / 1_000;
    expect(candidate!.learnScore).toBe(expected);
  });
});
