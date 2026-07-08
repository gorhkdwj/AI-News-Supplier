import type { NewsItem, RankedItem } from '../core/types.js';
import type { SourceRefreshResult } from '../core/refresh.js';

/** CLI 결과 JSON을 stdout으로 출력한다. */
export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/** 사람이 읽는 텍스트를 stdout으로 출력한다. */
export function printText(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : text + '\n');
}

function dateOnly(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '-';
}

function scoreLabel(item: NewsItem): string {
  return item.score != null ? `★${item.score}` : '—';
}

export function formatTrends(items: RankedItem[]): string {
  if (items.length === 0) return '표시할 트렌드가 없습니다. `ains fetch`로 먼저 수집해 보십시오.';
  const lines: string[] = [];
  items.forEach((it, i) => {
    const idx = String(i + 1).padStart(2, ' ');
    lines.push(
      `${idx}. [${it.source} · ${it.type} · ${scoreLabel(it)}] ${it.title}`,
    );
    lines.push(`    ${it.url}`);
    lines.push(`    hotness ${it.hotness} · ${dateOnly(it.publishedAt)} · id ${it.id}`);
  });
  return lines.join('\n');
}

export function formatSearchResults(items: NewsItem[]): string {
  if (items.length === 0) return '검색 결과가 없습니다.';
  return items
    .map((it, i) => `${String(i + 1).padStart(2, ' ')}. [${it.source}] ${it.title}\n    ${it.url}\n    id ${it.id}`)
    .join('\n');
}

export function formatItemDetail(item: NewsItem): string {
  const lines = [
    `제목    : ${item.title}`,
    `소스    : ${item.source} (${item.type})`,
    `URL     : ${item.url}`,
    `점수    : ${item.score ?? '-'} · 댓글 ${item.commentsCount ?? '-'}`,
    `작성자  : ${item.author ?? '-'}`,
    `게시일  : ${dateOnly(item.publishedAt)}`,
    `태그    : ${item.tags.length > 0 ? item.tags.join(', ') : '-'}`,
    `id      : ${item.id}`,
  ];
  if (item.summary) lines.push('', '요약:', item.summary);
  return lines.join('\n');
}

export function formatFetchSummary(results: SourceRefreshResult[]): string {
  if (results.length === 0) return '실행된 수집기가 없습니다(활성 소스 없음).';
  const lines = results.map((r) => {
    const status = r.status.padEnd(12, ' ');
    const counts = `found ${r.itemsFound}, new ${r.itemsNew}`;
    const err = r.error ? ` · ${r.error}` : '';
    return `  ${r.source.padEnd(16, ' ')} ${status} ${counts}${err}`;
  });
  return ['수집 결과:', ...lines].join('\n');
}
