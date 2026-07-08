import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { redditCollector, resetRedditTokenCache } from '../../src/collectors/reddit.js';
import type { FetchContext } from '../../src/collectors/types.js';
import { defaultConfig, type ResolvedConfig } from '../../src/core/config.js';
import { logger } from '../../src/core/logger.js';
import { stubHttp } from '../helpers/stubHttp.js';

const listing = readFileSync(
  fileURLToPath(new URL('../fixtures/reddit-hot.json', import.meta.url)),
  'utf8',
);

function ctx(http: FetchContext['http'], config: ResolvedConfig): FetchContext {
  return { config, http, state: null, log: logger, now: new Date('2026-07-09T12:00:00Z') };
}

function configWithCreds(): ResolvedConfig {
  const c = defaultConfig();
  c.tokens.reddit.clientId = 'id';
  c.tokens.reddit.clientSecret = 'secret';
  return c;
}

describe('redditCollector', () => {
  it('자격증명이 없으면 비활성이다', () => {
    expect(redditCollector.isEnabled(defaultConfig())).toBe(false);
  });

  it('자격증명이 있으면 활성이다', () => {
    expect(redditCollector.isEnabled(configWithCreds())).toBe(true);
  });

  it('토큰 발급 후 hot 게시물을 수집하고 stickied는 제외한다', async () => {
    resetRedditTokenCache();
    const http = stubHttp([
      { match: 'access_token', body: '{"access_token":"tok","expires_in":3600}' },
      { match: 'oauth.reddit.com', body: listing },
    ]);
    const { items } = await redditCollector.fetch(ctx(http, configWithCreds()));

    expect(items).toHaveLength(1); // pinned(stickied) 제외
    expect(items[0]!.title).toContain('open LLM');
    expect(items[0]!.score).toBe(342);
    expect(items[0]!.type).toBe('community');
    expect(items[0]!.tags).toEqual(['r/LocalLLaMA']);
  });
});
