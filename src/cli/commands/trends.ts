import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { openDb } from '../../core/db/connection.js';
import { refreshStale } from '../../core/refresh.js';
import { resolveTrendRequest } from '../../core/trends/request.js';
import { serializeTrendItem } from '../../core/trends/serialize.js';
import { getTrends } from '../../core/trends/service.js';
import { formatTrends, printJson, printText } from '../format.js';
import { parseList } from '../shared.js';

function numberOption(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

export function registerTrends(program: Command): void {
  program
    .command('trends')
    .description('유형별 AI 트렌드를 보여줍니다')
    .option('--ranking <version>', '랭킹 버전: v2(기본),legacy(0.4.0 제거 예정)')
    .option('--channel <channel>', '채널: overview,community,official,repos,research')
    .option('--sort <sort>', '정렬: briefing,hot,latest,important,trending,discovery')
    .option('--limit <n>', '표시 개수')
    .option('--source <list>', '소스 필터(쉼표 구분): hackernews,github ...')
    .option('--type <list>', '유형 필터(쉼표 구분): community,paper ...')
    .option('--hours <n>', '조회 윈도(시간)')
    .option('--no-refresh', '수집 없이 DB에서만 조회')
    .option('--json', 'JSON으로 출력')
    .action(async (opts) => {
      const request = resolveTrendRequest({
        rankingVersion: opts.ranking as string | undefined,
        channel: opts.channel as string | undefined,
        sort: opts.sort as string | undefined,
        sources: parseList(opts.source as string | undefined),
        types: parseList(opts.type as string | undefined),
        sinceHours: numberOption(opts.hours as string | undefined),
        limit: numberOption(opts.limit as string | undefined),
      });
      const db = openDb();
      try {
        const config = loadConfig();

        if (opts.refresh !== false) {
          await refreshStale(db, config, { sources: request.sources });
        }

        const result = getTrends(db, request, { maxPerSourceRatio: config.maxPerSourceRatio });

        if (opts.json) printJson(result.items.map(serializeTrendItem));
        else printText(formatTrends(result));
      } finally {
        db.close();
      }
    });
}
