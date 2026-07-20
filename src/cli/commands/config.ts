import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { getConfigPath, getConfigExamplePath, getDataDir } from '../../core/paths.js';
import { defaultConfig, loadConfig } from '../../core/config.js';
import type { ResolvedConfig } from '../../core/config.js';
import { printJson, printText } from '../format.js';

function ensureConfigFile(): void {
  mkdirSync(getDataDir(), { recursive: true });
  if (!existsSync(getConfigPath())) writeFileSync(getConfigPath(), '{}\n');
}

/** 설정된 비밀정보를 가리는 표시. 미설정(null)과 구분되도록 값이 있을 때만 사용한다. */
const MASK = '***';

function maskValue(value: string | null): string | null {
  return value === null ? null : MASK;
}

/**
 * `tokens` 블록의 값을 마스킹한 사본을 만든다 (B-017, 계약 §1).
 *
 * 설정 여부는 진단에 필요하므로 미설정은 `null`로 남겨 설정된 값(`***`)과 구분한다.
 * Reddit `username`도 가린다 — 자격증명은 아니지만 `tokens` 블록 전체를 출력하지 않는
 * 규칙이 예외를 두는 것보다 감사하기 쉽고, "세 값 중 무엇이 비었는가"라는 진단 목적은
 * `null`/`***` 구분만으로 충분히 충족된다.
 */
export function maskSecrets(config: ResolvedConfig): ResolvedConfig {
  return {
    ...config,
    tokens: {
      github: maskValue(config.tokens.github),
      reddit: {
        clientId: maskValue(config.tokens.reddit.clientId),
        clientSecret: maskValue(config.tokens.reddit.clientSecret),
        username: maskValue(config.tokens.reddit.username),
      },
    },
  };
}

export function registerConfig(program: Command): void {
  const config = program.command('config').description('설정 파일 관리');

  config
    .command('path')
    .description('설정 파일 경로를 출력합니다')
    .action(() => printText(getConfigPath()));

  config
    .command('show')
    .description('현재 유효한 설정(기본값+오버라이드)을 출력합니다(토큰은 가려서 출력)')
    .option('--reveal', '토큰과 client secret을 가리지 않고 원값으로 출력(공유 금지)')
    .action((opts: { reveal?: boolean }) => {
      const config = loadConfig();
      if (!opts.reveal) {
        printJson(maskSecrets(config));
        return;
      }
      // stdout은 JSON 전용으로 유지해야 하므로 경고는 stderr로 보낸다.
      process.stderr.write(
        '경고: 비밀정보가 그대로 출력됩니다. 화면 공유·로그 첨부·이슈 붙여넣기에 사용하지 마십시오.\n',
      );
      printJson(config);
    });

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
