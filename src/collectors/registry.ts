import type { ResolvedConfig } from '../core/config.js';
import { hackernewsCollector } from './hackernews.js';
import { githubCollector } from './github.js';
import { geminiCliReleaseCollector } from './githubRelease.js';
import { huggingfaceCollector } from './huggingface.js';
import { arxivCollector } from './arxiv.js';
import { devtoCollector } from './devto.js';
import { redditCollector } from './reddit.js';
import { makeRssCollectors } from './rss.js';
import type { Collector } from './types.js';

/** 정적으로 등록된 수집기(RSS는 설정에 따라 동적 생성). */
export const STATIC_COLLECTORS: Collector[] = [
  hackernewsCollector,
  githubCollector,
  geminiCliReleaseCollector,
  huggingfaceCollector,
  arxivCollector,
  devtoCollector,
  redditCollector,
];

/** 설정 기준 활성 수집기 전체(정적 + 동적 RSS)를 반환한다. */
export function enabledCollectors(config: ResolvedConfig): Collector[] {
  const statics = STATIC_COLLECTORS.filter((c) => c.isEnabled(config));
  const rss = makeRssCollectors(config).filter((c) => c.isEnabled(config));
  return [...statics, ...rss];
}

/** 활성 여부와 무관하게 모든 수집기(정적 + 동적 RSS)를 반환한다(doctor/진단용). */
export function allCollectors(config: ResolvedConfig): Collector[] {
  return [...STATIC_COLLECTORS, ...makeRssCollectors(config)];
}
