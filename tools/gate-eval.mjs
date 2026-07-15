// 계약 13절 승인 게이트 지표 실측 (읽기 전용). 사용: node tools/gate-eval.mjs
// 자동 측정 항목: Repo 24h/7d 기준점 coverage, Community 점수 가용성.
// 수동 항목(precision@20 라벨링, top20 full coverage 검수)은 trends 출력으로 별도 수행한다.
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

const db = new Database(join(homedir(), '.ai-news-supplier', 'data.db'), { readonly: true });
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');

const span = db
  .prepare(
    'SELECT MIN(bucket_at) AS first, MAX(bucket_at) AS last, COUNT(*) AS n FROM metric_snapshots',
  )
  .get();
console.log('== 수집 이력 ==');
console.log(`metric snapshots: ${span.n}개, ${span.first} ~ ${span.last}`);

// 추적 Repo: live · stars>=100 · 최근 14일 push (계약 6.1 자격에서 기준점 항목 제외)
const repos = db
  .prepare(
    `SELECT id, first_seen_at FROM source_sightings
     WHERE source='github' AND type='hot_repo' AND quality='live'
       AND score >= 100 AND activity_at >= ?`,
  )
  .all(iso(now - 14 * 86_400_000));
const has = db.prepare(
  'SELECT 1 FROM metric_snapshots WHERE sighting_id = ? AND bucket_at BETWEEN ? AND ? LIMIT 1',
);
// 관측 시작이 늦어 구조적으로 기준점이 있을 수 없는 sighting은 분모에서 제외한다.
let e24 = 0, c24 = 0, e7 = 0, c7 = 0;
for (const r of repos) {
  const firstSeen = Date.parse(r.first_seen_at);
  if (firstSeen <= now - 20 * 3_600_000) {
    e24++;
    if (has.get(r.id, iso(now - 28 * 3_600_000), iso(now - 20 * 3_600_000))) c24++;
  }
  if (firstSeen <= now - (7 * 24 - 12) * 3_600_000) {
    e7++;
    if (
      has.get(
        r.id,
        iso(now - 7 * 86_400_000 - 12 * 3_600_000),
        iso(now - 7 * 86_400_000 + 12 * 3_600_000),
      )
    )
      c7++;
  }
}
console.log('\n== 게이트: Repo 기준점 coverage ==');
console.log(`추적 대상 repo sighting: ${repos.length}개`);
console.log(`24h 기준점: ${c24}/${e24} (${pct(c24, e24)}) — 기준 95% [24h 이상 관측된 대상 기준]`);
console.log(`7d 기준점: ${c7}/${e7} (${pct(c7, e7)}) — 기준 90% [7일 이상 관측된 대상 기준]`);

const comm = db
  .prepare(
    `SELECT score FROM source_sightings
     WHERE quality='live'
       AND ((source IN ('hackernews','reddit') AND type='community')
         OR (source='devto' AND type IN ('community','article')))
       AND COALESCE(published_at, first_seen_at) >= ?`,
  )
  .all(iso(now - 72 * 3_600_000));
const withScore = comm.filter((r) => r.score !== null).length;
console.log('\n== 게이트: Community 점수 가용성 ==');
console.log(
  `72h 활성 community sighting: ${comm.length}개 · score 보유 ${withScore} (${pct(withScore, comm.length)}) — 기준 90%`,
);
db.close();
