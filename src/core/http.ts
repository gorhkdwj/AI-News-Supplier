const USER_AGENT = 'ai-news-supplier (+https://github.com/gorhkdwj/AI-News-Supplier)';

export interface HttpResponse {
  status: number;
  ok: boolean;
  notModified: boolean;
  text: string;
  etag: string | null;
  lastModified: string | null;
  /** 응답 헤더를 대소문자 구분 없이 조회한다. */
  header(name: string): string | null;
  json<T>(): T;
}

export interface HttpGetOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** 조건부 GET용. 있으면 If-None-Match 헤더로 보낸다. */
  etag?: string | null;
  /** 조건부 GET용. 있으면 If-Modified-Since 헤더로 보낸다. */
  lastModified?: string | null;
  /** 5xx/네트워크 오류 시 재시도 횟수(기본 2). 4xx는 재시도하지 않는다. */
  retries?: number;
}

export interface HttpPostOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

export interface HttpClient {
  get(url: string, opts?: HttpGetOptions): Promise<HttpResponse>;
  /** application/x-www-form-urlencoded POST (OAuth 토큰 발급 등). */
  postForm(
    url: string,
    body: Record<string, string>,
    opts?: HttpPostOptions,
  ): Promise<HttpResponse>;
}

interface RequestSpec {
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  timeoutMs?: number;
  etag?: string | null;
  lastModified?: string | null;
  body?: string;
  contentType?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function backoffMs(attempt: number): number {
  return Math.min(2000, 250 * 2 ** attempt);
}

async function doRequest(url: string, spec: RequestSpec): Promise<HttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), spec.timeoutMs ?? 15_000);
  try {
    const headers: Record<string, string> = {
      'user-agent': USER_AGENT,
      accept: 'application/json, text/xml, application/xml, */*',
      ...spec.headers,
    };
    if (spec.etag) headers['if-none-match'] = spec.etag;
    if (spec.lastModified) headers['if-modified-since'] = spec.lastModified;
    if (spec.contentType) headers['content-type'] = spec.contentType;

    const res = await fetch(url, {
      method: spec.method,
      headers,
      body: spec.body,
      signal: controller.signal,
      redirect: 'follow',
    });
    const text = res.status === 304 ? '' : await res.text();
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      notModified: res.status === 304,
      text,
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
      header(name: string): string | null {
        return res.headers.get(name);
      },
      json<T>(): T {
        return JSON.parse(text) as T;
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function withRetry(retries: number, run: () => Promise<HttpResponse>): Promise<HttpResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await run();
      if (res.status >= 500 && attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await sleep(backoffMs(attempt));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** 기본 HTTP 클라이언트. timeout + 지수 백오프 재시도 + 조건부 GET을 지원한다. */
export function createHttpClient(): HttpClient {
  return {
    get(url: string, opts: HttpGetOptions = {}): Promise<HttpResponse> {
      return withRetry(opts.retries ?? 2, () =>
        doRequest(url, {
          method: 'GET',
          headers: opts.headers,
          timeoutMs: opts.timeoutMs,
          etag: opts.etag,
          lastModified: opts.lastModified,
        }),
      );
    },
    postForm(
      url: string,
      body: Record<string, string>,
      opts: HttpPostOptions = {},
    ): Promise<HttpResponse> {
      const encoded = new URLSearchParams(body).toString();
      return withRetry(opts.retries ?? 2, () =>
        doRequest(url, {
          method: 'POST',
          headers: opts.headers,
          timeoutMs: opts.timeoutMs,
          body: encoded,
          contentType: 'application/x-www-form-urlencoded',
        }),
      );
    },
  };
}
