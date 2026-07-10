import type { ResolvedConfig } from '../core/config.js';
import type { HttpClient } from '../core/http.js';
import type { Logger } from '../core/logger.js';
import type { SourceState } from '../core/store/fetchLog.js';
import type { LiveSightingInput } from '../core/types.js';

export interface TrackedSightingRef {
  sourceKey: string;
  sourceUrl: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface FetchContext {
  config: ResolvedConfig;
  http: HttpClient;
  /** 직전 수집 상태(etag/last_modified 조건부 GET용). 없으면 null. */
  state: SourceState | null;
  log: Logger;
  /** 주입 가능한 현재 시각(테스트 결정성). */
  now: Date;
  /** DB와 분리된 기존 source 추적 참조. */
  trackedSightings?: readonly TrackedSightingRef[];
}

/** 로그/상태에 노출해도 되는 비밀정보 없는 요율 한도 관측값. */
export interface SafeRateLimitStatus {
  used: number | null;
  remaining: number | null;
  resetSeconds: number | null;
}

export interface CollectorResult {
  items: LiveSightingInput[];
  /** 304 등으로 변경 없음일 때 true. items는 무시된다. */
  notModified?: boolean;
  etag?: string | null;
  lastModified?: string | null;
  /** 공식 재검증으로 삭제가 확인된 source identity. */
  deletedSourceKeys?: string[];
  /** 응답 헤더에서 읽은 비밀정보 없는 요율 한도 상태. */
  rateLimit?: SafeRateLimitStatus;
}

export interface Collector {
  /** 고유 이름. RSS는 'rss:<feedId>' 형태. */
  name: string;
  defaultTtlMinutes: number;
  /** false면 수집기가 비활성(오류 아님). 예: Reddit 자격증명 없음. */
  isEnabled(config: ResolvedConfig): boolean;
  fetch(ctx: FetchContext): Promise<CollectorResult>;
}

export type CollectorErrorKind = 'http' | 'parse' | 'auth' | 'timeout';

export class CollectorError extends Error {
  constructor(
    public readonly source: string,
    public readonly kind: CollectorErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'CollectorError';
  }
}
