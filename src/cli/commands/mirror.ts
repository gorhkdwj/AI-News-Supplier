import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Command } from 'commander';
import { openDb } from '../../core/db/connection.js';
import { bucketFileStem, exportMirrorBucket, listMirrorBuckets } from '../../core/mirror/export.js';
import { printText } from '../format.js';
import { parsePositiveInt } from '../shared.js';

/** 게시 워크플로가 읽는 버킷별 산출 요약. */
interface ExportedFileSummary {
  file: string;
  bucketAt: string;
  sha256: string;
  stories: number;
  sightings: number;
  snapshots: number;
}

export function registerMirror(program: Command): void {
  const mirror = program
    .command('mirror')
    .description('스냅샷 미러 산출물을 관리합니다(게시 파이프라인 유지관리용)');

  mirror
    .command('export')
    .description('최근 관측을 시간 버킷별 mirror-*.json.gz로 내보냅니다')
    .option('--hours <n>', '내보낼 관측 범위(시간)', '2')
    .requiredOption('--out <dir>', '산출물을 쓸 디렉터리')
    .action((opts: { hours: string; out: string }) => {
      const hours = parsePositiveInt(opts.hours, 2);
      const now = new Date();
      const since = new Date(now.getTime() - hours * 3_600_000).toISOString();
      mkdirSync(opts.out, { recursive: true });

      const db = openDb();
      const summaries: ExportedFileSummary[] = [];
      try {
        for (const bucketAt of listMirrorBuckets(db, since)) {
          const data = exportMirrorBucket(db, bucketAt, now);
          const gz = gzipSync(Buffer.from(JSON.stringify(data), 'utf8'));
          const file = `${bucketFileStem(bucketAt)}.json.gz`;
          writeFileSync(join(opts.out, file), gz);
          summaries.push({
            file,
            bucketAt,
            sha256: createHash('sha256').update(gz).digest('hex'),
            stories: data.stories.length,
            sightings: data.sightings.length,
            snapshots: data.snapshots.length,
          });
        }
      } finally {
        db.close();
      }
      // 워크플로가 manifest를 만들 수 있도록 요약을 JSON으로 출력한다.
      printText(JSON.stringify(summaries, null, 2));
    });
}
