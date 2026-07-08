import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hackernewsCollector } from '../../src/collectors/hackernews.js';
import type { FetchContext } from '../../src/collectors/types.js';
import { CollectorError } from '../../src/collectors/types.js';
import { defaultConfig } from '../../src/core/config.js';
import { logger } from '../../src/core/logger.js';
import { stubHttp } from '../helpers/stubHttp.js';

const hnFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/hn-search.json', import.meta.url)),
  'utf8',
);

function ctx(http: FetchContext['http']): FetchContext {
  return { config: defaultConfig(), http, state: null, log: logger, now: new Date('2026-07-09T12:00:00Z') };
}

describe('hackernewsCollector', () => {
  it('AI 관련 항목만 정규화하고, 비관련(요리)은 제외한다', async () => {
    const http = stubHttp([{ match: 'hn.algolia.com', body: hnFixture }]);
    const { items } = await hackernewsCollector.fetch(ctx(http));

    // 관련 항목 2개(GPT-5, Ask HN LLM), 요리 1개 제외
    expect(items).toHaveLength(2);
    const gpt = items.find((i) => i.title.includes('GPT-5'));
    expect(gpt).toBeDefined();
    expect(gpt!.source).toBe('hackernews');
    expect(gpt!.type).toBe('community');
    expect(gpt!.score).toBe(500);
    expect(gpt!.commentsCount).toBe(210);
    expect(gpt!.publishedAt).toBe('2026-07-09T00:00:00.000Z');
  });

  it('URL이 없는 Ask HN 항목은 HN 아이템 링크로 대체한다', async () => {
    const http = stubHttp([{ match: 'hn.algolia.com', body: hnFixture }]);
    const { items } = await hackernewsCollector.fetch(ctx(http));
    const ask = items.find((i) => i.title.startsWith('Ask HN'));
    expect(ask!.url).toBe('https://news.ycombinator.com/item?id=102');
  });

  it('HTTP 오류는 CollectorError로 던진다', async () => {
    const http = stubHttp([{ match: 'hn.algolia.com', status: 503 }]);
    await expect(hackernewsCollector.fetch(ctx(http))).rejects.toBeInstanceOf(CollectorError);
  });
});
