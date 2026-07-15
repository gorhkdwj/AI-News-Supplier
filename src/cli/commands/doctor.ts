import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { openDb } from '../../core/db/connection.js';
import { getDataDir, getDbPath } from '../../core/paths.js';
import { countItems, countItemsBySource } from '../../core/store/itemStore.js';
import { getSourceState } from '../../core/store/fetchLog.js';
import { allCollectors } from '../../collectors/registry.js';
import { SCHEMA_VERSION } from '../../core/db/migrations.js';
import { describeScheduleHealth, scheduleHealth } from '../../scheduler/index.js';
import { printText } from '../format.js';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('환경과 DB 상태를 점검합니다')
    .action(() => {
      const lines: string[] = [];
      const nodeMajor = Number(process.versions.node.split('.')[0]);
      lines.push(`Node ${process.version} ${nodeMajor >= 22 ? 'OK' : '(>=22.12 필요)'}`);
      lines.push(`데이터 경로 : ${getDataDir()}`);
      lines.push(`DB 파일     : ${getDbPath()}`);

      const config = loadConfig();
      lines.push(
        `보존 정책   : ${config.retentionDays == null ? '영구 보존' : `${config.retentionDays}일`}`,
      );
      lines.push(`스케줄      : ${describeScheduleHealth(scheduleHealth())}`);
      // 토큰 값은 절대 출력하지 않는다(보안 원칙) — 존재 여부만 진단한다.
      if (config.tokens.github) {
        lines.push('GitHub 토큰 : 설정됨 (rate limit 5,000회/시)');
      } else {
        lines.push('GitHub 토큰 : 없음 — 시간당 60회 제한으로 수집이 실패할 수 있습니다');
        lines.push('              발급(권한 불필요, 읽기 전용): https://github.com/settings/tokens');
        lines.push(
          '              설정: ~/.ai-news-supplier/config.json 의 tokens.github 또는 GITHUB_TOKEN 환경변수',
        );
      }
      const db = openDb();
      try {
        const integrity = db.pragma('integrity_check', { simple: true });
        const userVersion = db.pragma('user_version', { simple: true });
        lines.push(
          `DB 무결성   : ${String(integrity)} (스키마 v${String(userVersion)}/${SCHEMA_VERSION})`,
        );
        lines.push(`총 항목     : ${countItems(db)}`);

        const bySource = countItemsBySource(db);
        lines.push('소스 상태:');
        for (const c of allCollectors(config)) {
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
