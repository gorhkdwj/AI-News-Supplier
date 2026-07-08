import { execFileSync } from 'node:child_process';

const TASK_NAME = 'ai-news-supplier-fetch';
const CRON_MARKER = '# ai-news-supplier-fetch';

export interface ScheduleTarget {
  nodePath: string;
  scriptPath: string;
  everyMinutes: number;
}

function fetchCommand(t: ScheduleTarget): string {
  return `"${t.nodePath}" "${t.scriptPath}" fetch --quiet`;
}

// ── Windows (schtasks) ──────────────────────────────────────────────
function installWindows(t: ScheduleTarget): void {
  execFileSync(
    'schtasks',
    ['/Create', '/TN', TASK_NAME, '/SC', 'MINUTE', '/MO', String(t.everyMinutes), '/TR', fetchCommand(t), '/F'],
    { stdio: 'pipe' },
  );
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
  if (process.platform === 'win32') installWindows(t);
  else installUnix(t);
}

export function uninstallSchedule(): void {
  if (process.platform === 'win32') uninstallWindows();
  else uninstallUnix();
}

/** 등록되어 있으면 상태 문자열, 없으면 null. */
export function scheduleStatus(): string | null {
  return process.platform === 'win32' ? statusWindows() : statusUnix();
}
