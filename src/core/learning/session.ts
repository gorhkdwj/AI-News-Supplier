import type { DB } from '../db/connection.js';
import type { NewsItem } from '../types.js';
import { getItemById, searchItems } from '../store/itemStore.js';
import type { LearningLevel } from '../store/learningStore.js';
import { getDiscussionUrls } from '../store/sightingStore.js';
import { bucketEvidence, type EvidenceBuckets } from './candidates.js';

/** topic/from-item 입력 규칙 위반(계약 11.3). 통로에서 CLI 종료 1·MCP 입력 오류로 변환된다. */
export class SessionInputError extends Error {}

/** exact: 전체 일치 / relaxed: 단어별(OR) 완화 일치 / none: 완화 후에도 0건 */
export type SessionSearchMode = 'exact' | 'relaxed' | 'none';

export interface SessionSearchInfo {
  mode: SessionSearchMode;
  matched: number;
}

export interface SessionFromItem {
  id: string;
  title: string;
  url: string;
}

export interface LearningSession {
  topic: string;
  context: EvidenceBuckets;
  instructions: string;
  search: SessionSearchInfo;
  fromItem?: SessionFromItem;
}

export interface SessionOptions {
  topic?: string;
  /** 수집 항목 ID에서 세션을 설계한다. topic과 정확히 하나만 지정한다(계약 11.3). */
  fromItemId?: string;
  level?: LearningLevel;
  timeBudgetMinutes?: number;
  sinceDays?: number;
}

const LEVEL_GUIDE: Record<LearningLevel, string> = {
  beginner: '기초 개념부터 시작하고 전문용어는 쉬운 비유로 풀어서 설명하십시오.',
  intermediate: '핵심 원리와 실무 적용에 초점을 맞추고, 이미 아는 기초는 빠르게 넘어가십시오.',
  advanced: '심화 트레이드오프, 한계, 최신 연구 맥락까지 깊이 다루십시오.',
};

/** 링크를 열기 전에 우회 경로(토론)와 자료 두께(점수·댓글)를 가늠할 수 있게 병기한다 (계약 11.2). */
function itemMeta(item: NewsItem, discussionUrl: string | undefined): string {
  const parts: string[] = [];
  if (discussionUrl !== undefined && discussionUrl !== item.url) parts.push(`토론: ${discussionUrl}`);
  if (item.score !== null) parts.push(`점수 ${item.score}`);
  if (item.commentsCount !== null) parts.push(`댓글 ${item.commentsCount}`);
  return parts.length === 0 ? '' : `\n    (${parts.join(' · ')})`;
}

function linkList(items: NewsItem[], discussions: Map<string, string>): string {
  if (items.length === 0) return '  (없음)';
  return items
    .map((i) => `  - ${i.title} — ${i.url}${itemMeta(i, discussions.get(i.id))}`)
    .join('\n');
}

