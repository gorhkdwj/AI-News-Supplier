import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DB } from '../core/db/connection.js';
import type { ResolvedConfig } from '../core/config.js';
import { refreshStale } from '../core/refresh.js';
import {
  queryRecent,
  searchItems,
  getItemById,
  countItemsBySource,
  getScoreHistory,
} from '../core/store/itemStore.js';
import { getSourceState } from '../core/store/fetchLog.js';
import { computeHotness, interleaveBySource } from '../core/rank.js';
import { allCollectors } from '../collectors/registry.js';
import { ITEM_TYPES, type ItemType, type NewsItem, type RankedItem } from '../core/types.js';

export interface McpDeps {
  db: DB;
  config: ResolvedConfig;
}

const typeEnum = z.enum([...ITEM_TYPES] as [ItemType, ...ItemType[]]);

function jsonResult(data: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function toTrendItem(it: RankedItem) {
  return {
    id: it.id,
    source: it.source,
    type: it.type,
    title: it.title,
    url: it.url,
    summary: it.summary,
    score: it.score,
    hotness: it.hotness,
    published_at: it.publishedAt,
    tags: it.tags,
  };
}

function toItemBrief(it: NewsItem) {
  return {
    id: it.id,
    source: it.source,
    type: it.type,
    title: it.title,
    url: it.url,
    summary: it.summary,
    score: it.score,
    published_at: it.publishedAt,
    tags: it.tags,
  };
}

/** 데이터 조회/수집 MCP 도구 5종을 등록한다. */
export function registerTools(server: McpServer, deps: McpDeps): void {
  const { db, config } = deps;

  server.registerTool(
    'get_trends',
    {
      description:
        '최신 AI 트렌드를 hotness(화제성) 순으로 반환합니다. 소스/유형/기간으로 필터할 수 있습니다.',
      inputSchema: {
        limit: z.number().int().positive().max(100).optional(),
        sources: z.array(z.string()).optional(),
        types: z.array(typeEnum).optional(),
        since_hours: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      await refreshStale(db, config, { sources: args.sources });
      const items = queryRecent(db, {
        sinceHours: args.since_hours ?? 72,
        sources: args.sources,
        types: args.types,
        limit: 500,
      });
      const ranked = computeHotness(items, new Date());
      const top = interleaveBySource(ranked, args.limit ?? 20, config.maxPerSourceRatio);
      return jsonResult({ items: top.map(toTrendItem) });
    },
  );

  server.registerTool(
    'search_news',
    {
      description: '축적된 AI 소식을 전문 검색(FTS)합니다.',
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().positive().max(100).optional(),
        since_days: z.number().int().positive().optional(),
        types: z.array(typeEnum).optional(),
      },
    },
    async (args) => {
      await refreshStale(db, config);
      const items = searchItems(db, args.query, {
        sinceDays: args.since_days ?? 30,
        types: args.types,
        limit: args.limit ?? 20,
      });
      return jsonResult({ items: items.map(toItemBrief), total: items.length });
    },
  );

  server.registerTool(
    'get_item',
    {
      description: '항목 id로 상세(원본 raw, 점수 이력 포함)를 조회합니다.',
      inputSchema: { id: z.string().min(1) },
    },
    (args) => {
      const item = getItemById(db, args.id);
      if (!item) return jsonResult({ found: false });
      return jsonResult({ found: true, item, score_history: getScoreHistory(db, args.id) });
    },
  );

  server.registerTool(
    'refresh_sources',
    {
      description: '소스에서 최신 항목을 수집합니다. force로 TTL을 무시할 수 있습니다.',
      inputSchema: {
        sources: z.array(z.string()).optional(),
        force: z.boolean().optional(),
      },
    },
    async (args) => {
      const summary = await refreshStale(db, config, {
        sources: args.sources,
        force: args.force ?? false,
      });
      return jsonResult({ results: summary.results });
    },
  );

  server.registerTool(
    'get_source_status',
    {
      description: '각 소스의 활성 여부, TTL, 마지막 성공, 연속 실패, 항목 수를 반환합니다.',
      inputSchema: {},
    },
    () => {
      const bySource = countItemsBySource(db);
      const sources = allCollectors(config).map((c) => {
        const state = getSourceState(db, c.name);
        return {
          name: c.name,
          enabled: c.isEnabled(config),
          ttl_minutes: c.defaultTtlMinutes,
          last_success_at: state?.lastSuccessAt ?? null,
          consecutive_failures: state?.consecutiveFailures ?? 0,
          item_count: bySource[c.name] ?? 0,
        };
      });
      return jsonResult({ sources });
    },
  );
}
