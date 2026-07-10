import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { arxivCollector } from '../../src/collectors/arxiv.js';
import type { FetchContext } from '../../src/collectors/types.js';
import { defaultConfig } from '../../src/core/config.js';
import { logger } from '../../src/core/logger.js';
import { stubHttp } from '../helpers/stubHttp.js';

const xml = readFileSync(
  fileURLToPath(new URL('../fixtures/arxiv.atom.xml', import.meta.url)),
  'utf8',
);

function ctx(http: FetchContext['http']): FetchContext {
  return {
    config: defaultConfig(),
    http,
    state: null,
    log: logger,
    now: new Date('2026-07-09T12:00:00Z'),
  };
}

describe('arxivCollector', () => {
  it('Atom을 파싱하고 버전 접미사를 제거해 canonical URL을 만든다', async () => {
    const http = stubHttp([{ match: 'export.arxiv.org', body: xml }]);
    const { items } = await arxivCollector.fetch(ctx(http));
    expect(items).toHaveLength(2);

    const moe = items[0]!;
    expect(moe.url).toBe('https://arxiv.org/abs/2607.06565'); // v2 제거 + https
    expect(moe.title).toBe('Scaling Laws for Mixture-of-Experts'); // 개행/중복 공백 정규화
    expect(moe.type).toBe('paper');
    expect(moe.score).toBeNull();
    expect(moe.tags).toEqual(['cs.LG', 'cs.AI']);
    expect(moe.author).toBe('Jane Doe'); // 첫 저자
    expect(moe.publishedAt).toBe('2026-07-07T17:59:50Z');
    expect(moe).toMatchObject({
      sourceKey: '2607.06565',
      discussionUrl: null,
      scoreKind: null,
      activityAt: null,
      publishedPrecision: 'exact_time',
    });
  });

  it('단일 저자/카테고리 항목도 배열로 정규화한다', async () => {
    const http = stubHttp([{ match: 'export.arxiv.org', body: xml }]);
    const { items } = await arxivCollector.fetch(ctx(http));
    const single = items[1]!;
    expect(single.tags).toEqual(['cs.CL']);
    expect(single.author).toBe('Solo Author');
    expect(single.url).toBe('https://arxiv.org/abs/2607.06600');
  });
});
