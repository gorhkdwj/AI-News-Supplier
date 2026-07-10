import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { huggingfaceCollector } from '../../src/collectors/huggingface.js';
import type { FetchContext } from '../../src/collectors/types.js';
import { defaultConfig } from '../../src/core/config.js';
import { logger } from '../../src/core/logger.js';
import { stubHttp } from '../helpers/stubHttp.js';

const models = readFileSync(
  fileURLToPath(new URL('../fixtures/huggingface-models.json', import.meta.url)),
  'utf8',
);
const papers = readFileSync(
  fileURLToPath(new URL('../fixtures/huggingface-papers.json', import.meta.url)),
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

describe('huggingfaceCollector', () => {
  it('model과 paper를 충돌 없는 키와 명시적 score kind로 정규화한다', async () => {
    const http = stubHttp([
      { match: '/api/models', body: models },
      { match: '/api/daily_papers', body: papers },
    ]);
    const { items } = await huggingfaceCollector.fetch(ctx(http));

    expect(items).toHaveLength(2);
    expect(items.find((item) => item.type === 'model')).toMatchObject({
      sourceKey: 'model:example/model-one',
      discussionUrl: null,
      scoreKind: 'likes',
      activityAt: null,
      publishedPrecision: 'exact_time',
    });
    expect(items.find((item) => item.type === 'paper')).toMatchObject({
      sourceKey: 'paper:2607.12345',
      discussionUrl: null,
      scoreKind: 'upvotes',
      activityAt: null,
      publishedPrecision: 'exact_time',
    });
  });
});
