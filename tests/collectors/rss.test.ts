import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defaultConfig, type ResolvedConfig } from '../../src/core/config.js';
import { makeRssCollectors } from '../../src/collectors/rss.js';
import type { FetchContext } from '../../src/collectors/types.js';
import { logger } from '../../src/core/logger.js';
import { stubHttp } from '../helpers/stubHttp.js';

const claudeAtom = readFileSync(
  fileURLToPath(new URL('../fixtures/claude-code.atom.xml', import.meta.url)),
  'utf8',
);
const cursorRss = readFileSync(
  fileURLToPath(new URL('../fixtures/cursor-changelog.rss.xml', import.meta.url)),
  'utf8',
);
const figmaAtom = readFileSync(
  fileURLToPath(new URL('../fixtures/figma-releases.atom.xml', import.meta.url)),
  'utf8',
);

function ctx(config: ResolvedConfig, http: FetchContext['http']): FetchContext {
  return {
    config,
    http,
    state: null,
    log: logger,
    now: new Date('2026-07-10T00:00:00Z'),
  };
}

describe('RSS collectors', () => {
  it('안전한 공식 기본 feed를 추가하고 사용자 목록은 기본값을 대체한다', () => {
    const defaults = defaultConfig();
    expect(makeRssCollectors(defaults).map((collector) => collector.name)).toEqual(
      expect.arrayContaining(['rss:claude-code', 'rss:cursor', 'rss:figma']),
    );

    const custom = defaultConfig();
    custom.sources.rss.feeds = [
      { id: 'custom', title: 'Custom Feed', url: 'https://example.com/custom.xml' },
    ];
    expect(makeRssCollectors(custom).map((collector) => collector.name)).toEqual(['rss:custom']);
  });

  it('Claude Atom과 Cursor RSS를 stable key의 normalized Sighting으로 반환한다', async () => {
    const config = defaultConfig();
    const collectors = makeRssCollectors(config);
    const claude = collectors.find((collector) => collector.name === 'rss:claude-code')!;
    const cursor = collectors.find((collector) => collector.name === 'rss:cursor')!;
    const http = stubHttp([
      { match: 'claude-code/main/feed.xml', body: claudeAtom },
      { match: 'cursor.com/changelog/rss.xml', body: cursorRss },
    ]);

    const claudeItems = (await claude.fetch(ctx(config, http))).items;
    const cursorItems = (await cursor.fetch(ctx(config, http))).items;
    expect(claudeItems).toHaveLength(1);
    expect(claudeItems[0]).toMatchObject({
      sourceKey: 'https://github.com/anthropics/claude-code/releases/tag/v2.0.0',
      discussionUrl: null,
      scoreKind: null,
      activityAt: null,
      publishedPrecision: 'exact_time',
    });
    expect(cursorItems).toHaveLength(1);
    expect(cursorItems[0]).toMatchObject({
      sourceKey: 'cursor-background-agents',
      discussionUrl: null,
      scoreKind: null,
      activityAt: null,
      publishedPrecision: 'exact_time',
    });
  });

  it('Figma는 독립 AI 토큰과 retention을 적용하고 day precision을 보존한다', async () => {
    const config = defaultConfig();
    const figma = makeRssCollectors(config).find((collector) => collector.name === 'rss:figma')!;
    const http = stubHttp([{ match: 'figma.com/release-notes/feed/atom.xml', body: figmaAtom }]);

    const recent = (await figma.fetch(ctx(config, http))).items;
    expect(recent.map((item) => item.sourceKey)).toEqual([
      'urn:uuid:figma-positive',
      'urn:uuid:figma-tag-match',
    ]);
    expect(recent.every((item) => item.publishedPrecision === 'date_only')).toBe(true);

    config.retentionDays = null;
    const withoutAgeLimit = (await figma.fetch(ctx(config, http))).items;
    expect(withoutAgeLimit.map((item) => item.sourceKey)).toEqual([
      'urn:uuid:figma-positive',
      'urn:uuid:figma-old-ai',
      'urn:uuid:figma-tag-match',
    ]);
    expect(withoutAgeLimit.some((item) => item.sourceKey === 'urn:uuid:figma-false-positive')).toBe(
      false,
    );
  });

  it('GUID가 없으면 추적 파라미터를 제거한 canonical link를 source key로 사용한다', async () => {
    const config = defaultConfig();
    config.sources.rss.feeds = [
      { id: 'fallback', title: 'Fallback Feed', url: 'https://example.com/fallback.xml' },
    ];
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <title>Fallback</title><link>https://example.com</link><description>Updates</description>
      <item><title>AI update</title>
      <link>https://example.com/releases/ai?utm_source=feed&amp;version=1</link>
      <pubDate>Thu, 09 Jul 2026 12:00:00 GMT</pubDate></item>
      </channel></rss>`;
    const collector = makeRssCollectors(config)[0]!;
    const result = await collector.fetch(
      ctx(config, stubHttp([{ match: 'example.com/fallback.xml', body: xml }])),
    );

    expect(result.items[0]?.sourceKey).toBe('https://example.com/releases/ai?version=1');
  });

  it('공백 GUID는 canonical link로 대체하고 custom feed의 날짜 전용 시각을 구분한다', async () => {
    const config = defaultConfig();
    config.sources.rss.feeds = [
      { id: 'date-only', title: 'Date-only Feed', url: 'https://example.com/date-only.xml' },
    ];
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <title>Date only</title><link>https://example.com</link><description>Updates</description>
      <item><title>AI release</title><guid>   </guid>
      <link>https://example.com/releases/ai?utm_source=feed&amp;version=2</link>
      <pubDate>2026-07-09</pubDate></item>
      <item><title>AI follow-up</title><guid></guid>
      <link>https://example.com/releases/ai?utm_source=feed&amp;version=3</link>
      <pubDate>2026-07-10</pubDate></item>
      </channel></rss>`;
    const collector = makeRssCollectors(config)[0]!;
    const result = await collector.fetch(
      ctx(config, stubHttp([{ match: 'example.com/date-only.xml', body: xml }])),
    );

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.sourceKey)).toEqual([
      'https://example.com/releases/ai?version=2',
      'https://example.com/releases/ai?version=3',
    ]);
    expect(result.items[0]).toMatchObject({
      publishedAt: '2026-07-09T00:00:00.000Z',
      publishedPrecision: 'date_only',
    });
    expect(result.items[1]).toMatchObject({
      publishedAt: '2026-07-10T00:00:00.000Z',
      publishedPrecision: 'date_only',
    });
  });
});
