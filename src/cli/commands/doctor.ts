import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { openDb } from '../../core/db/connection.js';
import { getDataDir, getDbPath } from '../../core/paths.js';
import { countItems, countItemsBySource } from '../../core/store/itemStore.js';
import { getSourceState } from '../../core/store/fetchLog.js';
import { ALL_COLLECTORS } from '../../collectors/registry.js';
import { SCHEMA_VERSION } from '../../core/db/migrations.js';
import { printText } from '../format.js';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('환경과 DB 상태를 점검합니다')
    .action(() => {
      const lines: string[] = [];
      const nodeMajor = Number(process.versions.node.split('.')[0]);
      lines.push(`Node ${process.version} ${nodeMajor >= 20 ? 'OK' : '(>=20 필요)'}`);
      lines.push(`데이터 경로 : ${getDataDir()}`);
      lines.push(`DB 파일     : ${getDbPath()}`);

      const config = loadConfig();
      const db = openDb();
      try {
        const integrity = db.pragma('integrity_check', { simple: true });
        const userVersion = db.pragma('user_version', { simple: true });
        lines.push(`DB 무결성   : ${String(integrity)} (스키마 v${String(userVersion)}/${SCHEMA_VERSION})`);
        lines.push(`총 항목     : ${countItems(db)}`);

        const bySource = countItemsBySource(db);
        lines.push('소스 상태:');
        for (const c of ALL_COLLECTORS) {
          const enabled = c.isEnabled(config);
          const state = getSourceState(db, c.name);
          lines.push(
            `  ${c.name.padEnd(14, ' ')} ${enabled ? 'enabled ' : 'disabled'} · 항목 ${bySource[c.name] ?? 0} · 마지막성공 ${state?.lastSuccessAt ?? '-'} · 연속실패 ${state?.consecutiveFailures ?? 0}`,
          );
        }
      } finally {
        db.close();
      }
      printText(lines.join('\n'));
    });
}
