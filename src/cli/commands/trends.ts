import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { openDb } from '../../core/db/connection.js';
import { refreshStale } from '../../core/refresh.js';
import { queryRecent } from '../../core/store/itemStore.js';
import { computeHotness, interleaveBySource } from '../../core/rank.js';
import { formatTrends, printJson, printText } from '../format.js';
import { parseList, parsePositiveInt, parseTypes } from '../shared.js';

export function registerTrends(program: Command): void {
  program
    .command('trends')
    .description('최신 AI 트렌드를 hotness 순으로 보여줍니다')
    .option('--limit <n>', '표시 개수', '20')
    .option('--source <list>', '소스 필터(쉼표 구분): hackernews,github ...')
    .option('--type <list>', '유형 필터(쉼표 구분): community,paper ...')
    .option('--hours <n>', '조회 윈도(시간)', '72')
    .option('--no-refresh', '수집 없이 DB에서만 조회')
    .option('--json', 'JSON으로 출력')
    .action(async (opts) => {
      const db = openDb();
      try {
        const config = loadConfig();
        const sources = parseList(opts.source as string | undefined);
        const types = parseTypes(opts.type as string | undefined);
        const limit = parsePositiveInt(opts.limit as string, 20);
        const hours = parsePositiveInt(opts.hours as string, 72);

        if (opts.refresh !== false) {
          await refreshStale(db, config, { sources });
        }

        const items = queryRecent(db, { sinceHours: hours, sources, types, limit: 500 });
        const ranked = computeHotness(items, new Date());
        const top = interleaveBySource(ranked, limit, config.maxPerSourceRatio);

        if (opts.json) printJson(top);
        else printText(formatTrends(top));
      } finally {
        db.close();
      }
    });
}
