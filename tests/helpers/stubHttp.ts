import type {
  HttpClient,
  HttpGetOptions,
  HttpPostOptions,
  HttpResponse,
} from '../../src/core/http.js';

export interface StubRoute {
  /** URL에 이 부분 문자열이 포함되면 매칭 */
  match: string;
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

export interface StubRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: Record<string, string>;
}

/** URL 부분 문자열 매칭으로 고정 응답을 돌려주는 테스트용 HTTP 클라이언트. */
export function stubHttp(routes: StubRoute[], requests: StubRequest[] = []): HttpClient {
  function respond(url: string): HttpResponse {
    const route = routes.find((r) => url.includes(r.match));
    // 라우트를 찾으면 status 기본 200, 못 찾으면 404.
    const status = route ? (route.status ?? 200) : 404;
    const text = route?.body ?? '';
    const headers = new Map(
      Object.entries(route?.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
    );
    return {
      status,
      ok: status >= 200 && status < 300,
      notModified: status === 304,
      text,
      etag: null,
      lastModified: null,
      header(name: string): string | null {
        return headers.get(name.toLowerCase()) ?? null;
      },
      json<T>(): T {
        return JSON.parse(text) as T;
      },
    };
  }

  return {
    async get(url: string, opts?: HttpGetOptions): Promise<HttpResponse> {
      requests.push({ method: 'GET', url, headers: opts?.headers });
      return respond(url);
    },
    async postForm(
      url: string,
      body: Record<string, string>,
      opts?: HttpPostOptions,
    ): Promise<HttpResponse> {
      requests.push({ method: 'POST', url, headers: opts?.headers, body });
      return respond(url);
    },
  };
}
