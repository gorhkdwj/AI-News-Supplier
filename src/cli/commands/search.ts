import type { Command } from 'commander';
import { openDb } from '../../core/db/connection.js';
import { searchItems } from '../../core/store/itemStore.js';
import { formatSearchResults, printJson, printText } from '../format.js';
import { parsePositiveInt, parseTypes } from '../shared.js';

export function registerSearch(program: Command): void {
  program
    .command('search <query>')
    .description('축적된 항목을 전문 검색합니다(FTS)')
    .option('--limit <n>', '표시 개수', '20')
    .option('--days <n>', '조회 윈도(일)', '30')
    .option('--type <list>', '유형 필터(쉼표 구분)')
    .option('--json', 'JSON으로 출력')
    .action(async (query: string, opts) => {
      const db = openDb();
      try {
        const items = searchItems(db, query, {
          sinceDays: parsePositiveInt(opts.days as string, 30),
          types: parseTypes(opts.type as string | undefined),
          limit: parsePositiveInt(opts.limit as string, 20),
        });
        if (opts.json) printJson(items);
        else printText(formatSearchResults(items));
      } finally {
        db.close();
      }
    });
}
