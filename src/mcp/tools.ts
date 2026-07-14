import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { DB } from '../core/db/connection.js';
import type { ResolvedConfig } from '../core/config.js';
import { refreshStale } from '../core/refresh.js';
import { searchItems, countItemsBySource } from '../core/store/itemStore.js';
import { getSourceState } from '../core/store/fetchLog.js';
import { allCollectors } from '../collectors/registry.js';
import { ITEM_TYPES, type ItemType, type NewsItem } from '../core/types.js';
import { TrendInputError, resolveTrendRequest } from '../core/trends/request.js';
import { serializeSighting, serializeTrendResult } from '../core/trends/serialize.js';
import { getTrendItemDetail, getTrends } from '../core/trends/service.js';
import { mineLearningCandidates, type EvidenceBuckets } from '../core/learning/candidates.js';
import { designLearningSession } from '../core/learning/session.js';
import { recordLearning, getLearningHistory } from '../core/store/learningStore.js';

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

function bucketsToBrief(b: EvidenceBuckets) {
  return {
    official: b.official.map(toItemBrief),
    papers: b.papers.map(toItemBrief),
    repos: b.repos.map(toItemBrief),
    discussion: b.discussion.map(toItemBrief),
  };
}

const levelEnum = z.enum(['beginner', 'intermediate', 'advanced']);
const rankingVersionEnum = z.enum(['legacy', 'v2']);
const channelEnum = z.enum(['overview', 'community', 'official', 'repos', 'research']);
const sortEnum = z.enum(['briefing', 'hot', 'latest', 'important', 'trending', 'discovery']);

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
        ranking_version: rankingVersionEnum.optional(),
        channel: channelEnum.optional(),
        sort: sortEnum.optional(),
      },
    },
    async (args) => {
      const input = {
        rankingVersion: args.ranking_version,
        channel: args.channel,
        sort: args.sort,
        sources: args.sources,
        types: args.types,
        sinceHours: args.since_hours,
        limit: args.limit,
      };
      try {
        const request = resolveTrendRequest(input);
        await refreshStale(db, config, { sources: request.sources });
        return jsonResult(
          serializeTrendResult(
            getTrends(db, request, { maxPerSourceRatio: config.maxPerSourceRatio }),
          ),
        );
      } catch (error) {
        if (error instanceof TrendInputError) {
          throw new McpError(ErrorCode.InvalidParams, error.message);
        }
        throw error;
      }
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
      const detail = getTrendItemDetail(db, args.id);
      if (!detail.found) return jsonResult({ found: false });
      return jsonResult({
        found: true,
        item: detail.item,
        score_history: detail.scoreHistory,
        sightings: detail.sightings.map(serializeSighting),
      });
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

  server.registerTool(
    'get_learning_candidates',
    {
      description:
        '최근 데이터에서 학습 가치가 높은 토픽(여러 소스 등장·급상승·신규성)을 근거 자료와 함께 반환합니다.',
      inputSchema: {
        limit: z.number().int().positive().max(20).optional(),
        since_days: z.number().int().positive().optional(),
        include_learned: z.boolean().optional(),
      },
    },
    async (args) => {
      await refreshStale(db, config);
      const candidates = mineLearningCandidates(db, {
        limit: args.limit ?? 5,
        sinceDays: args.since_days ?? 7,
        includeLearned: args.include_learned ?? false,
        relearnAfterDays: config.learning.relearnAfterDays,
        now: new Date(),
      });
      return jsonResult({
        candidates: candidates.map((c) => ({
          topic: c.topic,
          normalized_topic: c.normalizedTopic,
          learn_score: c.learnScore,
          signals: c.signals,
          why: c.why,
          evidence: bucketsToBrief(c.evidence),
        })),
      });
    },
  );

  server.registerTool(
    'design_learning_session',
    {
      description:
        '특정 토픽의 맥락 자료를 모으고, 에이전트가 학습 세션을 설계·진행하도록 지시문을 반환합니다. ' +
        '수집 데이터가 대부분 영어이므로 topic은 영어 키워드 1~2개를 권장합니다(예: "agent evaluation"). ' +
        '전체 일치 자료가 없으면 단어별 일치로 자동 완화하며, 그래도 0건이면 search.mode="none"과 재시도 안내를 반환합니다.',
      inputSchema: {
        topic: z.string().min(1),
        level: levelEnum.optional(),
        time_budget_minutes: z.number().int().positive().optional(),
      },
    },
    (args) => {
      const session = designLearningSession(db, {
        topic: args.topic,
        level: args.level ?? config.learning.defaultLevel,
        timeBudgetMinutes: args.time_budget_minutes ?? 45,
      });
      return jsonResult({
        topic: session.topic,
        context: bucketsToBrief(session.context),
        instructions: session.instructions,
        search: { mode: session.search.mode, matched: session.search.matched },
      });
    },
  );

  server.registerTool(
    'record_learning',
    {
      description: '학습한 토픽을 이력에 기록합니다(이후 후보 추천에서 중복 제외).',
      inputSchema: {
        topic: z.string().min(1),
        level: levelEnum.optional(),
        time_spent_min: z.number().int().positive().optional(),
        notes: z.string().optional(),
        item_ids: z.array(z.string()).optional(),
      },
    },
    (args) => {
      const id = recordLearning(db, {
        topic: args.topic,
        level: args.level,
        timeSpentMin: args.time_spent_min,
        notes: args.notes,
        itemIds: args.item_ids,
      });
      return jsonResult({ recorded: true, id });
    },
  );

  server.registerTool(
    'get_learning_history',
    {
      description: '학습 이력을 최신순으로 반환합니다.',
      inputSchema: { limit: z.number().int().positive().max(100).optional() },
    },
    (args) => {
      return jsonResult({ entries: getLearningHistory(db, args.limit ?? 20) });
    },
  );
}
