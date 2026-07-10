import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { openDb } from '../../src/core/db/connection.js';
import { upsertItems } from '../../src/core/store/itemStore.js';
import { upsertSightings } from '../../src/core/store/sightingStore.js';
import { itemId } from '../../src/core/normalize.js';

const serverSrc = fileURLToPath(new URL('../../src/mcp/server.ts', import.meta.url));
const cliSrc = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));

let home: string;
let client: Client;
let transport: StdioClientTransport;
let detailId: string;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'ains-mcp-'));
  // 모든 소스를 비활성화해 refreshStale이 네트워크를 타지 않게 한다(시드 데이터만 사용).
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({
      sources: {
        hackernews: { enabled: false },
        github: { enabled: false },
        huggingface: { enabled: false },
        arxiv: { enabled: false },
        devto: { enabled: false },
        reddit: { enabled: false },
        rss: { enabled: false },
      },
    }),
  );

  process.env.AINS_HOME = home;
  const db = openDb(join(home, 'data.db'));
  upsertItems(db, [
    {
      source: 'hackernews',
      type: 'community',
      title: 'Seeded AI trend for MCP smoke test',
      url: 'https://example.com/seed',
      summary: 'seed',
      author: 'tester',
      score: 100,
      commentsCount: 5,
      tags: ['ai'],
      publishedAt: new Date().toISOString(),
      raw: {},
    },
  ]);
  const now = new Date();
  const v2Community = {
    source: 'reddit',
    sourceKey: 'mcp-v2-community',
    type: 'community' as const,
    title: 'V2 community item for interface parity',
    url: 'https://example.com/mcp-v2-community',
    discussionUrl: 'https://reddit.com/r/test/comments/mcp-v2',
    summary: 'v2',
    author: 'tester',
    score: 10,
    scoreKind: 'upvotes',
    commentsCount: 2,
    tags: ['ai'],
    publishedAt: new Date(now.getTime() - 3_600_000).toISOString(),
    publishedPrecision: 'exact_time' as const,
    activityAt: null,
    raw: null,
  };
  upsertSightings(db, [v2Community], new Date(now.getTime() - 3_600_000).toISOString());
  upsertSightings(db, [{ ...v2Community, score: 20, commentsCount: 4 }], now.toISOString());
  upsertSightings(
    db,
    [
      {
        ...v2Community,
        source: 'rss:vendor',
        sourceKey: 'mcp-official',
        type: 'official_update',
        title: 'Official API release',
        url: 'https://example.com/mcp-official',
        discussionUrl: null,
        score: null,
        scoreKind: null,
        commentsCount: null,
      },
    ],
    now.toISOString(),
  );
  detailId = itemId(v2Community.url);
  db.close();

  transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', serverSrc],
    env: { ...process.env, AINS_HOME: home } as Record<string, string>,
  });
  client = new Client({ name: 'smoke-test', version: '1.0.0' });
  await client.connect(transport);
}, 60_000);

afterAll(async () => {
  await client?.close();
  delete process.env.AINS_HOME;
  if (home) rmSync(home, { recursive: true, force: true });
});

describe('MCP stdio 스모크', () => {
  it('데이터 5종 + 학습 4종 도구를 노출한다', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'get_item',
        'get_source_status',
        'get_trends',
        'refresh_sources',
        'search_news',
        'get_learning_candidates',
        'design_learning_session',
        'record_learning',
        'get_learning_history',
      ].sort(),
    );
  });

  it('record_learning 후 get_learning_history에 반영된다', async () => {
    await client.callTool({
      name: 'record_learning',
      arguments: { topic: 'mcp', level: 'beginner' },
    });
    const res = await client.callTool({ name: 'get_learning_history', arguments: {} });
    const structured = res.structuredContent as { entries: { topic: string }[] };
    expect(structured.entries.some((e) => e.topic === 'mcp')).toBe(true);
  });

  it('get_trends가 시드 항목을 structuredContent로 반환한다', async () => {
    const res = await client.callTool({ name: 'get_trends', arguments: { limit: 5 } });
    const structured = res.structuredContent as { items: { title: string }[] };
    expect(structured.items.length).toBeGreaterThanOrEqual(1);
    expect(structured.items.some((i) => i.title.includes('Seeded AI trend'))).toBe(true);
  });

  it('get_trends v2가 sections와 동일한 flattened items 및 null latest hotness를 반환한다', async () => {
    const res = await client.callTool({
      name: 'get_trends',
      arguments: {
        ranking_version: 'v2',
        channel: 'community',
        sort: 'latest',
        limit: 10,
      },
    });
    const structured = res.structuredContent as {
      sections: Array<{ channel: string; items: Array<{ id: string; hotness: number | null }> }>;
      items: Array<{ id: string; hotness: number | null }>;
    };
    expect(structured.sections).toHaveLength(1);
    expect(structured.sections[0]!.channel).toBe('community');
    expect(structured.items.map((item) => item.id)).toEqual(
      structured.sections.flatMap((section) => section.items.map((item) => item.id)),
    );
    expect(structured.items.find((item) => item.id === detailId)?.hotness).toBeNull();
  });

  it('get_trends가 잘못된 channel/sort 조합을 protocol input error로 거부한다', async () => {
    const result = await client.callTool({
      name: 'get_trends',
      arguments: { ranking_version: 'v2', channel: 'official', sort: 'hot' },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringMatching(/-32602.*incompatible/i),
      }),
    ]);
  });

  it('get_item이 primary-first sightings와 오름차순 metric_history를 추가한다', async () => {
    const res = await client.callTool({ name: 'get_item', arguments: { id: detailId } });
    const structured = res.structuredContent as {
      found: boolean;
      sightings: Array<{
        source: string;
        is_primary: boolean;
        metric_history: Array<{ score: number | null; observed_at: string }>;
      }>;
    };
    expect(structured.found).toBe(true);
    expect(structured.sightings[0]!.is_primary).toBe(true);
    expect(structured.sightings[0]!.metric_history.map((snapshot) => snapshot.score)).toEqual([
      10, 20,
    ]);
  });

  it('동일한 v2 요청에서 CLI와 MCP의 Story ID/순서가 일치한다', async () => {
    const mcpResult = await client.callTool({
      name: 'get_trends',
      arguments: {
        ranking_version: 'v2',
        channel: 'community',
        sort: 'latest',
        limit: 10,
      },
    });
    const mcpItems = (mcpResult.structuredContent as { items: Array<{ id: string }> }).items;
    const cli = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        cliSrc,
        'trends',
        '--ranking',
        'v2',
        '--channel',
        'community',
        '--sort',
        'latest',
        '--limit',
        '10',
        '--no-refresh',
        '--json',
      ],
      { encoding: 'utf8', env: { ...process.env, AINS_HOME: home }, timeout: 30_000 },
    );
    expect(cli.status).toBe(0);
    const cliItems = JSON.parse(cli.stdout) as Array<{ id: string }>;
    expect(cliItems.map((item) => item.id)).toEqual(mcpItems.map((item) => item.id));
  });

  it('프롬프트 3종(trend-briefing, learn-today, deep-dive)을 노출한다', async () => {
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name);
    expect(names).toContain('trend-briefing');
    expect(names).toContain('learn-today');
    expect(names).toContain('deep-dive');
  });
});
