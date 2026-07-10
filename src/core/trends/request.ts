import { ITEM_TYPES, type ItemType } from '../types.js';

export type TrendRankingVersion = 'legacy' | 'v2';
export type TrendChannel = 'overview' | 'community' | 'official' | 'repos' | 'research';
export type TrendSort = 'briefing' | 'hot' | 'latest' | 'important' | 'trending' | 'discovery';

export interface TrendRequestInput {
  rankingVersion?: string;
  channel?: string;
  sort?: string;
  sources?: string[];
  types?: string[];
  sinceHours?: number;
  limit?: number;
}

export interface ResolvedTrendRequest {
  rankingVersion: TrendRankingVersion;
  channel: TrendChannel;
  sort: TrendSort;
  sources: string[] | undefined;
  types: ItemType[] | undefined;
  sinceHours: number | undefined;
  limit: number;
}

export class TrendInputError extends Error {
  readonly code = 'TREND_INPUT_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'TrendInputError';
  }
}

const RANKING_VERSIONS = ['legacy', 'v2'] as const;
const CHANNELS = ['overview', 'community', 'official', 'repos', 'research'] as const;
const SORTS = ['briefing', 'hot', 'latest', 'important', 'trending', 'discovery'] as const;

const CHANNEL_SORTS: Record<TrendChannel, readonly TrendSort[]> = {
  overview: ['briefing'],
  community: ['hot', 'latest'],
  official: ['latest', 'important'],
  repos: ['trending', 'discovery'],
  research: ['hot', 'latest'],
};

const DEFAULT_SORT: Record<TrendChannel, TrendSort> = {
  overview: 'briefing',
  community: 'hot',
  official: 'latest',
  repos: 'trending',
  research: 'hot',
};

const CHANNEL_TYPES: Record<Exclude<TrendChannel, 'overview'>, readonly ItemType[]> = {
  community: ['community', 'article'],
  official: ['official_update'],
  repos: ['hot_repo'],
  research: ['model', 'paper', 'article'],
};

function enumValue<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  field: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) {
    throw new TrendInputError(`Invalid ${field}: ${value}. Allowed: ${allowed.join(', ')}`);
  }
  return value as T;
}

function positiveInteger(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value <= 0) {
    throw new TrendInputError(`${field} must be a positive integer`);
  }
  return value;
}

function resolveTypes(values: string[] | undefined): ItemType[] | undefined {
  if (values === undefined || values.length === 0) return undefined;
  const unique: ItemType[] = [];
  for (const value of values) {
    if (!(ITEM_TYPES as readonly string[]).includes(value)) {
      throw new TrendInputError(`Invalid type: ${value}. Allowed: ${ITEM_TYPES.join(', ')}`);
    }
    if (!unique.includes(value as ItemType)) unique.push(value as ItemType);
  }
  return unique;
}

function validateChannelTypes(
  channel: TrendChannel,
  types: ItemType[] | undefined,
  sources: string[] | undefined,
): void {
  if (channel === 'overview' || types === undefined) return;
  const allowed = CHANNEL_TYPES[channel];
  const invalid = types.filter((type) => !allowed.includes(type));
  if (invalid.length > 0) {
    throw new TrendInputError(
      `Type ${invalid.join(', ')} is incompatible with channel ${channel}; allowed: ${allowed.join(', ')}`,
    );
  }
  if (types.includes('article') && sources !== undefined && sources.length > 0) {
    if (channel === 'community' && !sources.includes('devto')) {
      throw new TrendInputError('Community article results require source devto');
    }
    if (channel === 'research' && sources.every((source) => source === 'devto')) {
      throw new TrendInputError('Source devto article results belong to community, not research');
    }
  }
}

export function resolveTrendRequest(input: TrendRequestInput): ResolvedTrendRequest {
  const explicitRanking = enumValue(input.rankingVersion, RANKING_VERSIONS, 'rankingVersion');
  const explicitChannel = enumValue(input.channel, CHANNELS, 'channel');
  const explicitSort = enumValue(input.sort, SORTS, 'sort');
  const channel = explicitChannel ?? 'overview';

  if (explicitSort !== undefined && !CHANNEL_SORTS[channel].includes(explicitSort)) {
    const hint = explicitChannel === undefined ? ' Specify a compatible channel.' : '';
    throw new TrendInputError(
      `Sort ${explicitSort} is incompatible with channel ${channel}.${hint}`,
    );
  }

  const rankingVersion: TrendRankingVersion =
    explicitRanking ??
    (explicitChannel !== undefined || explicitSort !== undefined ? 'v2' : 'legacy');
  const sort = explicitSort ?? DEFAULT_SORT[channel];
  if (rankingVersion === 'legacy' && (channel !== 'overview' || sort !== 'briefing')) {
    throw new TrendInputError('Legacy ranking permits only overview/briefing');
  }

  const sources =
    input.sources === undefined || input.sources.length === 0
      ? undefined
      : [...new Set(input.sources)];
  const types = resolveTypes(input.types);
  validateChannelTypes(channel, types, sources);

  return {
    rankingVersion,
    channel,
    sort,
    sources,
    types,
    sinceHours: positiveInteger(input.sinceHours, 'sinceHours'),
    limit: positiveInteger(input.limit, 'limit') ?? 20,
  };
}
