// 미러 manifest 병합 도구 (게시 워크플로 전용, 기준 계약 14.2절)
// 사용: node tools/mirror-manifest.mjs <old-manifest.json> <export-summary.json> <cutoff(YYYY-MM-DDTHH)> <out-manifest.json>
// - old manifest 파일이 없으면 빈 목록에서 시작한다.
// - 새 summary 항목이 같은 파일명을 대체한다(시간 버킷 재내보내기 대응).
// - cutoff보다 오래된 항목은 manifest에서 제거하고, 그 자산 이름을 stdout에 한 줄씩 출력한다(삭제 대상).
import { readFileSync, writeFileSync } from 'node:fs';

const [oldPath, summaryPath, cutoff, outPath] = process.argv.slice(2);
if (!oldPath || !summaryPath || !cutoff || !outPath) {
  console.error('사용법: node tools/mirror-manifest.mjs <old> <summary> <cutoff> <out>');
  process.exit(1);
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const old = readJson(oldPath, { files: [] });
const summary = readJson(summaryPath, []);

const byFile = new Map();
for (const entry of Array.isArray(old.files) ? old.files : []) byFile.set(entry.file, entry);
for (const entry of summary) byFile.set(entry.file, entry); // 새 내보내기가 우선

const kept = [];
const pruned = [];
for (const entry of byFile.values()) {
  // bucketAt(ISO)의 앞 13자(YYYY-MM-DDTHH)를 cutoff와 사전순 비교한다.
  if (entry.bucketAt.slice(0, 13) < cutoff) pruned.push(entry.file);
  else kept.push(entry);
}
kept.sort((a, b) => (a.bucketAt < b.bucketAt ? -1 : 1));

writeFileSync(
  outPath,
  JSON.stringify({ formatVersion: 1, updatedAt: new Date().toISOString(), files: kept }, null, 2) +
    '\n',
  'utf8',
);
for (const file of pruned) console.log(file);
