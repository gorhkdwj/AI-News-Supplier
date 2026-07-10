/** 정규화된 항목의 유형. (요구사항 계약 문서 기준) */
export type ItemType = 'community' | 'official_update' | 'hot_repo' | 'model' | 'paper' | 'article';

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

/** 원천이 제공한 게시 시각의 정밀도. */
export type PublishedPrecision = 'exact_time' | 'date_only' | 'inferred';

/** Sighting이 라이브 관측인지 마이그레이션 호환 행인지 구분한다. */
export type SightingQuality = 'live' | 'legacy_unverified';

/** 지원하는 v2 성장률 기준 시점. */
export type BaselineHorizon = '6h' | '24h' | '7d';

/** 수집기가 Sighting 저장소에 넘기는 정규화된 라이브 관측. */
export interface LiveSightingInput extends CollectedItem {
  sourceKey: string;
  discussionUrl: string | null;
  scoreKind: string | null;
  activityAt: string | null;
  publishedPrecision: PublishedPrecision;
}

/** 한 시간 버킷에 저장된 Sighting 지표 관측. */
export interface MetricSnapshot {
  sightingId: string;
  bucketAt: string;
  observedAt: string;
  score: number | null;
  commentsCount: number | null;
}

/** DB에 저장된 소스별 Story 관측. */
export interface SourceSighting extends LiveSightingInput {
  id: string;
  storyId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  quality: SightingQuality;
  verifiedAt: string | null;
  isPrimary: boolean;
  metricHistory: MetricSnapshot[];
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
