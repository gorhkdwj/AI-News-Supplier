import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildWindowsWrapper,
  describeScheduleHealth,
  getManifestPath,
  getWrapperPath,
  readManifest,
  writeManifest,
  type ScheduleHealth,
  type ScheduleManifest,
} from '../../src/scheduler/index.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ains-sched-'));
  tempDirs.push(dir);
  vi.stubEnv('AINS_HOME', dir);
  return dir;
}

function sampleManifest(overrides: Partial<ScheduleManifest> = {}): ScheduleManifest {
  return {
    nodePath: 'C:\\nodejs\\node.exe',
    scriptPath: 'C:\\pkg\\dist\\cli\\index.js',
    everyMinutes: 60,
    platform: 'win32',
    wrapperPath: 'C:\\home\\fetch-hidden.vbs',
    installedAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildWindowsWrapper', () => {
  it('창 숨김(0) 옵션의 WScript.Shell.Run 한 줄을 생성한다', () => {
    const vbs = buildWindowsWrapper({
      nodePath: 'C:\\nodejs\\node.exe',
      scriptPath: 'C:\\pkg\\dist\\cli\\index.js',
      everyMinutes: 60,
    });
    expect(vbs).toContain('CreateObject("WScript.Shell").Run ');
    expect(vbs).toContain(', 0, False');
  });

  it('경로의 큰따옴표를 VBS 규칙(겹따옴표)으로 이스케이프한다', () => {
    const vbs = buildWindowsWrapper({
      nodePath: 'C:\\node.exe',
      scriptPath: 'C:\\a\\index.js',
      everyMinutes: 60,
    });
    // 원하는 실행 문자열: "C:\node.exe" "C:\a\index.js" fetch --quiet
    expect(vbs).toContain('""C:\\node.exe"" ""C:\\a\\index.js"" fetch --quiet');
  });
});

describe('schedule manifest', () => {
  it('write 후 read로 동일한 내용이 복원된다', () => {
    tempHome();
    const manifest = sampleManifest();
    writeManifest(manifest);
    expect(existsSync(getManifestPath())).toBe(true);
    expect(readManifest()).toEqual(manifest);
  });

  it('manifest가 없으면 null을 반환한다', () => {
    tempHome();
    expect(readManifest()).toBeNull();
  });

  it('경로 헬퍼가 AINS_HOME 하위를 가리킨다', () => {
    const dir = tempHome();
    expect(getManifestPath()).toBe(join(dir, 'schedule.json'));
    expect(getWrapperPath()).toBe(join(dir, 'fetch-hidden.vbs'));
  });
});

describe('describeScheduleHealth', () => {
  function health(overrides: Partial<ScheduleHealth>): ScheduleHealth {
    return {
      registered: true,
      manifest: sampleManifest(),
      scriptExists: true,
      wrapperExists: true,
      ...overrides,
    };
  }

  it('미등록이면 미등록을 반환한다', () => {
    expect(describeScheduleHealth(health({ registered: false }))).toBe('미등록');
  });

  it('manifest 없는 등록은 구버전 방식으로 안내한다', () => {
    expect(describeScheduleHealth(health({ manifest: null }))).toContain('구버전 방식');
  });

  it('실행 대상 스크립트가 없으면 경로와 함께 재등록을 경고한다', () => {
    const text = describeScheduleHealth(health({ scriptExists: false }));
    expect(text).toContain('실행 대상 없음');
    expect(text).toContain('C:\\pkg\\dist\\cli\\index.js');
    expect(text).toContain('재등록');
  });

  it('win32 래퍼 파일이 없으면 재등록을 경고한다', () => {
    expect(describeScheduleHealth(health({ wrapperExists: false }))).toContain('래퍼 파일 없음');
  });

  it('정상 상태는 주기를 표시한다', () => {
    expect(describeScheduleHealth(health({}))).toBe('등록됨 (60분마다)');
  });

  it('Unix manifest(래퍼 없음)는 wrapperExists를 검사하지 않는다', () => {
    const unix = health({
      manifest: sampleManifest({ platform: 'linux', wrapperPath: null }),
      wrapperExists: null,
    });
    expect(describeScheduleHealth(unix)).toBe('등록됨 (60분마다)');
  });
});
