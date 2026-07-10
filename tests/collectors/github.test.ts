import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { githubCollector } from '../../src/collectors/github.js';
import type { FetchContext } from '../../src/collectors/types.js';
import { defaultConfig } from '../../src/core/config.js';
import { logger } from '../../src/core/logger.js';
import { stubHttp, type StubRequest } from '../helpers/stubHttp.js';

const fixture = readFileSync(
  fileURLToPath(new URL('../fixtures/github-search.json', import.meta.url)),
  'utf8',
);
const repositoryFixture = readFileSync(
  fileURLToPath(new URL('../fixtures/github-repository.json', import.meta.url)),
  'utf8',
);

function ctx(
  http: FetchContext['http'],
  trackedSightings: FetchContext['trackedSightings'] = [],
): FetchContext {
  return {
    config: defaultConfig(),
    http,
    state: null,
    log: logger,
    now: new Date('2026-07-10T00:00:00Z'),
    trackedSightings,
  };
}

function trackedRepo(index: number) {
  return {
    sourceKey: String(9010 + index),
    sourceUrl: `https://github.com/tracked/repo-${index}`,
    firstSeenAt: '2026-07-01T00:00:00.000Z',
    lastSeenAt: '2026-07-09T00:00:00.000Z',
  };
}

describe('githubCollector', () => {
  it('AI 관련 비 fork·비 archived 저장소만 normalized Sighting으로 반환한다', async () => {
    const requests: StubRequest[] = [];
    const { items } = await githubCollector.fetch(
      ctx(stubHttp([{ match: '/search/repositories', body: fixture }], requests)),
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

    const searchRequests = requests.filter((request) =>
      request.url.includes('/search/repositories'),
    );
    expect(searchRequests).toHaveLength(2);
    expect(
      searchRequests.every(
        (request) => new URL(request.url).searchParams.get('per_page') === '100',
      ),
    ).toBe(true);
    const queries = searchRequests.map(
      (request) => new URL(request.url).searchParams.get('q') ?? '',
    );
    const discoveryQuery = queries.find((query) => query.includes('created:')) ?? '';
    const activeQuery = queries.find((query) => query.includes('pushed:')) ?? '';
    expect(discoveryQuery).toContain('(ai OR llm OR gpt OR rag OR agentic)');
    expect(discoveryQuery).toContain('in:name,description,topics');
    expect(discoveryQuery).toContain('created:>=2026-06-26');
    expect(discoveryQuery).not.toContain('topic:llm topic:ai');
    expect(discoveryQuery).not.toContain('stars:');
    expect(activeQuery).toContain('pushed:>=2026-06-26');
    expect(activeQuery).toContain('stars:>=100');
  });

  it('검색에서 누락된 추적 저장소를 최대 50개까지 공식 Repository API로 재확인한다', async () => {
    const requests: StubRequest[] = [];
    const result = await githubCollector.fetch(
      ctx(
        stubHttp(
          [
            { match: '/search/repositories', body: fixture },
            { match: '/repos/', body: repositoryFixture },
          ],
          requests,
        ),
        Array.from({ length: 51 }, (_, index) => trackedRepo(index)),
      ),
    );

    const repositoryRequests = requests.filter((request) => request.url.includes('/repos/'));
    expect(repositoryRequests).toHaveLength(50);
    expect(result.items).toContainEqual(
      expect.objectContaining({ sourceKey: '9010', title: 'tracked/ai-agent' }),
    );
  });

  it('50개 초과 추적 저장소는 다음 주기에 미관측 항목을 순환 재확인한다', async () => {
    const firstRequests: StubRequest[] = [];
    const tracked = Array.from({ length: 51 }, (_, index) => trackedRepo(index));
    await githubCollector.fetch(
      ctx(
        stubHttp(
          [
            { match: '/search/repositories', body: fixture },
            { match: '/repos/', body: repositoryFixture },
          ],
          firstRequests,
        ),
        tracked,
      ),
    );
    const firstRepositoryUrls = firstRequests
      .filter((request) => request.url.includes('/repos/'))
      .map((request) => request.url);
    expect(firstRepositoryUrls).toHaveLength(50);
    expect(firstRepositoryUrls.some((url) => url.endsWith('/tracked/repo-50'))).toBe(false);

    const secondRequests: StubRequest[] = [];
    const nextTracked = tracked.map((reference, index) => ({
      ...reference,
      lastSeenAt: firstRepositoryUrls.some((url) => url.endsWith(`/tracked/repo-${index}`))
        ? '2026-07-10T00:00:00.000Z'
        : reference.lastSeenAt,
    }));
    await githubCollector.fetch(
      ctx(
        stubHttp(
          [
            { match: '/search/repositories', body: fixture },
            { match: '/repos/', body: repositoryFixture },
          ],
          secondRequests,
        ),
        nextTracked,
      ),
    );

    const secondRepositoryUrls = secondRequests
      .filter((request) => request.url.includes('/repos/'))
      .map((request) => request.url);
    expect(secondRepositoryUrls).toHaveLength(50);
    expect(secondRepositoryUrls.some((url) => url.endsWith('/tracked/repo-50'))).toBe(true);
    expect(secondRepositoryUrls.some((url) => url.endsWith('/tracked/repo-49'))).toBe(false);
  });

  it('canonical URL source key를 쓰는 legacy 추적 행도 재확인해 숫자 repository ID로 반환한다', async () => {
    const requests: StubRequest[] = [];
    const legacyReference = {
      ...trackedRepo(0),
      sourceKey: 'https://github.com/tracked/ai-agent',
      sourceUrl: 'https://github.com/tracked/ai-agent',
    };
    const result = await githubCollector.fetch(
      ctx(
        stubHttp(
          [
            { match: '/search/repositories', body: fixture },
            { match: '/repos/', body: repositoryFixture },
          ],
          requests,
        ),
        [legacyReference],
      ),
    );

    expect(requests.filter((request) => request.url.includes('/repos/'))).toHaveLength(1);
    expect(result.items).toContainEqual(expect.objectContaining({ sourceKey: '9010' }));
  });

  it.each([
    ['fork', { fork: true }],
    ['archived', { archived: true }],
    [
      'non-AI',
      {
        full_name: 'tracked/database-tools',
        html_url: 'https://github.com/tracked/database-tools',
        description: 'Database maintenance utilities',
        topics: ['database'],
      },
    ],
  ])('재확인한 추적 저장소가 %s 상태면 삭제 key를 반환한다', async (_reason, changes) => {
    const ineligibleRepository = JSON.stringify({
      ...(JSON.parse(repositoryFixture) as object),
      id: 9010,
      ...changes,
    });
    const result = await githubCollector.fetch(
      ctx(
        stubHttp([
          { match: '/search/repositories', body: fixture },
          { match: '/repos/', body: ineligibleRepository },
        ]),
        [trackedRepo(0)],
      ),
    );

    expect(result.items).not.toContainEqual(expect.objectContaining({ sourceKey: '9010' }));
    expect(result.deletedSourceKeys).toEqual(['9010']);
  });

  it('추적 저장소 재확인의 rate-limit 응답을 collector 실패로 보존한다', async () => {
    await expect(
      githubCollector.fetch(
        ctx(
          stubHttp([
            { match: '/search/repositories', body: fixture },
            { match: '/repos/', status: 429 },
          ]),
          [trackedRepo(0)],
        ),
      ),
    ).rejects.toMatchObject({ source: 'github', status: 429 });
  });

  it('구조가 잘못된 Repository 200 응답은 tracked key 삭제 근거로 사용하지 않는다', async () => {
    const result = await githubCollector.fetch(
      ctx(
        stubHttp([
          { match: '/search/repositories', body: fixture },
          { match: '/repos/', body: '{}' },
        ]),
        [trackedRepo(0)],
      ),
    );

    expect(result.deletedSourceKeys).toEqual([]);
  });

  it('구조가 잘못된 search item은 source 실패로 처리한다', async () => {
    await expect(
      githubCollector.fetch(
        ctx(stubHttp([{ match: '/search/repositories', body: '{"items":[{}]}' }])),
      ),
    ).rejects.toMatchObject({ source: 'github', kind: 'parse' });
  });
});
