import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { openDb } from '../../src/core/db/connection.js';
import { upsertItems } from '../../src/core/store/itemStore.js';

const serverSrc = fileURLToPath(new URL('../../src/mcp/server.ts', import.meta.url));

let home: string;
let client: Client;
let transport: StdioClientTransport;

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
    await client.callTool({ name: 'record_learning', arguments: { topic: 'mcp', level: 'beginner' } });
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

  it('프롬프트 3종(trend-briefing, learn-today, deep-dive)을 노출한다', async () => {
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name);
    expect(names).toContain('trend-briefing');
    expect(names).toContain('learn-today');
    expect(names).toContain('deep-dive');
  });
});
