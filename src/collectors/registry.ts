import type { ResolvedConfig } from '../core/config.js';
import { hackernewsCollector } from './hackernews.js';
import type { Collector } from './types.js';

/** 등록된 모든 수집기. S2에서 소스를 추가하며 늘어난다. */
export const ALL_COLLECTORS: Collector[] = [hackernewsCollector];

/** 설정상 활성화된 수집기만 반환한다. */
export function enabledCollectors(config: ResolvedConfig): Collector[] {
  return ALL_COLLECTORS.filter((c) => c.isEnabled(config));
}

/** 이름으로 수집기를 찾는다(활성 여부 무관). */
export function findCollector(name: string): Collector | undefined {
  return ALL_COLLECTORS.find((c) => c.name === name);
}
