import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type DB } from '../../src/core/db/connection.js';
import { upsertItems } from '../../src/core/store/itemStore.js';
import { recordLearning, findRecentLearning } from '../../src/core/store/learningStore.js';
import { extractTerms, normalizeTopic } from '../../src/core/learning/topics.js';
import { mineLearningCandidates } from '../../src/core/learning/candidates.js';
import { SessionInputError, designLearningSession } from '../../src/core/learning/session.js';
import { itemId } from '../../src/core/normalize.js';
import type { CollectedItem } from '../../src/core/types.js';

// searchItems가 실제 시계로 조회 윈도를 계산하므로 fixture 시각은 상대값이어야 한다 (T-013)
const NOW = new Date(Date.now() - 3_600_000);
const NOW_ISO = NOW.toISOString();

function item(o: Partial<CollectedItem> & { source: string; url: string; title: string }): CollectedItem {
  return {
    source: o.source,
    type: o.type ?? 'community',
    title: o.title,
    url: o.url,
    summary: o.summary ?? null,
    author: null,
    score: o.score ?? null,
    commentsCount: o.commentsCount ?? null,
    tags: o.tags ?? [],
    publishedAt: NOW_ISO,
    raw: o.raw ?? {},
  };
}

describe('extractTerms', () => {
  it('별칭을 적용하고 블록리스트/버전형을 처리한다', () => {
    const terms = extractTerms('New Mixture of Experts model beats GPT-5', ['ai', 'llm', 'reasoning']);
    const norms = terms.map((t) => t.normalized);
    expect(norms).toContain('moe'); // mixture of experts → moe (별칭)
    expect(norms).toContain('gpt-5'); // 버전형
    expect(norms).toContain('reasoning'); // 태그(엔티티)
    expect(norms).not.toContain('ai'); // 블록리스트
    expect(norms).not.toContain('llm'); // 블록리스트
  });

  it('normalizeTopic이 별칭을 정규화한다', () => {
    expect(normalizeTopic('Model Context Protocol')).toBe('mcp');
  });
});

describe('mineLearningCandidates', () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(':memory:');
    upsertItems(
      db,
      [
        item({ source: 'hackernews', url: 'https://e.com/1', title: 'Understanding Mixture of Experts in LLMs', score: 100 }),
        item({ source: 'github', url: 'https://e.com/2', title: 'moe-lib: efficient Mixture of Experts', type: 'hot_repo', score: 200 }),
        item({ source: 'arxiv', url: 'https://e.com/3', title: 'Scaling Mixture of Experts', type: 'paper' }),
        item({ source: 'devto', url: 'https://e.com/4', title: 'A totally unrelated cooking post', score: 5 }),
      ],
      NOW_ISO,
    );
  });

  it('여러 소스에 걸친 토픽을 최상위 후보로 발굴한다', () => {
    const candidates = mineLearningCandidates(db, { now: NOW, sinceDays: 7, limit: 5 });
    const moe = candidates.find((c) => c.normalizedTopic === 'moe');
    expect(moe).toBeDefined();
    expect(moe!.signals.sourceSpread).toBe(3);
    expect(candidates[0]!.normalizedTopic).toBe('moe'); // 최상위
    // 증거 버킷 분류
    expect(moe!.evidence.papers.length).toBeGreaterThanOrEqual(1);
    expect(moe!.evidence.repos.length).toBeGreaterThanOrEqual(1);
  });

  it('학습 기록 후 includeLearned=false면 후보에서 제외한다', () => {
    recordLearning(db, { topic: 'moe', now: NOW_ISO });
    expect(findRecentLearning(db, 'moe')).not.toBeNull();
    const candidates = mineLearningCandidates(db, { now: NOW, includeLearned: false });
    expect(candidates.find((c) => c.normalizedTopic === 'moe')).toBeUndefined();
  });

  it('includeLearned=true면 학습한 토픽도 포함한다', () => {
    recordLearning(db, { topic: 'moe', now: NOW_ISO });
    const candidates = mineLearningCandidates(db, { now: NOW, includeLearned: true });
    expect(candidates.find((c) => c.normalizedTopic === 'moe')).toBeDefined();
  });
});

