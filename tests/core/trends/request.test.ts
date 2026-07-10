import { describe, expect, it } from 'vitest';

import { TrendInputError, resolveTrendRequest } from '../../../src/core/trends/request.js';

describe('resolveTrendRequest', () => {
  it('keeps the 0.1.0 no-option default on legacy overview/briefing', () => {
    expect(resolveTrendRequest({})).toEqual({
      rankingVersion: 'legacy',
      channel: 'overview',
      sort: 'briefing',
      sources: undefined,
      types: undefined,
      sinceHours: undefined,
      limit: 20,
    });
  });

  it.each([
    ['overview', 'briefing'],
    ['community', 'hot'],
    ['community', 'latest'],
    ['official', 'latest'],
    ['official', 'important'],
    ['repos', 'trending'],
    ['repos', 'discovery'],
    ['research', 'hot'],
    ['research', 'latest'],
  ] as const)('accepts v2 %s/%s', (channel, sort) => {
    const resolved = resolveTrendRequest({ channel, sort });
    expect(resolved).toMatchObject({ rankingVersion: 'v2', channel, sort });
  });

  it.each([
    ['overview', 'briefing'],
    ['community', 'hot'],
    ['official', 'latest'],
    ['repos', 'trending'],
    ['research', 'hot'],
  ] as const)('uses the %s default sort %s', (channel, sort) => {
    expect(resolveTrendRequest({ channel })).toMatchObject({
      rankingVersion: 'v2',
      channel,
      sort,
    });
  });

  it('uses v2 overview/briefing for explicit v2 and for briefing alone', () => {
    expect(resolveTrendRequest({ rankingVersion: 'v2' })).toMatchObject({
      rankingVersion: 'v2',
      channel: 'overview',
      sort: 'briefing',
    });
    expect(resolveTrendRequest({ sort: 'briefing' })).toMatchObject({
      rankingVersion: 'v2',
      channel: 'overview',
      sort: 'briefing',
    });
  });

  it.each([
    { rankingVersion: 'future' },
    { channel: 'all' },
    { sort: 'score' },
    { channel: 'official', sort: 'hot' },
    { sort: 'important' },
    { rankingVersion: 'legacy', channel: 'community' },
    { rankingVersion: 'legacy', sort: 'hot' },
  ])('rejects invalid enums or channel/sort combinations: %j', (input) => {
    expect(() => resolveTrendRequest(input)).toThrow(TrendInputError);
  });

  it.each([
    [{ channel: 'community', types: ['paper'] }, 'community'],
    [{ channel: 'official', types: ['official_update', 'community'] }, 'official'],
    [{ channel: 'repos', types: ['hot_repo', 'model'] }, 'repos'],
    [{ channel: 'research', types: ['community'] }, 'research'],
    [{ channel: 'community', types: ['article'], sources: ['hackernews'] }, 'devto'],
    [{ channel: 'research', types: ['article'], sources: ['devto'] }, 'devto'],
  ])('rejects a known incompatible type request: %j', (input, message) => {
    expect(() => resolveTrendRequest(input)).toThrow(message);
  });

  it('rejects invalid numeric filters instead of silently replacing them', () => {
    expect(() => resolveTrendRequest({ limit: 0 })).toThrow('limit');
    expect(() => resolveTrendRequest({ sinceHours: Number.NaN })).toThrow('sinceHours');
  });
});
