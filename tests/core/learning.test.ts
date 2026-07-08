import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type DB } from '../../src/core/db/connection.js';
import { upsertItems } from '../../src/core/store/itemStore.js';
import { recordLearning, findRecentLearning } from '../../src/core/store/learningStore.js';
import { extractTerms, normalizeTopic } from '../../src/core/learning/topics.js';
import { mineLearningCandidates } from '../../src/core/learning/candidates.js';
import { designLearningSession } from '../../src/core/learning/session.js';
import type { CollectedItem } from '../../src/core/types.js';

const NOW = new Date('2026-07-09T00:00:00.000Z');
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
    commentsCount: null,
    tags: o.tags ?? [],
    publishedAt: NOW_ISO,
    raw: {},
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
  it('증거 버킷과 record_learning 안내가 포함된 지시문을 만든다', () => {
    const db = openDb(':memory:');
    upsertItems(
      db,
      [
        item({ source: 'rss:openai', url: 'https://e.com/t1', title: 'Transformer architecture explained', type: 'official_update' }),
        item({ source: 'arxiv', url: 'https://e.com/t2', title: 'Efficient Transformer training', type: 'paper' }),
      ],
      NOW_ISO,
    );
    const session = designLearningSession(db, { topic: 'transformer', level: 'beginner', timeBudgetMinutes: 30 });
    expect(session.instructions).toContain('transformer');
    expect(session.instructions).toContain('record_learning');
    expect(session.instructions).toContain('30분');
    expect(session.context.official.length + session.context.papers.length).toBeGreaterThanOrEqual(1);
  });
});
