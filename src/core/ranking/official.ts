import { diversifyBySource } from './diversity.js';
import { ageHours, clamp, compareText, normalizedLimit, round3 } from './math.js';
import type { RankOptions, RankedTrend, TrendCandidate } from './types.js';

export type OfficialImpactLevel = 'critical' | 'high' | 'normal' | 'low';

export interface OfficialImpact {
  level: OfficialImpactLevel;
  weight: number;
}

export interface OfficialCandidate extends TrendCandidate {
  type: 'official_update';
}

export interface OfficialRankOptions extends RankOptions {
  communityScores?: Record<string, Array<number | null>>;
}

const CRITICAL_PATTERN =
  /\b(?:security|vulnerabilit(?:y|ies)|cve(?:-\d+)?|exploit|deprecat(?:ion|ed|ing)|sunset|eol)\b|\bbreaking[\s-]+change\b|\bmigration[\s-]+required\b/i;
const LOW_PATTERN =
  /\bcustomer[\s-]+stor(?:y|ies)\b|\bcase[\s-]+stud(?:y|ies)\b|\b(?:event|webinar|conference|recap|podcast|interview)s?\b/i;
const HIGH_PATTERN =
  /\b(?:model|api|sdk)\s+(?:launch(?:ed|es)?|releas(?:e|ed|es)|generally[\s-]+available)\b|\b(?:launch(?:ed|es)?|releas(?:e|ed|es))\s+(?:a\s+|the\s+)?(?:model|api|sdk)\b|\bgenerally[\s-]+available\b|\bpricing\b|\b(?:rate|usage)[\s-]+limits?\b|\bcontext[\s-]+window\b|\bfine[\s-]*tuning\b/i;

export function classifyOfficialImpact(title: string, summary: string | null): OfficialImpact {
  const text = `${title}\n${summary ?? ''}`;
  if (CRITICAL_PATTERN.test(text)) return { level: 'critical', weight: 1 };
  if (LOW_PATTERN.test(text)) return { level: 'low', weight: 0.25 };
  if (HIGH_PATTERN.test(text)) return { level: 'high', weight: 0.8 };
  return { level: 'normal', weight: 0.5 };
}

function communityEcho(storyId: string, options: OfficialRankOptions): number {
  const scores = (options.communityScores?.[storyId] ?? []).filter(
    (score): score is number => score !== null && Number.isFinite(score),
  );
  return scores.length === 0 ? 0 : clamp(Math.max(...scores));
}

export function rankOfficialLatest(
  candidates: readonly OfficialCandidate[],
  options: RankOptions,
): Array<RankedTrend<OfficialCandidate>> {
  const sorted = [...candidates].sort(
    (left, right) =>
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
      compareText(left.storyId, right.storyId),
  );
  return sorted.slice(0, normalizedLimit(options.limit, sorted.length)).map((candidate, index) => ({
    ...candidate,
    ranking: {
      version: 'v2',
      channel: 'official',
      sort: 'latest',
      kind: 'official_latest_v2',
      position: index + 1,
      score: null,
      coverage: 'full',
      signals: { publishedAt: candidate.publishedAt },
      explanation: 'Newest official update by publication time',
    },
  }));
}

export function rankOfficialImportant(
  candidates: readonly OfficialCandidate[],
  options: OfficialRankOptions,
): Array<RankedTrend<OfficialCandidate>> {
  const ranked = candidates.map((candidate): RankedTrend<OfficialCandidate> => {
    const impact = classifyOfficialImpact(candidate.title, candidate.summary);
    const echo = communityEcho(candidate.storyId, options);
    const ageDays = ageHours(candidate.publishedAt, options.now) / 24;
    const ageDecay = 2 ** (-ageDays / 14);
    const score = round3(ageDecay * (0.85 * impact.weight + 0.15 * echo));
    return {
      ...candidate,
      ranking: {
        version: 'v2',
        channel: 'official',
        sort: 'important',
        kind: 'official_important_v2',
        position: 0,
        score,
        coverage: 'full',
        signals: {
          impactLevel: impact.level,
          impactWeight: impact.weight,
          communityEcho: echo,
          ageDays,
          ageDecay,
        },
        explanation: `${impact.level} impact with ${echo} community echo`,
      },
    };
  });
  ranked.sort(
    (left, right) =>
      (right.ranking.score as number) - (left.ranking.score as number) ||
      Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
      compareText(left.storyId, right.storyId),
  );
  return diversifyBySource(ranked, options.limit).map((candidate, index) => ({
    ...candidate,
    ranking: { ...candidate.ranking, position: index + 1 },
  }));
}
