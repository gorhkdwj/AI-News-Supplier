import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { getConfigPath, getConfigExamplePath, getDataDir } from '../../core/paths.js';
import { defaultConfig, loadConfig } from '../../core/config.js';
import { printJson, printText } from '../format.js';

function ensureConfigFile(): void {
  mkdirSync(getDataDir(), { recursive: true });
  if (!existsSync(getConfigPath())) writeFileSync(getConfigPath(), '{}\n');
}

export function registerConfig(program: Command): void {
  const config = program.command('config').description('설정 파일 관리');

  config
    .command('path')
    .description('설정 파일 경로를 출력합니다')
    .action(() => printText(getConfigPath()));

  config
    .command('show')
    .description('현재 유효한 설정(기본값+오버라이드)을 출력합니다')
    .action(() => printJson(loadConfig()));

  config
    .command('init')
    .description('예제 설정 파일과 빈 설정 파일을 생성합니다')
    .action(() => {
      mkdirSync(getDataDir(), { recursive: true });
      const examplePath = getConfigExamplePath();
      writeFileSync(examplePath, JSON.stringify(defaultConfig(), null, 2) + '\n');
      ensureConfigFile();
      printText(`예제 생성: ${examplePath}\n설정 파일: ${getConfigPath()} (여기를 편집하십시오)`);
    });

  config
    .command('edit')
    .description('$EDITOR(없으면 OS 기본 편집기)로 설정 파일을 엽니다')
    .action(() => {
      ensureConfigFile();
      const editor = process.env.EDITOR ?? (process.platform === 'win32' ? 'notepad' : 'nano');
      spawn(editor, [getConfigPath()], { stdio: 'inherit' });
    });
}
