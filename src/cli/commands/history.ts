import type { Command } from 'commander';
import { openDb } from '../../core/db/connection.js';
import { getLearningHistory } from '../../core/store/learningStore.js';
import { formatHistory, printJson, printText } from '../format.js';
import { parsePositiveInt } from '../shared.js';

export function registerHistory(program: Command): void {
  program
    .command('history')
    .description('학습 이력을 보여줍니다')
    .option('--limit <n>', '개수', '20')
    .option('--json', 'JSON으로 출력')
    .action((opts) => {
      const db = openDb();
      try {
        const entries = getLearningHistory(db, parsePositiveInt(opts.limit as string, 20));
        if (opts.json) printJson({ entries });
        else printText(formatHistory(entries));
      } finally {
        db.close();
      }
    });
}
