import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { devtoCollector } from '../../src/collectors/devto.js';
import type { FetchContext } from '../../src/collectors/types.js';
import { defaultConfig } from '../../src/core/config.js';
import { logger } from '../../src/core/logger.js';
import { stubHttp } from '../helpers/stubHttp.js';

const fixture = readFileSync(
  fileURLToPath(new URL('../fixtures/devto-articles.json', import.meta.url)),
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

describe('devtoCollector', () => {
  it('article ID와 reactions를 live Sighting 필드로 정규화한다', async () => {
    const { items } = await devtoCollector.fetch(
      ctx(stubHttp([{ match: 'dev.to/api/articles', body: fixture }])),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceKey: '12345',
      discussionUrl: null,
      scoreKind: 'reactions',
      activityAt: null,
      publishedPrecision: 'exact_time',
    });
  });
});
