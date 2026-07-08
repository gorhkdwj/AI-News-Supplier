import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { installSchedule, uninstallSchedule, scheduleStatus } from '../../scheduler/index.js';
import { printText } from '../format.js';
import { parsePositiveInt } from '../shared.js';

/** 스케줄러가 실행할 CLI 스크립트의 절대 경로. */
function resolveScriptPath(): string {
  // 번들된 dist/cli/index.js 기준. argv[1]이 있으면 그것을 우선한다.
  const arg = process.argv[1];
  if (arg) return arg;
  return fileURLToPath(import.meta.url);
}

export function registerSchedule(program: Command): void {
  const schedule = program
    .command('schedule')
    .description('OS 스케줄러에 주기적 수집(fetch)을 등록/해제합니다');

  schedule
    .command('install')
    .description('주기적 백그라운드 수집을 등록합니다')
    .option('--every <minutes>', '수집 주기(분)', '60')
    .action((opts) => {
      const everyMinutes = parsePositiveInt(opts.every as string, 60);
      installSchedule({
        nodePath: process.execPath,
        scriptPath: resolveScriptPath(),
        everyMinutes,
      });
      printText(`스케줄 등록됨: ${everyMinutes}분마다 fetch. (해제: ains schedule uninstall)`);
    });

  schedule
    .command('uninstall')
    .description('등록된 주기 수집을 해제합니다')
    .action(() => {
      uninstallSchedule();
      printText('스케줄 해제됨.');
    });

  schedule
    .command('status')
    .description('스케줄 등록 상태를 확인합니다')
    .action(() => {
      const status = scheduleStatus();
      printText(status ? `등록됨:\n${status}` : '등록된 스케줄이 없습니다.');
    });
}