describe('designLearningSession', () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(':memory:');
    upsertItems(
      db,
      [
        item({ source: 'rss:openai', url: 'https://e.com/t1', title: 'Transformer architecture explained', type: 'official_update' }),
        item({ source: 'arxiv', url: 'https://e.com/t2', title: 'Efficient Transformer training', type: 'paper' }),
      ],
      NOW_ISO,
    );
  });

  it('증거 버킷과 record_learning 안내가 포함된 지시문을 만든다', () => {
    const session = designLearningSession(db, { topic: 'transformer', level: 'beginner', timeBudgetMinutes: 30 });
    expect(session.instructions).toContain('transformer');
    expect(session.instructions).toContain('record_learning');
    expect(session.instructions).toContain('30분');
    expect(session.context.official.length + session.context.papers.length).toBeGreaterThanOrEqual(1);
    expect(session.search).toEqual({ mode: 'exact', matched: 2 });
  });

  it('전체 일치 0건이면 단어별(OR) 일치로 완화하고 완화 안내를 붙인다', () => {
    // 'transformer'와 'quantization'이 한 항목에 같이 없음 → AND 0건, OR로 transformer 자료 매칭
    const session = designLearningSession(db, { topic: 'transformer quantization' });
    expect(session.search.mode).toBe('relaxed');
    expect(session.search.matched).toBeGreaterThanOrEqual(1);
    expect(session.instructions).toContain('완화 검색');
    expect(session.context.papers.length + session.context.official.length).toBeGreaterThanOrEqual(1);
  });

  it('완화 후에도 0건이면 mode=none과 영어 키워드 재시도 안내를 반환한다', () => {
    const session = designLearningSession(db, { topic: '에이전트 평가 방법론' });
    expect(session.search).toEqual({ mode: 'none', matched: 0 });
    expect(session.instructions).toContain('검색된 자료가 없습니다');
    expect(session.instructions).toContain('영어 키워드');
    expect(session.context.official).toHaveLength(0);
    expect(session.context.papers).toHaveLength(0);
  });

  it('근거 자료에 토론 URL·점수·댓글 수를 병기한다 (계약 11.2, B-001)', () => {
    // HN 항목은 raw.objectID로 Sighting에 discussion_url이 채워진다
    upsertItems(
      db,
      [
        item({
          source: 'hackernews',
          url: 'https://e.com/t3',
          title: 'Transformer inference tricks',
          score: 120,
          commentsCount: 34,
          raw: { objectID: '999' },
        }),
      ],
      NOW_ISO,
    );
    const session = designLearningSession(db, { topic: 'transformer' });
    expect(session.instructions).toContain('토론: https://news.ycombinator.com/item?id=999');
    expect(session.instructions).toContain('점수 120');
    expect(session.instructions).toContain('댓글 34');
  });

  it('원문 차단·근거 부족 대응 규칙을 지시문에 항상 포함한다 (계약 11.2, B-001)', () => {
    const session = designLearningSession(db, { topic: 'transformer' });
    expect(session.instructions).toContain('2차 자료');
    expect(session.instructions).toContain('지어내지 마십시오');
  });

  it('핫레포/모델 버킷이 비면 실습 지시문을 근거 재현형으로 대체한다 (계약 11.2, B-002)', () => {
    const session = designLearningSession(db, { topic: 'transformer' });
    expect(session.context.repos).toHaveLength(0);
    expect(session.instructions).toContain('핫레포/모델 자료가 없으므로');
    expect(session.instructions).not.toContain('핫레포/모델 중 하나를 골라');
  });

  it('핫레포/모델 버킷이 있으면 기존 실습 지시문을 유지한다 (계약 11.2, B-002)', () => {
    upsertItems(
      db,
      [
        item({
          source: 'github',
          url: 'https://e.com/t4',
          title: 'transformer-toolkit: fast attention kernels',
          type: 'hot_repo',
          score: 300,
        }),
      ],
      NOW_ISO,
    );
    const session = designLearningSession(db, { topic: 'transformer' });
    expect(session.context.repos.length).toBeGreaterThanOrEqual(1);
    expect(session.instructions).toContain('핫레포/모델 중 하나를 골라');
    expect(session.instructions).not.toContain('핫레포/모델 자료가 없으므로');
  });

  it('topic과 fromItemId를 함께 주거나 둘 다 없으면 입력 오류다 (계약 11.3, B-005)', () => {
    const id = itemId('https://e.com/t1');
    expect(() => designLearningSession(db, { topic: 'transformer', fromItemId: id })).toThrow(
      SessionInputError,
    );
    expect(() => designLearningSession(db, {})).toThrow(SessionInputError);
  });

  it('존재하지 않는 항목 ID는 입력 오류로 처리한다 (계약 11.3, B-005)', () => {
    expect(() => designLearningSession(db, { fromItemId: 'ffffffffffffffff' })).toThrow(
      SessionInputError,
    );
    expect(() => designLearningSession(db, { fromItemId: 'ffffffffffffffff' })).toThrow(
      /ffffffffffffffff/,
    );
  });

  it('fromItemId는 제목을 토픽으로 쓰고 출발 항목을 근거 맨 앞에 한 번만 포함한다 (계약 11.3, B-005)', () => {
    const anchorId = itemId('https://e.com/t1');
    const session = designLearningSession(db, { fromItemId: anchorId });
    expect(session.topic).toBe('Transformer architecture explained');
    expect(session.fromItem).toEqual({
      id: anchorId,
      title: 'Transformer architecture explained',
      url: 'https://e.com/t1',
    });
    expect(session.instructions).toContain('에서 출발했습니다');
    // 검색 결과에 자기 자신이 잡혀도(FTS에 존재) 앵커는 중복 없이 버킷 맨 앞 한 번
    expect(session.context.official[0]!.id).toBe(anchorId);
    expect(session.context.official.filter((i) => i.id === anchorId)).toHaveLength(1);
    expect(session.search.mode).toBe('exact');
    expect(session.search.matched).toBeGreaterThanOrEqual(1);
  });

  it('조회 윈도 밖의 출발 항목은 검색 0건이어도 세션이 성립하고 보강 안내를 붙인다 (계약 11.3, B-005)', () => {
    const OLD_ISO = new Date(Date.now() - 40 * 86_400_000).toISOString();
    upsertItems(
      db,
      [
        {
          ...item({
            source: 'rss:openai',
            url: 'https://e.com/old1',
            title: 'Ancient quantum widget verifier',
            type: 'official_update',
          }),
          publishedAt: OLD_ISO,
        },
      ],
      NOW_ISO,
    );
    const anchorId = itemId('https://e.com/old1');
    const session = designLearningSession(db, { fromItemId: anchorId });
    expect(session.search).toEqual({ mode: 'none', matched: 0 });
    expect(session.instructions).toContain('추가 자료가 검색되지 않았습니다');
    expect(session.instructions).not.toContain('검색된 자료가 없습니다');
    expect(session.context.official[0]!.id).toBe(anchorId);
  });
});
