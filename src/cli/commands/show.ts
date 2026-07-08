import type { Command } from 'commander';
import { openDb } from '../../core/db/connection.js';
import { getItemById } from '../../core/store/itemStore.js';
import { formatItemDetail, printJson, printText } from '../format.js';
import { fail } from '../shared.js';

export function registerShow(program: Command): void {
  program
    .command('show <id>')
    .description('항목 상세를 봅니다')
    .option('--json', 'JSON으로 출력(raw 포함)')
    .action((id: string, opts) => {
      const db = openDb();
      try {
        const item = getItemById(db, id);
        if (!item) fail(`항목을 찾을 수 없습니다: ${id}`);
        if (opts.json) printJson(item);
        else printText(formatItemDetail(item));
      } finally {
        db.close();
      }
    });
}