function searchNotice(
  topic: string,
  search: SessionSearchInfo,
  sinceDays: number,
  hasAnchor: boolean,
): string[] {
  if (search.mode === 'none') {
    // 출발 항목이 있으면 근거가 0건은 아니므로 재시도 강제 대신 보강 안내로 구분한다(계약 11.3).
    if (hasAnchor) {
      return [
        `[안내] 출발 항목 외에는 최근 ${sinceDays}일 수집 데이터에서 추가 자료가 검색되지 않았습니다(전체 일치·단어별 일치 모두 0건).`,
        '출발 항목을 1차 근거로 삼고, 필요하면 search_news로 영어 키워드 1~2개 보강 검색을 수행하십시오.',
        '',
      ];
    }
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
  discussions: Map<string, string>,
  fromItem?: SessionFromItem,
): string {
  // 패키지에 없는 자료를 지시하지 않는다(계약 11.2): 핫레포/모델이 없으면 실습 지시문을 대체한다.
  const practiceStep =
    ctx.repos.length > 0
      ? '3) 실습: 핫레포/모델 중 하나를 골라 따라 할 수 있는 실습 단계 제시'
      : '3) 실습: 핫레포/모델 자료가 없으므로, 근거 자료(논문·공식 글·토론)의 방법을 소규모로 재현하는 실습 단계 제시';
  return [
    `당신은 학습자가 "${topic}"을(를) 배우도록 돕는 튜터입니다. ${LEVEL_GUIDE[level]}`,
    ...(fromItem === undefined
      ? []
      : [
          `이 세션은 수집 항목 "${fromItem.title}" — ${fromItem.url} 에서 출발했습니다. 이 항목을 1차 근거로 삼으십시오.`,
        ]),
    `총 학습 시간은 약 ${timeBudget}분입니다. 아래 근거 자료만 사용하고, 각 주장에는 출처 URL을 붙이십시오.`,
    '',
    '다음 순서로 학습 세션을 구성해 진행하십시오:',
    `1) 5분 브리핑: "${topic}"이 무엇이고 지금 왜 화제인지 요약`,
    '2) 핵심 개념: 학습자 수준에 맞춰 개념 3~5개를 설명(공식 자료·논문 근거 활용)',
    practiceStep,
    '4) 이해 점검: 학습자에게 던질 확인 질문 3개',
    '5) 더 읽을거리: 아래 자료에서 우선순위가 높은 항목 추천',
    '6) 마무리: 학습이 끝나면 record_learning 도구로 이 토픽을 기록하도록 안내',
    '',
    '자료 접근이 막히거나 근거가 부족할 때의 규칙:',
    '- 원문 접근이 차단되면(예: 403) 병기된 토론 URL로 우회하되, 토론 경유 내용은 2차 자료로 표시하고 해당 부분을 미검증 범위로 명시하십시오.',
    '- 근거가 부족하면 순서대로 대응하십시오: 1) 세션 범위 축소(사유 명시) 2) search_news로 보강 검색 또는 인접 토픽으로 이 도구 재호출 3) 수집이 쌓인 뒤 재시도 제안 4) 그래도 부족하면 세션을 만들지 말고 근거 부족을 보고. 근거 없는 내용을 지어내지 마십시오.',
    '',
    '=== 근거 자료 ===',
    ...searchNotice(topic, search, sinceDays, fromItem !== undefined),
    '[공식 업데이트]',
    linkList(ctx.official, discussions),
    '[논문]',
    linkList(ctx.papers, discussions),
    '[핫레포/모델]',
    linkList(ctx.repos, discussions),
    '[커뮤니티/기타]',
    linkList(ctx.discussion, discussions),
  ].join('\n');
}

/**
 * 특정 토픽의 맥락 자료를 모으고, 에이전트가 학습 세션을 설계하도록 지시문을 조립한다.
 * 자료 검색은 전체 일치(AND) → 0건이면 단어별(OR) 완화 순서로 시도하고,
 * 그래도 0건이면 사유와 재시도 안내를 지시문에 명시한다(계약 11.1, T-012).
 * from-item 호출은 토픽 추출 없이 항목 제목을 그대로 검색 토픽으로 쓰고(D-014),
 * 출발 항목을 검색 결과와 무관하게 근거에 포함한다(계약 11.3).
 */
export function designLearningSession(db: DB, opts: SessionOptions): LearningSession {
  if ((opts.topic === undefined) === (opts.fromItemId === undefined)) {
    throw new SessionInputError('topic과 from-item 중 정확히 하나만 지정하십시오');
  }
  let anchor: NewsItem | undefined;
  if (opts.fromItemId !== undefined) {
    const found = getItemById(db, opts.fromItemId);
    if (found === null) {
      throw new SessionInputError(`항목을 찾을 수 없습니다: ${opts.fromItemId}`);
    }
    anchor = found;
  }
  const topic = anchor?.title ?? (opts.topic as string);
  const level = opts.level ?? 'intermediate';
  const timeBudget = opts.timeBudgetMinutes ?? 45;
  const sinceDays = opts.sinceDays ?? 30;
  let mode: SessionSearchMode = 'exact';
  let items = searchItems(db, topic, { sinceDays, limit: 40 });
  if (items.length === 0) {
    items = searchItems(db, topic, { sinceDays, limit: 40, operator: 'or' });
    mode = items.length > 0 ? 'relaxed' : 'none';
  }
  // matched는 검색 매칭 수. 출발 항목은 검색과 무관하게 항상 근거에 포함한다(중복이면 맨 앞으로).
  const search: SessionSearchInfo = { mode, matched: items.length };
  const fromItem: SessionFromItem | undefined =
    anchor === undefined ? undefined : { id: anchor.id, title: anchor.title, url: anchor.url };
  if (anchor !== undefined) {
    const anchorId = anchor.id;
    items = [anchor, ...items.filter((i) => i.id !== anchorId)];
  }
  const context = bucketEvidence(items);
  const discussions = getDiscussionUrls(
    db,
    items.map((i) => i.id),
  );
  return {
    topic,
    context,
    instructions: renderInstructions(
      topic,
      level,
      timeBudget,
      context,
      search,
      sinceDays,
      discussions,
      fromItem,
    ),
    search,
    ...(fromItem === undefined ? {} : { fromItem }),
  };
}
