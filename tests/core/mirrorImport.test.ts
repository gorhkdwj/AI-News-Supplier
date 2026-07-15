import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { openDb, type DB } from '../../src/core/db/connection.js';
import type { ResolvedConfig } from '../../src/core/config.js';
import {
  bucketFileStem,
  exportMirrorBucket,
  listMirrorBuckets,
  type MirrorBucketExport,
} from '../../src/core/mirror/export.js';
import { mergeMirrorBucket, parseMirrorBucket } from '../../src/core/mirror/import.js';
import { seedFromMirror, type MirrorFetcher } from '../../src/core/mirror/seed.js';
import { upsertSightings, getNearestBaseline } from '../../src/core/store/sightingStore.js';
import { sightingId } from '../../src/core/normalize.js';
import type { LiveSightingInput } from '../../src/core/types.js';

const HOUR = 3_600_000;
const NOW = new Date('2026-07-12T09:30:00.000Z');
const openDbs: DB[] = [];

function db(): DB {
  const connection = openDb(':memory:');
  openDbs.push(connection);
  return connection;
}

afterEach(() => {
  while (openDbs.length > 0) openDbs.pop()?.close();
});

function hnObservation(score: number): LiveSightingInput {
  return {
    source: 'hackernews',
    sourceKey: 'hn-story-1',
    type: 'community',
    title: 'Mirror seeded story',
    url: 'https://example.com/mirror-story',
    discussionUrl: 'https://news.ycombinator.com/item?id=1',
    summary: null,
    author: null,
    score,
    scoreKind: 'points',
    commentsCount: 3,
    tags: ['ai'],
    publishedAt: '2026-07-12T05:00:00.000Z',
    publishedPrecision: 'exact_time',
    activityAt: null,
    raw: { objectID: '1' },
  };
}

/** 관측 3회(3개 시간 버킷)가 쌓인 원본 DB에서 미러 버킷들을 내보낸다. */
function exportedBuckets(): MirrorBucketExport[] {
  const source = db();
  for (const [hoursAgo, score] of [
    [25, 100],
    [1, 150],
    [0, 180],
  ] as const) {
    upsertSightings(
      source,
      [hnObservation(score)],
      new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(),
    );
  }
  return listMirrorBuckets(source, '2026-07-01T00:00:00.000Z').map((bucketAt) =>
    exportMirrorBucket(source, bucketAt, NOW),
  );
}

