import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getDataDir } from '../core/paths.js';

const REGISTRY_LATEST_URL = 'https://registry.npmjs.org/ai-news-supplier/latest';
const CHECK_INTERVAL_MS = 24 * 3_600_000;
const FETCH_TIMEOUT_MS = 2_000;

export interface UpdateCache {
  checkedAt: string;
  latestVersion: string;
}

export function getUpdateCachePath(): string {
  return join(getDataDir(), 'update-check.json');
}

export function readUpdateCache(): UpdateCache | null {
  try {
    return JSON.parse(readFileSync(getUpdateCachePath(), 'utf8')) as UpdateCache;
  } catch {
    return null;
  }
}

export function writeUpdateCache(cache: UpdateCache): void {
  mkdirSync(getDataDir(), { recursive: true });
  writeFileSync(getUpdateCachePath(), JSON.stringify(cache, null, 2) + '\n', 'utf8');
}

/** 숫자 세그먼트 기준 semver 비교. a<b → -1, a=b → 0, a>b → 1. 프리릴리스 태그는 무시한다. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string): number[] =>
    (v.split('-')[0] ?? v).split('.').map((s) => Number.parseInt(s, 10) || 0);
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function isCacheFresh(cache: UpdateCache | null, now: Date): boolean {
  if (!cache) return false;
  const checkedAt = Date.parse(cache.checkedAt);
  return Number.isFinite(checkedAt) && now.getTime() - checkedAt < CHECK_INTERVAL_MS;
}

export function formatUpdateNotice(current: string, latest: string): string {
  return `\nains 새 버전이 있습니다: ${current} → ${latest}\n업데이트: npm install -g ai-news-supplier\n(끄기: AINS_NO_UPDATE_CHECK=1)\n`;
}

/** 확인을 건너뛰어야 하는 상황인지. dev 빌드·옵트아웃·CI에서는 조용히 지나간다. */
export function shouldSkipCheck(currentVersion: string, env: NodeJS.ProcessEnv): boolean {
  if (currentVersion.includes('dev')) return true;
  if (env.AINS_NO_UPDATE_CHECK) return true;
  if (env.CI) return true;
  return false;
}

/** npm 레지스트리에서 latest 버전을 조회한다. 실패하면 null(안내 자체를 생략). */
async function fetchLatestVersion(): Promise<string | null> {
  // 최선 노력 1회 조회이므로 core http 클라이언트(재시도 내장) 대신 가벼운 fetch를 쓴다.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(REGISTRY_LATEST_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 명령 처리 후 stderr로 새 버전을 안내한다.
 * - stdout(파이프·JSON 출력)을 오염시키지 않는다.
 * - 24시간에 최대 1회만 네트워크를 확인하고, 실패는 조용히 무시한다.
 * - 어떤 경우에도 CLI 종료 코드에 영향을 주지 않는다.
 */
export async function maybeNotifyUpdate(
  currentVersion: string,
  opts: { now?: Date; fetcher?: () => Promise<string | null>; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  try {
    const env = opts.env ?? process.env;
    if (shouldSkipCheck(currentVersion, env)) return;

    const now = opts.now ?? new Date();
    let cache = readUpdateCache();
    if (!isCacheFresh(cache, now)) {
      const latest = await (opts.fetcher ?? fetchLatestVersion)();
      if (latest === null) return; // 오프라인 등 — 이번 실행은 안내 생략
      cache = { checkedAt: now.toISOString(), latestVersion: latest };
      writeUpdateCache(cache);
    }
    if (cache && compareSemver(currentVersion, cache.latestVersion) < 0) {
      process.stderr.write(formatUpdateNotice(currentVersion, cache.latestVersion));
    }
  } catch {
    // 업데이트 안내는 부가 기능 — 실패가 본 명령을 방해하지 않는다.
  }
}
