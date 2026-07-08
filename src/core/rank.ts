import type { ItemType, NewsItem, RankedItem } from './types.js';

const TYPE_BOOST: Record<ItemType, number> = {
  official_update: 1.2,
  hot_repo: 1.1,
  paper: 1.0,
  model: 1.0,
  community: 1.0,
  article: 1.0,
};

const HALF_LIFE_DIVISOR = 36; // decay = exp(-ageHours/36) → 반감기 약 25시간

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * 소스 내 점수 백분위 × 시간 감쇠 × 타입 부스트로 hotness를 계산한다.
 * 점수가 없는 항목(RSS/arXiv 등)은 백분위를 0.6 고정값으로 둔다. (요구사항 계약 문서)
 */
export function computeHotness(items: NewsItem[], now: Date): RankedItem[] {
  const bySource = new Map<string, NewsItem[]>();
  for (const it of items) {
    const list = bySource.get(it.source);
    if (list) list.push(it);
    else bySource.set(it.source, [it]);
  }

  // 소스별 점수 배열(정렬)로 백분위를 계산한다.
  const norms = new Map<string, number>();
  for (const [, group] of bySource) {
    const scores = group
      .map((i) => i.score)
      .filter((s): s is number => s != null)
      .sort((a, b) => a - b);
    for (const it of group) {
      if (it.score == null) {
        norms.set(it.id, 0.6);
        continue;
      }
      const leq = countLessOrEqual(scores, it.score);
      norms.set(it.id, scores.length > 0 ? leq / scores.length : 0.6);
    }
  }

  const nowMs = now.getTime();
  return items
    .map((it): RankedItem => {
      const norm = norms.get(it.id) ?? 0.6;
      const refTime = it.publishedAt ?? it.firstSeenAt;
      const ageHours = Math.max(0, (nowMs - Date.parse(refTime)) / 3_600_000);
      const decay = Math.exp(-ageHours / HALF_LIFE_DIVISOR);
      const hotness = round3(norm * decay * TYPE_BOOST[it.type]);
      return { ...it, hotness };
    })
    .sort((a, b) => b.hotness - a.hotness);
}

function countLessOrEqual(sortedAsc: number[], value: number): number {
  // 이진 탐색으로 value 이하 개수를 센다.
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sortedAsc[mid] as number) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 상위 결과에서 단일 소스 비중이 maxRatio를 넘지 않도록 인터리브한다.
 * hotness 순서는 최대한 유지하되, 초과분은 뒤로 미룬다.
 */
export function interleaveBySource(ranked: RankedItem[], limit: number, maxRatio: number): RankedItem[] {
  if (ranked.length <= limit) return ranked.slice(0, limit);
  const cap = Math.max(1, Math.floor(limit * maxRatio));
  const picked: RankedItem[] = [];
  const deferred: RankedItem[] = [];
  const perSource = new Map<string, number>();

  for (const it of ranked) {
    if (picked.length >= limit) break;
    const count = perSource.get(it.source) ?? 0;
    if (count < cap) {
      picked.push(it);
      perSource.set(it.source, count + 1);
    } else {
      deferred.push(it);
    }
  }
  for (const it of deferred) {
    if (picked.length >= limit) break;
    picked.push(it);
  }
  return picked.slice(0, limit);
}
