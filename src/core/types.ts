/** 정규화된 항목의 유형. (요구사항 계약 문서 기준) */
export type ItemType =
  | 'community'
  | 'official_update'
  | 'hot_repo'
  | 'model'
  | 'paper'
  | 'article';

export const ITEM_TYPES: readonly ItemType[] = [
  'community',
  'official_update',
  'hot_repo',
  'model',
  'paper',
  'article',
];

/**
 * 수집기가 반환하는 항목. canonical_url / id / first_seen_at / last_seen_at 는
 * 아직 없다. normalize + store 단계에서 채워진다.
 */
export interface CollectedItem {
  /** 수집기 이름. 'hackernews' | 'github' | 'rss:<feedId>' 등 */
  source: string;
  type: ItemType;
  title: string;
  url: string;
  summary: string | null;
  author: string | null;
  /** 소스 고유 점수(포인트/스타/좋아요 등). 없으면 null */
  score: number | null;
  commentsCount: number | null;
  tags: string[];
  /** ISO8601 UTC. 알 수 없으면 null (store가 수집 시각으로 대체) */
  publishedAt: string | null;
  /** 소스 원본 페이로드(핵심만 추려 보관). JSON 직렬화 가능해야 한다. */
  raw: unknown;
}

/** DB에 저장/조회되는 완전한 항목 형태. */
export interface NewsItem extends CollectedItem {
  /** sha256(canonical_url) 앞 16자 hex */
  id: string;
  canonicalUrl: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** 조회 결과에 랭킹 점수를 덧붙인 형태. */
export interface RankedItem extends NewsItem {
  hotness: number;
}
