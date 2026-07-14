import type { DB } from '../db/connection.js';
import type { NewsItem } from '../types.js';
import { searchItems } from '../store/itemStore.js';
import type { LearningLevel } from '../store/learningStore.js';
import { bucketEvidence, type EvidenceBuckets } from './candidates.js';

/** exact: 전체 일치 / relaxed: 단어별(OR) 완화 일치 / none: 완화 후에도 0건 */
export type SessionSearchMode = 'exact' | 'relaxed' | 'none';

export interface SessionSearchInfo {
  mode: SessionSearchMode;
  matched: number;
}

export interface LearningSession {
  topic: string;
  context: EvidenceBuckets;
  instructions: string;
  search: SessionSearchInfo;
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

function searchNotice(topic: string, search: SessionSearchInfo, sinceDays: number): string[] {
  if (search.mode === 'none') {
    return [
      `[안내] 최근 ${sinceDays}일 수집 데이터에서 "${topic}"(으)로 검색된 자료가 없습니다(전체 일치·단어별 일치 모두 0건).`,
      '수집 데이터가 대부분 영어이므로, topic을 영어 키워드 1~2개(예: "agent evaluation")로 바꿔 이 도구를 다시 호출하십시오.',
      '근거 자료 없이 일반 지식만으로 학습 세션을 진행하지 마십시오.',
      '',
    ];
  }
  if (search.mode === 'relaxed') {
    return [
      '[안내] 토픽 전체 일치 자료가 없어 단어별(OR) 일치로 완화 검색한 결과입니다. 토픽과 직접 관련된 자료만 선별해 사용하십시오.',
      '',
    ];
  }
  return [];
}

function renderInstructions(
  topic: string,
  level: LearningLevel,
  timeBudget: number,
  ctx: EvidenceBuckets,
  search: SessionSearchInfo,
  sinceDays: number,
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
    ...searchNotice(topic, search, sinceDays),
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

/**
 * 특정 토픽의 맥락 자료를 모으고, 에이전트가 학습 세션을 설계하도록 지시문을 조립한다.
 * 자료 검색은 전체 일치(AND) → 0건이면 단어별(OR) 완화 순서로 시도하고,
 * 그래도 0건이면 사유와 재시도 안내를 지시문에 명시한다(계약 11.1, T-012).
 */
export function designLearningSession(db: DB, opts: SessionOptions): LearningSession {
  const level = opts.level ?? 'intermediate';
  const timeBudget = opts.timeBudgetMinutes ?? 45;
  const sinceDays = opts.sinceDays ?? 30;
  let mode: SessionSearchMode = 'exact';
  let items = searchItems(db, opts.topic, { sinceDays, limit: 40 });
  if (items.length === 0) {
    items = searchItems(db, opts.topic, { sinceDays, limit: 40, operator: 'or' });
    mode = items.length > 0 ? 'relaxed' : 'none';
  }
  const search: SessionSearchInfo = { mode, matched: items.length };
  const context = bucketEvidence(items);
  return {
    topic: opts.topic,
    context,
    instructions: renderInstructions(opts.topic, level, timeBudget, context, search, sinceDays),
    search,
  };
}
