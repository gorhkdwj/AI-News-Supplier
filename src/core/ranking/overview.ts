import { compareText } from './math.js';
import type { RankedTrend, RankingChannel } from './types.js';

const OVERVIEW_CHANNELS = ['official', 'repos', 'community', 'research'] as const;

export interface OverviewInput {
  official: readonly RankedTrend[];
  repos: readonly RankedTrend[];
  community: readonly RankedTrend[];
  research: readonly RankedTrend[];
}

export interface OverviewSection {
  channel: RankingChannel;
  items: RankedTrend[];
}

export interface OverviewResult {
  sections: OverviewSection[];
  items: RankedTrend[];
}

interface AlsoSeenSignal {
  channel: RankingChannel;
  source: string;
  sightingId?: string;
  kind: RankedTrend['ranking']['kind'];
  score: number | null;
  signals: Record<string, unknown>;
}

function channelPriority(channel: RankingChannel): number {
  return OVERVIEW_CHANNELS.indexOf(channel);
}

function withAlsoSeen(candidate: RankedTrend, occurrences: readonly RankedTrend[]): RankedTrend {
  const alsoSeen: AlsoSeenSignal[] = occurrences
    .filter((occurrence) => occurrence.ranking.channel !== candidate.ranking.channel)
    .map((occurrence) => ({
      channel: occurrence.ranking.channel,
      source: occurrence.source,
      ...(occurrence.sightingId === undefined ? {} : { sightingId: occurrence.sightingId }),
      kind: occurrence.ranking.kind,
      score: occurrence.ranking.score,
      signals: occurrence.ranking.signals,
    }))
    .sort(
      (left, right) =>
        channelPriority(left.channel) - channelPriority(right.channel) ||
        compareText(left.source, right.source) ||
        compareText(left.sightingId ?? '', right.sightingId ?? ''),
    );
  if (alsoSeen.length === 0) return candidate;
  return {
    ...candidate,
    ranking: {
      ...candidate.ranking,
      signals: { ...candidate.ranking.signals, also_seen: alsoSeen },
    },
  };
}

function ownedPools(input: OverviewInput): Record<RankingChannel, RankedTrend[]> {
  const occurrences = new Map<string, RankedTrend[]>();
  const owners = new Map<string, RankingChannel>();
  for (const channel of OVERVIEW_CHANNELS) {
    for (const candidate of input[channel]) {
      const existing = occurrences.get(candidate.storyId);
      if (existing) existing.push(candidate);
      else occurrences.set(candidate.storyId, [candidate]);
      if (!owners.has(candidate.storyId)) owners.set(candidate.storyId, channel);
    }
  }

  const pools: Record<RankingChannel, RankedTrend[]> = {
    official: [],
    repos: [],
    community: [],
    research: [],
  };
  for (const channel of OVERVIEW_CHANNELS) {
    const seen = new Set<string>();
    for (const candidate of input[channel]) {
      if (owners.get(candidate.storyId) !== channel || seen.has(candidate.storyId)) continue;
      seen.add(candidate.storyId);
      pools[channel].push(withAlsoSeen(candidate, occurrences.get(candidate.storyId) ?? []));
    }
  }
  return pools;
}

export function composeOverview(input: OverviewInput, limit: number): OverviewResult {
  const target = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const pools = ownedPools(input);
  const baseQuota = Math.floor(target / OVERVIEW_CHANNELS.length);
  const remainder = target % OVERVIEW_CHANNELS.length;
  const selected: Record<RankingChannel, RankedTrend[]> = {
    official: [],
    repos: [],
    community: [],
    research: [],
  };
  const offsets: Record<RankingChannel, number> = {
    official: 0,
    repos: 0,
    community: 0,
    research: 0,
  };

  OVERVIEW_CHANNELS.forEach((channel, index) => {
    const quota = baseQuota + (index < remainder ? 1 : 0);
    const initial = pools[channel].slice(0, quota);
    selected[channel].push(...initial);
    offsets[channel] = initial.length;
  });

  let selectedCount = OVERVIEW_CHANNELS.reduce(
    (total, channel) => total + selected[channel].length,
    0,
  );
  while (selectedCount < target) {
    let addedInPass = false;
    for (const channel of OVERVIEW_CHANNELS) {
      if (selectedCount >= target) break;
      const next = pools[channel][offsets[channel]];
      if (next === undefined) continue;
      selected[channel].push(next);
      offsets[channel] += 1;
      selectedCount += 1;
      addedInPass = true;
    }
    if (!addedInPass) break;
  }

  const sections: OverviewSection[] = OVERVIEW_CHANNELS.map((channel) => ({
    channel,
    items: selected[channel].map((candidate, index) => ({
      ...candidate,
      ranking: { ...candidate.ranking, position: index + 1 },
    })),
  }));
  return { sections, items: sections.flatMap((section) => section.items) };
}
