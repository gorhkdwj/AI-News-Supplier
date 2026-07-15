import type { MetricSnapshot, SourceSighting } from '../types.js';
import type { TrendResult, TrendResultItem } from './service.js';

export function serializeTrendItem(item: TrendResultItem): Record<string, unknown> {
  return {
    id: item.id,
    source: item.source,
    type: item.type,
    title: item.title,
    url: item.url,
    canonical_url: item.canonicalUrl,
    summary: item.summary,
    author: item.author,
    score: item.score,
    comments_count: item.commentsCount,
    tags: item.tags,
    published_at: item.publishedAt,
    first_seen_at: item.firstSeenAt,
    last_seen_at: item.lastSeenAt,
    raw: item.raw,
    sighting_id: item.sightingId,
    score_kind: item.scoreKind,
    discussion_url: item.discussionUrl,
    activity_at: item.activityAt,
    published_precision: item.publishedPrecision,
    ranking: item.ranking,
    hotness: item.hotness,
  };
}

export function serializeTrendResult(result: TrendResult): Record<string, unknown> {
  const sections = result.sections.map((section) => ({
    channel: section.channel,
    sort: section.sort,
    items: section.items.map(serializeTrendItem),
    ...(section.notice === undefined ? {} : { notice: section.notice }),
  }));
  return {
    ranking_version: result.rankingVersion,
    sections,
    items: sections.flatMap((section) => section.items),
  };
}

function serializeMetricSnapshot(snapshot: MetricSnapshot): Record<string, unknown> {
  return {
    sighting_id: snapshot.sightingId,
    bucket_at: snapshot.bucketAt,
    observed_at: snapshot.observedAt,
    score: snapshot.score,
    comments_count: snapshot.commentsCount,
  };
}

export function serializeSighting(sighting: SourceSighting): Record<string, unknown> {
  return {
    id: sighting.id,
    story_id: sighting.storyId,
    source: sighting.source,
    source_key: sighting.sourceKey,
    type: sighting.type,
    source_url: sighting.url,
    discussion_url: sighting.discussionUrl,
    title: sighting.title,
    summary: sighting.summary,
    author: sighting.author,
    tags: sighting.tags,
    score_kind: sighting.scoreKind,
    score: sighting.score,
    comments_count: sighting.commentsCount,
    published_at: sighting.publishedAt,
    published_precision: sighting.publishedPrecision,
    activity_at: sighting.activityAt,
    first_seen_at: sighting.firstSeenAt,
    last_seen_at: sighting.lastSeenAt,
    raw: sighting.raw,
    quality: sighting.quality,
    verified_at: sighting.verifiedAt,
    is_primary: sighting.isPrimary,
    metric_history: sighting.metricHistory.map(serializeMetricSnapshot),
  };
}