describe('mergeMirrorBucket (계약 14.3, B-007)', () => {
  it('빈 DB에 export 왕복 병합 시 Story·Sighting·스냅샷과 성장 기준점이 복원된다', () => {
    const buckets = exportedBuckets();
    expect(buckets.length).toBe(3);

    const target = db();
    let stories = 0;
    let snapshots = 0;
    for (const bucket of buckets) {
      const counts = mergeMirrorBucket(target, bucket);
      stories += counts.stories;
      snapshots += counts.snapshots;
    }
    expect(stories).toBe(1);
    expect(snapshots).toBe(3);

    const id = sightingId('hackernews', 'hn-story-1');
    const sighting = target
      .prepare('SELECT quality, is_primary, raw FROM source_sightings WHERE id = ?')
      .get(id) as { quality: string; is_primary: number; raw: string | null };
    expect(sighting.quality).toBe('live'); // 랭킹 자격 유지가 시딩의 목적
    expect(sighting.is_primary).toBe(1);
    expect(sighting.raw).toBeNull(); // 미러는 raw를 배포하지 않는다

    // 시딩의 존재 이유: 24h 성장 기준점이 즉시 조회 가능해야 한다
    const baseline = getNearestBaseline(target, id, NOW.toISOString(), '24h');
    expect(baseline?.score).toBe(100);
  });

  it('같은 버킷을 다시 병합해도 행이 늘지 않는다(멱등)', () => {
    const buckets = exportedBuckets();
    const target = db();
    for (const bucket of buckets) mergeMirrorBucket(target, bucket);
    const again = buckets.map((bucket) => mergeMirrorBucket(target, bucket));
    expect(again.every((c) => c.stories === 0 && c.sightings === 0 && c.snapshots === 0)).toBe(
      true,
    );
    const count = target
      .prepare('SELECT COUNT(*) AS c FROM metric_snapshots')
      .get() as { c: number };
    expect(count.c).toBe(3);
  });

  it('로컬에 이미 있는 Sighting은 내용을 유지하고 관측 시각 범위만 넓힌다(로컬 우선)', () => {
    const buckets = exportedBuckets();
    const target = db();
    // 로컬이 같은 Story를 더 최근에 관측했고 제목이 다른 상황
    upsertSightings(
      target,
      [{ ...hnObservation(200), title: 'Local fresher title' }],
      NOW.toISOString(),
    );
    for (const bucket of buckets) mergeMirrorBucket(target, bucket);

    const row = target
      .prepare('SELECT title, score, first_seen_at FROM source_sightings WHERE id = ?')
      .get(sightingId('hackernews', 'hn-story-1')) as {
      title: string;
      score: number;
      first_seen_at: string;
    };
    expect(row.title).toBe('Local fresher title');
    expect(row.score).toBe(200);
    // 미러의 더 이른 first_seen(25시간 전 관측)으로 확장된다
    expect(row.first_seen_at).toBe(new Date(NOW.getTime() - 25 * HOUR).toISOString());
    // 미러의 과거 스냅샷은 로컬 관측과 나란히 축적된다
    const count = target
      .prepare('SELECT COUNT(*) AS c FROM metric_snapshots')
      .get() as { c: number };
    expect(count.c).toBe(3); // 09시 버킷은 로컬 관측과 같은 버킷 → 3개 유지
  });

  it('parseMirrorBucket은 formatVersion 불일치를 거부한다', () => {
    expect(parseMirrorBucket({ formatVersion: 999, bucketAt: 'x', stories: [], sightings: [], snapshots: [] })).toBeNull();
    expect(parseMirrorBucket(null)).toBeNull();
  });
});

describe('seedFromMirror (계약 14.3, B-007)', () => {
  function sha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  function fakeMirror(buckets: MirrorBucketExport[], corruptFirst = false): MirrorFetcher {
    const assets = buckets.map((bucket, index) => {
      const gz = gzipSync(Buffer.from(JSON.stringify(bucket), 'utf8'));
      return {
        file: `${bucketFileStem(bucket.bucketAt)}.json.gz`,
        bucketAt: bucket.bucketAt,
        sha256: corruptFirst && index === 0 ? '0'.repeat(64) : sha256(gz),
        gz,
      };
    });
    return {
      getJson: (url: string) => {
        expect(url).toBe(
          'https://github.com/acme/fork/releases/download/mirror-data/manifest.json',
        );
        return Promise.resolve({
          formatVersion: 1,
          files: assets.map(({ file, bucketAt, sha256: digest }) => ({
            file,
            bucketAt,
            sha256: digest,
          })),
        });
      },
      getBuffer: (url: string) => {
        const asset = assets.find((a) => url.endsWith(`/${a.file}`));
        if (!asset) return Promise.reject(new Error(`unexpected url: ${url}`));
        return Promise.resolve(asset.gz);
      },
    };
  }

  const config = { mirror: { repo: 'acme/fork', tag: 'mirror-data' } } as ResolvedConfig;

  it('manifest의 파일들을 내려받아 검증·병합하고 설정된 미러 주소를 쓴다', async () => {
    const buckets = exportedBuckets();
    const target = db();
    const result = await seedFromMirror(target, config, fakeMirror(buckets));
    expect(result).toMatchObject({ filesListed: 3, filesMerged: 3, filesFailed: 0 });
    expect(result.merged.snapshots).toBe(3);
  });

  it('sha256이 불일치하는 파일만 건너뛰고 나머지는 병합한다', async () => {
    const buckets = exportedBuckets();
    const target = db();
    const result = await seedFromMirror(target, config, fakeMirror(buckets, true));
    expect(result).toMatchObject({ filesListed: 3, filesMerged: 2, filesFailed: 1 });
  });
});
