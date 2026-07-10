import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allCollectors } from '../../src/collectors/registry.js';
import type { FetchContext } from '../../src/collectors/types.js';
import type { HttpGetOptions } from '../../src/core/http.js';
import { defaultConfig } from '../../src/core/config.js';
import { logger } from '../../src/core/logger.js';
import { stubHttp } from '../helpers/stubHttp.js';

const fixture = readFileSync(
  fileURLToPath(new URL('../fixtures/gemini-cli-releases.json', import.meta.url)),
  'utf8',
);

describe('Gemini CLI release collector', () => {
  it('stable release만 표준 GitHub 요청으로 normalized official Sighting에 담는다', async () => {
    const config = defaultConfig();
    config.tokens.github = 'fixture-token';
    const collector = allCollectors(config).find(
      (candidate) => candidate.name === 'github_release:gemini-cli',
    );
    expect(collector).toBeDefined();
    if (collector === undefined) return;

    const base = stubHttp([{ match: '/google-gemini/gemini-cli/releases', body: fixture }]);
    let request: { url: string; opts?: HttpGetOptions } | null = null;
    const http: FetchContext['http'] = {
      ...base,
      async get(url, opts) {
        request = { url, opts };
        return base.get(url, opts);
      },
    };
    const result = await collector.fetch({
      config,
      http,
      state: null,
      log: logger,
      now: new Date('2026-07-10T00:00:00Z'),
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      source: 'github_release:gemini-cli',
      sourceKey: '7001',
      type: 'official_update',
      url: 'https://github.com/google-gemini/gemini-cli/releases/tag/v1.2.0',
      discussionUrl: null,
      scoreKind: null,
      score: null,
      commentsCount: null,
      activityAt: null,
      publishedPrecision: 'exact_time',
    });
    expect(request).toMatchObject({
      url: 'https://api.github.com/repos/google-gemini/gemini-cli/releases?per_page=100',
      opts: {
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          authorization: 'Bearer fixture-token',
        },
      },
    });
  });

  it.each(['{}', '[{}]'])('비정상 200 응답 %s를 parse CollectorError로 분류한다', async (body) => {
    const config = defaultConfig();
    const collector = allCollectors(config).find(
      (candidate) => candidate.name === 'github_release:gemini-cli',
    );
    expect(collector).toBeDefined();
    if (collector === undefined) return;

    await expect(
      collector.fetch({
        config,
        http: stubHttp([{ match: '/google-gemini/gemini-cli/releases', body }]),
        state: null,
        log: logger,
        now: new Date('2026-07-10T00:00:00Z'),
      }),
    ).rejects.toMatchObject({
      name: 'CollectorError',
      source: 'github_release:gemini-cli',
      kind: 'parse',
    });
  });
});
