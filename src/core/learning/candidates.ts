import type { DB } from '../db/connection.js';
import type { NewsItem, RankedItem } from '../types.js';
import { queryRecent, getScoreHistory } from '../store/itemStore.js';
import { findRecentLearning } from '../store/learningStore.js';
import { computeHotness } from '../rank.js';
import { extractTerms } from './topics.js';

export interface EvidenceBuckets {
  official: NewsItem[];
  papers: NewsItem[];
  repos: NewsItem[];
  discussion: NewsItem[];
}

export interface LearningCandidate {
  topic: string;
  normalizedTopic: string;
  learnScore: number;
  signals: { sourceSpread: number; velocity: number; itemCount: number; hotSum: number };
  why: string;
  evidence: EvidenceBuckets;
}

export interface MineOptions {
  sinceDays?: number;
  limit?: number;
  includeLearned?: boolean;
  relearnAfterDays?: number;
  now?: Date;
}

interface Cluster {
  normalized: string;
  display: string;
  items: RankedItem[];
  ids: Set<string>;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** 항목의 24시간 대비 점수 상승률(velocity)을 계산한다. 이력이 부족하면 0. */
function itemVelocity(db: DB, item: NewsItem, now: Date): number {
  if (item.score == null) return 0;
  const hist = getScoreHistory(db, item.id);
  if (hist.length < 2) return 0;
  const dayAgoMs = now.getTime() - 86_400_000;
  let prevScore: number | null = null;
  for (const snap of hist) {
    if (Date.parse(snap.observedAt) <= dayAgoMs) prevScore = snap.score;
  }
  if (prevScore == null) prevScore = hist[0]!.score;
  const base = Math.max(prevScore ?? 0, 1);
  return clamp((item.score - (prevScore ?? 0)) / base, 0, 2);
}

export function bucketEvidence(items: NewsItem[]): EvidenceBuckets {
  const buckets: EvidenceBuckets = { official: [], papers: [], repos: [], discussion: [] };
  for (const it of items) {
    if (it.type === 'official_update') buckets.official.push(it);
    else if (it.type === 'paper') buckets.papers.push(it);
    else if (it.type === 'hot_repo' || it.type === 'model') buckets.repos.push(it);
    else buckets.discussion.push(it);
  }
  return buckets;
}

/** 아이템 집합 겹침(작은 쪽 기준)이 threshold 이상인 클러스터를 병합한다. */
function mergeClusters(clusters: Cluster[], threshold: number): Cluster[] {
  const sorted = [...clusters].sort((a, b) => b.items.length - a.items.length);
  const merged: Cluster[] = [];
  for (const c of sorted) {
    let absorbed = false;
    for (const m of merged) {
      let overlap = 0;
      for (const id of c.ids) if (m.ids.has(id)) overlap++;
      const minSize = Math.min(c.ids.size, m.ids.size);
      if (minSize > 0 && overlap / minSize >= threshold) {
        for (const it of c.items) {
          if (!m.ids.has(it.id)) {
            m.items.push(it);
            m.ids.add(it.id);
          }
        }
        absorbed = true;
        break;
      }
    }
    if (!absorbed) merged.push({ ...c, items: [...c.items], ids: new Set(c.ids) });
  }
  return merged;
}

/**
 * 최근 항목에서 학습 가치가 높은 토픽 클러스터를 발굴한다.
 * learnScore = novelty × (2×sourceSpread + hotSum + velocity + ln(1+itemCount))
 */
export function mineLearningCandidates(db: DB, opts: MineOptions = {}): LearningCandidate[] {
  const now = opts.now ?? new Date();
  const sinceDays = opts.sinceDays ?? 7;
  const limit = opts.limit ?? 5;
  const includeLearned = opts.includeLearned ?? false;
  const relearnAfterDays = opts.relearnAfterDays ?? 90;

  const items = queryRecent(db, { sinceHours: sinceDays * 24, limit: 1000 });
  const ranked = computeHotness(items, now);

  // 용어별 클러스터 구성
  const clusters = new Map<string, Cluster>();
  for (const item of ranked) {
    for (const term of extractTerms(item.title, item.tags)) {
      let cluster = clusters.get(term.normalized);
      if (!cluster) {
        cluster = { normalized: term.normalized, display: term.display, items: [], ids: new Set() };
        clusters.set(term.normalized, cluster);
      }
      if (!cluster.ids.has(item.id)) {
        cluster.items.push(item);
        cluster.ids.add(item.id);
      }
    }
  }

  const merged = mergeClusters([...clusters.values()], 0.6);

  const candidates: LearningCandidate[] = [];
  for (const cluster of merged) {
    const sources = new Set(cluster.items.map((i) => i.source));
    const sourceSpread = sources.size;
    const itemCount = cluster.items.length;

    // 채택 필터
    if (!(sourceSpread >= 2 || (itemCount >= 3 && avgVelocity(db, cluster.items, now) > 0.5))) {
      continue;
    }

    const velocity = round3(avgVelocity(db, cluster.items, now));
    const topFive = [...cluster.items].sort((a, b) => b.hotness - a.hotness).slice(0, 5);
    const hotSum = round3(topFive.reduce((s, i) => s + i.hotness, 0));

    const recent = findRecentLearning(db, cluster.normalized);
    let novelty = 1.0;
    if (recent) {
      const daysSince = (now.getTime() - Date.parse(recent.learnedAt)) / 86_400_000;
      novelty = daysSince <= relearnAfterDays ? 0.15 : 0.5;
    }
    if (!includeLearned && novelty === 0.15) continue;

    const learnScore = round3(
      novelty * (2 * sourceSpread + hotSum + velocity + Math.log(1 + itemCount)),
    );

    const whyParts = [`${sourceSpread}개 소스에서 등장`, `항목 ${itemCount}개`];
    if (velocity > 0.5) whyParts.push('최근 화제 급상승');
    if (novelty < 1) whyParts.push('과거 학습 이력 있음(복습)');

    candidates.push({
      topic: cluster.display,
      normalizedTopic: cluster.normalized,
      learnScore,
      signals: { sourceSpread, velocity, itemCount, hotSum },
      why: whyParts.join(' · '),
      evidence: bucketEvidence(topFive),
    });
  }

  return candidates.sort((a, b) => b.learnScore - a.learnScore).slice(0, limit);
}

function avgVelocity(db: DB, items: NewsItem[], now: Date): number {
  const scored = items.filter((i) => i.score != null);
  if (scored.length === 0) return 0;
  const sum = scored.reduce((s, i) => s + itemVelocity(db, i, now), 0);
  return sum / scored.length;
}
