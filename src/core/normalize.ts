import { createHash } from 'node:crypto';

const TRACKING_PARAM_EXACT = new Set(['ref', 'ref_src', 'ref_url', 'source', 'fbclid', 'gclid']);

/**
 * 중복 판정의 기준이 되는 canonical URL을 만든다.
 * - 해시(#...) 제거
 * - utm_* 및 알려진 추적 파라미터 제거
 * - 호스트 소문자화
 * - 경로 끝 슬래시 제거(루트 '/'는 유지)
 * 파싱 불가한 문자열은 trim만 해서 반환한다.
 */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    const params = u.searchParams;
    for (const key of [...params.keys()]) {
      const lower = key.toLowerCase();
      if (lower.startsWith('utm_') || TRACKING_PARAM_EXACT.has(lower)) {
        params.delete(key);
      }
    }
    u.search = params.toString();
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return rawUrl.trim();
  }
}

/** canonical URL로부터 항목 id(sha256 앞 16자 hex)를 만든다. */
export function itemId(canonicalUrl: string): string {
  return createHash('sha256').update(canonicalUrl).digest('hex').slice(0, 16);
}

/** source와 원천 식별자로부터 Sighting id(sha256 앞 24자 hex)를 만든다. */
export function sightingId(source: string, sourceKey: string): string {
  return createHash('sha256').update(`${source}\0${sourceKey}`).digest('hex').slice(0, 24);
}
