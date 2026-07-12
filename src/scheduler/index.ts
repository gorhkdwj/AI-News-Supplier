import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir } from '../core/paths.js';

const TASK_NAME = 'ai-news-supplier-fetch';
const CRON_MARKER = '# ai-news-supplier-fetch';

export interface ScheduleTarget {
  nodePath: string;
  scriptPath: string;
  everyMinutes: number;
}

/**
 * 설치 시점에 "무엇을 등록했는지"를 데이터 디렉터리에 기록한다.
 * doctor가 OS 등록 내용을 역파싱하지 않고 이 파일과 실제 파일 존재를 대조한다.
 */
export interface ScheduleManifest extends ScheduleTarget {
  platform: NodeJS.Platform;
  /** win32에서 콘솔 창 없이 실행하기 위한 wscript 래퍼 경로. Unix는 null. */
  wrapperPath: string | null;
  installedAt: string;
}

export function getManifestPath(): string {
  return join(getDataDir(), 'schedule.json');
}

export function getWrapperPath(): string {
  return join(getDataDir(), 'fetch-hidden.vbs');
}

function fetchCommand(t: ScheduleTarget): string {
  return `"${t.nodePath}" "${t.scriptPath}" fetch --quiet`;
}

/**
 * node.exe를 콘솔 창 없이 실행하는 VBScript 래퍼 내용.
 * VBS 문자열 리터럴 안에서 큰따옴표는 두 번 겹쳐 이스케이프한다.
 */
export function buildWindowsWrapper(t: ScheduleTarget): string {
  const escaped = fetchCommand(t).replace(/"/g, '""');
  return `CreateObject("WScript.Shell").Run "${escaped}", 0, False\r\n`;
}

export function writeManifest(manifest: ScheduleManifest): void {
  mkdirSync(getDataDir(), { recursive: true });
  writeFileSync(getManifestPath(), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

export function readManifest(): ScheduleManifest | null {
  try {
    return JSON.parse(readFileSync(getManifestPath(), 'utf8')) as ScheduleManifest;
  } catch {
    return null; // 없거나 손상 — 구버전 방식 설치로 취급
  }
}

function removeArtifacts(): void {
  // 해제는 최선 노력으로 정리한다(파일이 없어도 실패하지 않음).
  rmSync(getManifestPath(), { force: true });
  rmSync(getWrapperPath(), { force: true });
}

// ── Windows (schtasks) ──────────────────────────────────────────────
function installWindows(t: ScheduleTarget): string {
  mkdirSync(getDataDir(), { recursive: true });
  const wrapper = getWrapperPath();
  writeFileSync(wrapper, buildWindowsWrapper(t), 'utf8');
  execFileSync(
    'schtasks',
    [
      '/Create',
      '/TN',
      TASK_NAME,
      '/SC',
      'MINUTE',
      '/MO',
      String(t.everyMinutes),
      '/TR',
      `wscript.exe "${wrapper}"`,
      '/F',
    ],
    { stdio: 'pipe' },
  );
  return wrapper;
}

function uninstallWindows(): void {
  execFileSync('schtasks', ['/Delete', '/TN', TASK_NAME, '/F'], { stdio: 'pipe' });
}

function statusWindows(): string | null {
  try {
    return execFileSync('schtasks', ['/Query', '/TN', TASK_NAME], { stdio: 'pipe' }).toString();
  } catch {
    return null;
  }
}

// ── Unix (crontab) ──────────────────────────────────────────────────
function readCrontab(): string {
  try {
    // 셸 없이 실행(인자 배열). crontab 내용은 stdin으로만 주고받는다.
    return execFileSync('crontab', ['-l'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return ''; // crontab 없음
  }
}

function writeCrontab(content: string): void {
  execFileSync('crontab', ['-'], { input: content.endsWith('\n') ? content : content + '\n' });
}

function withoutMarker(crontab: string): string[] {
  return crontab.split('\n').filter((l) => l.trim() && !l.includes(CRON_MARKER));
}

function installUnix(t: ScheduleTarget): void {
  const lines = withoutMarker(readCrontab());
  lines.push(`*/${t.everyMinutes} * * * * ${fetchCommand(t)} ${CRON_MARKER}`);
  writeCrontab(lines.join('\n'));
}

function uninstallUnix(): void {
  writeCrontab(withoutMarker(readCrontab()).join('\n'));
}

function statusUnix(): string | null {
  const line = readCrontab()
    .split('\n')
    .find((l) => l.includes(CRON_MARKER));
  return line ?? null;
}

// ── 플랫폼 분기 ─────────────────────────────────────────────────────
export function installSchedule(t: ScheduleTarget): void {
  let wrapperPath: string | null = null;
  if (process.platform === 'win32') wrapperPath = installWindows(t);
  else installUnix(t);
  writeManifest({
    ...t,
    platform: process.platform,
    wrapperPath,
    installedAt: new Date().toISOString(),
  });
}

export function uninstallSchedule(): void {
  if (process.platform === 'win32') uninstallWindows();
  else uninstallUnix();
  removeArtifacts();
}

/** 등록되어 있으면 상태 문자열, 없으면 null. */
export function scheduleStatus(): string | null {
  return process.platform === 'win32' ? statusWindows() : statusUnix();
}

// ── 상태 진단 ───────────────────────────────────────────────────────
export interface ScheduleHealth {
  registered: boolean;
  manifest: ScheduleManifest | null;
  /** manifest가 있을 때만 검사. 실행 대상 스크립트 존재 여부. */
  scriptExists: boolean | null;
  /** win32 manifest일 때만 검사. 래퍼 파일 존재 여부. */
  wrapperExists: boolean | null;
}

export function scheduleHealth(): ScheduleHealth {
  const registered = scheduleStatus() !== null;
  const manifest = readManifest();
  return {
    registered,
    manifest,
    scriptExists: manifest ? existsSync(manifest.scriptPath) : null,
    wrapperExists: manifest?.wrapperPath ? existsSync(manifest.wrapperPath) : null,
  };
}

/** doctor 표시용 한 줄 요약. 순수 함수로 분리해 테스트한다. */
export function describeScheduleHealth(h: ScheduleHealth): string {
  if (!h.registered) return '미등록';
  if (!h.manifest) return '등록됨 (구버전 방식 — ains schedule install로 재등록 권장)';
  if (h.scriptExists === false)
    return `등록됨 · 경고: 실행 대상 없음(${h.manifest.scriptPath}) — ains schedule install로 재등록 필요`;
  if (h.manifest.wrapperPath && h.wrapperExists === false)
    return `등록됨 · 경고: 래퍼 파일 없음(${h.manifest.wrapperPath}) — ains schedule install로 재등록 필요`;
  return `등록됨 (${h.manifest.everyMinutes}분마다)`;
}
