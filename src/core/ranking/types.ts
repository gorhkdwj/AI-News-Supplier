export type RankingChannel = 'community' | 'official' | 'repos' | 'research';

export type RankingSort = 'hot' | 'latest' | 'important' | 'trending' | 'discovery';

export type RankingKind =
  | 'community_hot_v2'
  | 'community_latest_v2'
  | 'official_important_v2'
  | 'official_latest_v2'
  | 'repository_discovery_v2'
  | 'repository_trending_v2'
  | 'research_hot_v1'
  | 'research_latest_v1';

export type RankingCoverage = 'full' | 'partial' | 'warming' | 'unavailable';

export interface TrendCandidate {
  storyId: string;
  sightingId?: string;
  source: string;
  type: string;
  title: string;
  summary: string | null;
  publishedAt: string;
}

export interface RankingMetadata {
  version: 'v2';
  channel: RankingChannel;
  sort: RankingSort;
  kind: RankingKind;
  position: number;
  score: number | null;
  coverage: RankingCoverage;
  signals: Record<string, unknown>;
  explanation: string;
}

export type RankedTrend<T extends TrendCandidate = TrendCandidate> = T & {
  ranking: RankingMetadata;
};

export interface RankOptions {
  now: Date;
  limit?: number;
}
