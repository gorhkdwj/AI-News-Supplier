import type { DB } from '../db/connection.js';
import type { NewsItem } from '../types.js';
import { searchItems } from '../store/itemStore.js';
import type { LearningLevel } from '../store/learningStore.js';
import { bucketEvidence, type EvidenceBuckets } from './candidates.js';

export interface LearningSession {
  topic: string;
  context: EvidenceBuckets;
  instructions: string;
}

export interface SessionOptions {
  topic: string;
  level?: LearningLevel;
  timeBudgetMinutes?: number;
  sinceDays?: number;
}

const LEVEL_GUIDE: Record<LearningLevel, string> = {
  beginner: '기초 개념부터 시작하고 전문용어는 쉬운 비유로 풀어서 설명하십시오.',
  intermediate: '핵심 원리와 실무 적용에 초점을 맞추고, 이미 아는 기초는 빠르게 넘어가십시오.',
  advanced: '심화 트레이드오프, 한계, 최신 연구 맥락까지 깊이 다루십시오.',
};

function linkList(items: NewsItem[]): string {
  if (items.length === 0) return '  (없음)';
  return items.map((i) => `  - ${i.title} — ${i.url}`).join('\n');
}

function renderInstructions(
  topic: string,
  level: LearningLevel,
  timeBudget: number,
  ctx: EvidenceBuckets,
): string {
  return [
    `당신은 학습자가 "${topic}"을(를) 배우도록 돕는 튜터입니다. ${LEVEL_GUIDE[level]}`,
    `총 학습 시간은 약 ${timeBudget}분입니다. 아래 근거 자료만 사용하고, 각 주장에는 출처 URL을 붙이십시오.`,
    '',
    '다음 순서로 학습 세션을 구성해 진행하십시오:',
    `1) 5분 브리핑: "${topic}"이 무엇이고 지금 왜 화제인지 요약`,
    '2) 핵심 개념: 학습자 수준에 맞춰 개념 3~5개를 설명(공식 자료·논문 근거 활용)',
    '3) 실습: 핫레포/모델 중 하나를 골라 따라 할 수 있는 실습 단계 제시',
    '4) 이해 점검: 학습자에게 던질 확인 질문 3개',
    '5) 더 읽을거리: 아래 자료에서 우선순위가 높은 항목 추천',
    '6) 마무리: 학습이 끝나면 record_learning 도구로 이 토픽을 기록하도록 안내',
    '',
    '=== 근거 자료 ===',
    '[공식 업데이트]',
    linkList(ctx.official),
    '[논문]',
    linkList(ctx.papers),
    '[핫레포/모델]',
    linkList(ctx.repos),
    '[커뮤니티/기타]',
    linkList(ctx.discussion),
  ].join('\n');
}

/** 특정 토픽의 맥락 자료를 모으고, 에이전트가 학습 세션을 설계하도록 지시문을 조립한다. */
export function designLearningSession(db: DB, opts: SessionOptions): LearningSession {
  const level = opts.level ?? 'intermediate';
  const timeBudget = opts.timeBudgetMinutes ?? 45;
  const items = searchItems(db, opts.topic, { sinceDays: opts.sinceDays ?? 30, limit: 40 });
  const context = bucketEvidence(items);
  return {
    topic: opts.topic,
    context,
    instructions: renderInstructions(opts.topic, level, timeBudget, context),
  };
}
