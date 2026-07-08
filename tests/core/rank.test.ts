import { describe, it, expect } from 'vitest';
import { computeHotness, interleaveBySource } from '../../src/core/rank.js';
import type { NewsItem, RankedItem } from '../../src/core/types.js';

const NOW = new Date('2026-07-09T00:00:00.000Z');

function mk(o: Partial<NewsItem> & { id: string }): NewsItem {
  return {
    id: o.id,
    source: o.source ?? 's1',
    type: o.type ?? 'community',
    title: o.title ?? 't',
    url: o.url ?? `https://ex.com/${o.id}`,
    canonicalUrl: o.canonicalUrl ?? `https://ex.com/${o.id}`,
    summary: null,
    author: null,
    score: o.score ?? null,
    commentsCount: null,
    tags: [],
    publishedAt: o.publishedAt ?? NOW.toISOString(),
    firstSeenAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    raw: null,
  };
}

describe('computeHotness', () => {
  it('같은 소스에서 높은 점수가 더 높은 hotness를 갖는다', () => {
    const ranked = computeHotness(
      [mk({ id: 'a', score: 10 }), mk({ id: 'b', score: 30 })],
      NOW,
    );
    const a = ranked.find((x) => x.id === 'a')!;
    const b = ranked.find((x) => x.id === 'b')!;
    expect(b.hotness).toBeGreaterThan(a.hotness);
    expect(ranked[0]!.id).toBe('b'); // 내림차순 정렬
  });

  it('점수가 없으면 백분위 0.6을 적용한다', () => {
    const ranked = computeHotness([mk({ id: 'p', score: null, type: 'community' })], NOW);
    // norm 0.6 × decay 1(방금) × typeBoost 1 = 0.6
    expect(ranked[0]!.hotness).toBeCloseTo(0.6, 3);
  });

  it('공식 업데이트는 타입 부스트(1.2)를 받는다', () => {
    const official = computeHotness([mk({ id: 'o', score: null, type: 'official_update' })], NOW);
    expect(official[0]!.hotness).toBeCloseTo(0.72, 3); // 0.6 × 1.2
  });

  it('오래된 항목은 시간 감쇠로 hotness가 낮아진다', () => {
    const old = mk({ id: 'old', score: null, publishedAt: '2026-07-06T00:00:00.000Z' }); // 72h 전
    const ranked = computeHotness([old], NOW);
    expect(ranked[0]!.hotness).toBeLessThan(0.6);
  });
});

describe('interleaveBySource', () => {
  it('상위에서 단일 소스 독점을 완화한다', () => {
    const ranked: RankedItem[] = [
      { ...mk({ id: 'a1', source: 'A' }), hotness: 0.9 },
      { ...mk({ id: 'a2', source: 'A' }), hotness: 0.8 },
      { ...mk({ id: 'a3', source: 'A' }), hotness: 0.7 },
      { ...mk({ id: 'b1', source: 'B' }), hotness: 0.6 },
    ];
    const picked = interleaveBySource(ranked, 3, 0.4); // cap = floor(3*0.4)=1
    // A는 cap 1까지 우선, 그 다음 B, 나머지는 deferred로 채움
    expect(picked[0]!.source).toBe('A');
    expect(picked[1]!.source).toBe('B');
    expect(picked).toHaveLength(3);
  });
});
