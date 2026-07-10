import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { githubCollector } from '../../src/collectors/github.js';
import type { FetchContext } from '../../src/collectors/types.js';
import { defaultConfig } from '../../src/core/config.js';
import { logger } from '../../src/core/logger.js';
import { stubHttp } from '../helpers/stubHttp.js';

const fixture = readFileSync(
  fileURLToPath(new URL('../fixtures/github-search.json', import.meta.url)),
  'utf8',
);

function ctx(http: FetchContext['http']): FetchContext {
  return {
    config: defaultConfig(),
    http,
    state: null,
    log: logger,
    now: new Date('2026-07-10T00:00:00Z'),
  };
}

describe('githubCollector', () => {
  it('AI 관련 비 fork·비 archived 저장소만 normalized Sighting으로 반환한다', async () => {
    const { items } = await githubCollector.fetch(
      ctx(stubHttp([{ match: '/search/repositories', body: fixture }])),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceKey: '9001',
      discussionUrl: null,
      scoreKind: 'stars',
      activityAt: '2026-07-09T12:00:00Z',
      publishedAt: '2026-07-01T00:00:00Z',
      publishedPrecision: 'exact_time',
    });
  });
});
