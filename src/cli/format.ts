import type { NewsItem } from '../core/types.js';
import type { TrendResult, TrendResultItem } from '../core/trends/service.js';
import type { SourceRefreshResult } from '../core/refresh.js';
import type { LearningCandidate } from '../core/learning/candidates.js';
import type { LearningSession } from '../core/learning/session.js';
import type { LearningEntry } from '../core/store/learningStore.js';

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

function scoreLabel(item: TrendResultItem): string {
  return item.score != null ? `${item.scoreKind ?? 'score'} ${item.score}` : '—';
}

const SECTION_LABELS = {
  overview: 'Overview',
  community: 'Community',
  official: 'Official',
  repos: 'Repos',
  research: 'Research',
} as const;

export function formatTrends(result: TrendResult): string {
  const lines: string[] = [];
  for (const section of result.sections) {
    if (lines.length > 0) lines.push('');
    lines.push(`${SECTION_LABELS[section.channel]} · ${section.sort}`);
    if (section.items.length === 0) {
      lines.push('  표시할 항목이 없습니다.');
      if (section.notice !== undefined) lines.push(`  (사유: ${section.notice})`);
      continue;
    }
    section.items.forEach((it) => {
      const idx = String(it.ranking.position).padStart(2, ' ');
      lines.push(`${idx}. [${it.source} · ${it.type} · ${scoreLabel(it)}] ${it.title}`);
      lines.push(`    ${it.url}`);
      lines.push(
        `    ${it.ranking.kind} · score ${it.ranking.score ?? '—'} · coverage ${it.ranking.coverage}`,
      );
      lines.push(`    ${dateOnly(it.publishedAt)} · id ${it.id}`);
    });
  }
  return lines.join('\n');
}

export function formatSearchResults(items: NewsItem[]): string {
  if (items.length === 0) return '검색 결과가 없습니다.';
  return items
    .map(
      (it, i) =>
        `${String(i + 1).padStart(2, ' ')}. [${it.source}] ${it.title}\n    ${it.url}\n    id ${it.id}`,
    )
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

export function formatCandidates(candidates: LearningCandidate[]): string {
  if (candidates.length === 0) {
    return '학습 후보가 없습니다. `ains fetch`로 더 많은 데이터를 수집해 보십시오.';
  }
  const lines: string[] = [];
  candidates.forEach((c, i) => {
    const e = c.evidence;
    lines.push(`${i + 1}. ${c.topic}  (learnScore ${c.learnScore})`);
    lines.push(`    ${c.why}`);
    lines.push(
      `    근거: 공식 ${e.official.length} · 논문 ${e.papers.length} · 레포 ${e.repos.length} · 커뮤니티 ${e.discussion.length}`,
    );
  });
  return lines.join('\n');
}

export function formatSession(session: LearningSession): string {
  return `# 학습 세션: ${session.topic}\n\n${session.instructions}`;
}

export function formatHistory(entries: LearningEntry[]): string {
  if (entries.length === 0) return '학습 이력이 없습니다.';
  return entries
    .map(
      (e) =>
        `- ${e.learnedAt.slice(0, 10)}  ${e.topic}${e.level ? ` (${e.level})` : ''}${
          e.notes ? ` — ${e.notes}` : ''
        }`,
    )
    .join('\n');
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
