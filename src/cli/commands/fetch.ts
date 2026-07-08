import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { openDb } from '../../core/db/connection.js';
import { refreshStale } from '../../core/refresh.js';
import { formatFetchSummary, printJson, printText } from '../format.js';
import { parseList } from '../shared.js';

export function registerFetch(program: Command): void {
  program
    .command('fetch')
    .description('소스에서 최신 항목을 수집해 로컬 DB에 축적합니다')
    .option('--source <list>', '특정 소스만(쉼표 구분)')
    .option('--force', 'TTL을 무시하고 강제 수집')
    .option('--quiet', '요약 출력 없이 종료 코드만(스케줄러용)')
    .option('--json', 'JSON으로 출력')
    .action(async (opts) => {
      const db = openDb();
      try {
        const config = loadConfig();
        const summary = await refreshStale(db, config, {
          sources: parseList(opts.source as string | undefined),
          force: Boolean(opts.force),
        });

        const hasError = summary.results.some((r) => r.status === 'error');
        if (!opts.quiet) {
          if (opts.json) printJson(summary);
          else printText(formatFetchSummary(summary.results));
        }
        // 일부 소스 실패는 부분 성공으로 보고하되 종료 코드는 0(격리 원칙). 전부 실패면 1.
        const allError = summary.results.length > 0 && summary.results.every((r) => r.status === 'error');
        if (allError) process.exitCode = 1;
        else if (hasError && opts.quiet) process.exitCode = 0;
      } finally {
        db.close();
      }
    });
}
