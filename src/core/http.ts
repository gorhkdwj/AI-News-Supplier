const USER_AGENT = 'ai-news-supplier (+https://github.com/gorhkdwj/AI-News-Supplier)';

export interface HttpResponse {
  status: number;
  ok: boolean;
  notModified: boolean;
  text: string;
  etag: string | null;
  lastModified: string | null;
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

export interface HttpClient {
  get(url: string, opts?: HttpGetOptions): Promise<HttpResponse>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function backoffMs(attempt: number): number {
  return Math.min(2000, 250 * 2 ** attempt);
}

async function doFetch(url: string, opts: HttpGetOptions): Promise<HttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const headers: Record<string, string> = {
      'user-agent': USER_AGENT,
      accept: 'application/json, text/xml, application/xml, */*',
      ...opts.headers,
    };
    if (opts.etag) headers['if-none-match'] = opts.etag;
    if (opts.lastModified) headers['if-modified-since'] = opts.lastModified;

    const res = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    const text = res.status === 304 ? '' : await res.text();
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      notModified: res.status === 304,
      text,
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
      json<T>(): T {
        return JSON.parse(text) as T;
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** 기본 HTTP 클라이언트. timeout + 지수 백오프 재시도 + 조건부 GET을 지원한다. */
export function createHttpClient(): HttpClient {
  return {
    async get(url: string, opts: HttpGetOptions = {}): Promise<HttpResponse> {
      const retries = opts.retries ?? 2;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await doFetch(url, opts);
          // 5xx는 재시도, 4xx/2xx/3xx는 그대로 반환한다.
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
    },
  };
}
