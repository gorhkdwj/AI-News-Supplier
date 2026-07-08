import type { HttpClient, HttpResponse } from '../../src/core/http.js';

export interface StubRoute {
  /** URL에 이 부분 문자열이 포함되면 매칭 */
  match: string;
  status?: number;
  body?: string;
}

/** URL 부분 문자열 매칭으로 고정 응답을 돌려주는 테스트용 HTTP 클라이언트. */
export function stubHttp(routes: StubRoute[]): HttpClient {
  return {
    async get(url: string): Promise<HttpResponse> {
      const route = routes.find((r) => url.includes(r.match));
      // 라우트를 찾으면 status 기본 200, 못 찾으면 404.
      const status = route ? (route.status ?? 200) : 404;
      const text = route?.body ?? '';
      return {
        status,
        ok: status >= 200 && status < 300,
        notModified: status === 304,
        text,
        etag: null,
        lastModified: null,
        json<T>(): T {
          return JSON.parse(text) as T;
        },
      };
    },
  };
}
