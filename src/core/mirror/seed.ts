import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { DB } from '../db/connection.js';
import type { ResolvedConfig } from '../config.js';
import { logger } from '../logger.js';
import { mergeMirrorBucket, parseMirrorBucket, type MirrorMergeCounts } from './import.js';

/** manifest.json의 형식 (tools/mirror-manifest.mjs가 생성, 계약 14.2). */
interface MirrorManifest {
  formatVersion: number;
  files: Array<{ file: string; bucketAt: string; sha256: string }>;
}

/** 네트워크 접근은 주입 가능하게 분리한다(테스트에서 가짜로 대체). */
export interface MirrorFetcher {
  getJson(url: string): Promise<unknown>;
  getBuffer(url: string): Promise<Buffer>;
}

export interface SeedResult {
  filesListed: number;
  filesMerged: number;
  filesFailed: number;
  merged: MirrorMergeCounts;
}

const USER_AGENT = 'ai-news-supplier (+https://github.com/gorhkdwj/AI-News-Supplier)';

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow',
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** 기본 fetcher. GitHub release 자산은 정적 파일이라 조건부 GET·재시도 없이 단순 GET으로 충분하다. */
export function createMirrorFetcher(timeoutMs = 30_000): MirrorFetcher {
  return {
    async getJson(url: string): Promise<unknown> {
      const res = await fetchWithTimeout(url, timeoutMs);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
      return (await res.json()) as unknown;
    },
    async getBuffer(url: string): Promise<Buffer> {
      const res = await fetchWithTimeout(url, timeoutMs);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

function isManifest(data: unknown): data is MirrorManifest {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as MirrorManifest).files)
  );
}

/**
 * 미러에서 스냅샷 이력을 내려받아 로컬 DB에 병합한다(계약 14.3, B-007).
 * 파일 단위 오류(다운로드 실패·sha256 불일치·형식 오류)는 그 파일만 건너뛰고 계속한다.
 * 시딩 전체 실패는 예외로 던지며, 호출자(fetch --seed)가 격리한다.
 */
export async function seedFromMirror(
  db: DB,
  config: ResolvedConfig,
  fetcher: MirrorFetcher = createMirrorFetcher(),
): Promise<SeedResult> {
  const base = `https://github.com/${config.mirror.repo}/releases/download/${config.mirror.tag}`;
  const manifestData = await fetcher.getJson(`${base}/manifest.json`);
  if (!isManifest(manifestData)) {
    throw new Error('미러 manifest.json 형식을 해석할 수 없습니다.');
  }

  const result: SeedResult = {
    filesListed: manifestData.files.length,
    filesMerged: 0,
    filesFailed: 0,
    merged: { stories: 0, sightings: 0, snapshots: 0 },
  };

  for (const entry of manifestData.files) {
    try {
      const gz = await fetcher.getBuffer(`${base}/${entry.file}`);
      const digest = createHash('sha256').update(gz).digest('hex');
      if (digest !== entry.sha256) {
        throw new Error(`sha256 불일치 (기대 ${entry.sha256.slice(0, 12)}…)`);
      }
      const bucket = parseMirrorBucket(JSON.parse(gunzipSync(gz).toString('utf8')));
      if (bucket === null) throw new Error('버킷 형식 검증 실패');
      const counts = mergeMirrorBucket(db, bucket);
      result.merged.stories += counts.stories;
      result.merged.sightings += counts.sightings;
      result.merged.snapshots += counts.snapshots;
      result.filesMerged++;
    } catch (err) {
      result.filesFailed++;
      logger.warn(`미러 파일 병합 건너뜀: ${entry.file} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
