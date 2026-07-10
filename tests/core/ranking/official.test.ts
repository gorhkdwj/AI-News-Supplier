import { describe, expect, it } from 'vitest';

import {
  classifyOfficialImpact,
  rankOfficialImportant,
  rankOfficialLatest,
  type OfficialCandidate,
} from '../../../src/core/ranking/index.js';

const NOW = new Date('2026-07-10T00:00:00.000Z');

function official(overrides: Partial<OfficialCandidate> & { storyId: string }): OfficialCandidate {
  return {
    storyId: overrides.storyId,
    source: overrides.source ?? 'rss:openai',
    type: 'official_update',
    title: overrides.title ?? 'General product update',
    summary: 'Summary',
    publishedAt: overrides.publishedAt ?? NOW.toISOString(),
  };
}

describe('official updates', () => {
  it('classifies phrases with critical, low, high, normal precedence', () => {
    expect(classifyOfficialImpact('Security vulnerability in the API', null).level).toBe(
      'critical',
    );
    expect(classifyOfficialImpact('Customer story: a new model launch', null).level).toBe('low');
    expect(classifyOfficialImpact('SDK launch is generally available', null).level).toBe('high');
    expect(classifyOfficialImpact('API design notes', null).level).toBe('normal');
  });

  it('keeps marketing text low even when it names a model or API launch', () => {
    const ranked = rankOfficialImportant(
      [
        official({ storyId: 'marketing', title: 'Customer story: Acme adopts our model launch' }),
        official({ storyId: 'release', title: 'Model launch is generally available' }),
      ],
      { now: NOW },
    );
    const marketing = ranked.find((item) => item.storyId === 'marketing')!;
    expect(marketing.ranking.signals.impactLevel).toBe('low');
    expect(ranked[0]!.storyId).toBe('release');
  });

  it('makes Latest scoreless time order while Important uses impact order', () => {
    const candidates = [
      official({
        storyId: 'new-normal',
        title: 'Weekly notes',
        publishedAt: '2026-07-10T00:00:00.000Z',
      }),
      official({
        storyId: 'older-critical',
        title: 'Critical security vulnerability',
        publishedAt: '2026-07-09T23:00:00.000Z',
      }),
    ];
    const latest = rankOfficialLatest(candidates, { now: NOW });
    const important = rankOfficialImportant(candidates, { now: NOW });

    expect(latest.map((item) => item.storyId)).toEqual(['new-normal', 'older-critical']);
    expect(latest.every((item) => item.ranking.score === null)).toBe(true);
    expect(important[0]!.storyId).toBe('older-critical');
  });

  it('is monotonic for community echo and recency and clamps future age to zero', () => {
    const echoRanked = rankOfficialImportant(
      [official({ storyId: 'no-echo' }), official({ storyId: 'echo' })],
      { now: NOW, communityScores: { echo: [0.2, 0.8], 'no-echo': [] } },
    );
    expect(echoRanked[0]!.storyId).toBe('echo');
    expect(echoRanked[0]!.ranking.signals.communityEcho).toBe(0.8);

    const clampedEcho = rankOfficialImportant([official({ storyId: 'clamped' })], {
      now: NOW,
      communityScores: { clamped: [2] },
    });
    expect(clampedEcho[0]!.ranking.signals.communityEcho).toBe(1);

    const ageRanked = rankOfficialImportant(
      [
        official({ storyId: 'old', publishedAt: '2026-06-26T00:00:00.000Z' }),
        official({ storyId: 'future', publishedAt: '2026-07-11T00:00:00.000Z' }),
      ],
      { now: NOW },
    );
    expect(ageRanked[0]!.storyId).toBe('future');
    expect(ageRanked[0]!.ranking.signals.ageDays).toBe(0);
  });

  it('applies source diversity only to Important', () => {
    const candidates = [
      ...Array.from({ length: 5 }, (_, index) =>
        official({
          storyId: `a-${index}`,
          source: 'rss:a',
          title: `Security vulnerability ${index}`,
        }),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        official({ storyId: `b-${index}`, source: 'rss:b', title: `Pricing update ${index}` }),
      ),
      official({ storyId: 'c-0', source: 'rss:c', title: 'Weekly notes' }),
    ];
    const important = rankOfficialImportant(candidates, { now: NOW, limit: 5 });
    const latest = rankOfficialLatest(candidates, { now: NOW, limit: 5 });
    const counts = new Map<string, number>();
    for (const item of important) counts.set(item.source, (counts.get(item.source) ?? 0) + 1);

    expect([...counts.values()].sort()).toEqual([1, 2, 2]);
    expect(latest.map((item) => item.source)).toEqual([
      'rss:a',
      'rss:a',
      'rss:a',
      'rss:a',
      'rss:a',
    ]);
  });
});
