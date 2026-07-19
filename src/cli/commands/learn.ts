import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { openDb } from '../../core/db/connection.js';
import { refreshStale } from '../../core/refresh.js';
import { mineLearningCandidates } from '../../core/learning/candidates.js';
import { designLearningSession } from '../../core/learning/session.js';
import { recordLearning, type LearningLevel } from '../../core/store/learningStore.js';
import { formatCandidates, formatSession, printJson, printText } from '../format.js';
import { parsePositiveInt } from '../shared.js';

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

function parseLevel(v: string | undefined): LearningLevel | undefined {
  return v && (LEVELS as readonly string[]).includes(v) ? (v as LearningLevel) : undefined;
}

export function registerLearn(program: Command): void {
  const learn = program.command('learn').description('학습 후보 발굴 / 세션 설계 / 학습 기록');

  learn
    .command('candidates', { isDefault: true })
    .description('학습 가치가 높은 토픽 후보를 보여줍니다(기본)')
    .option('--limit <n>', '개수', '5')
    .option('--days <n>', '조회 윈도(일)', '7')
    .option('--include-learned', '이미 학습한 토픽도 포함')
    .option('--no-refresh', '수집 없이 DB에서만')
    .option('--json', 'JSON으로 출력')
    .action(async (opts) => {
      const db = openDb();
      try {
        const config = loadConfig();
        if (opts.refresh !== false) await refreshStale(db, config);
        const candidates = mineLearningCandidates(db, {
          limit: parsePositiveInt(opts.limit as string, 5),
          sinceDays: parsePositiveInt(opts.days as string, 7),
          includeLearned: Boolean(opts.includeLearned),
          relearnAfterDays: config.learning.relearnAfterDays,
          now: new Date(),
        });
        if (opts.json) printJson({ candidates });
        else printText(formatCandidates(candidates));
      } finally {
        db.close();
      }
    });

  learn
    .command('session [topic]')
    .description('특정 토픽 또는 수집 항목(--from-item)의 학습 세션 지시문을 생성합니다')
    .option('--from-item <id>', '수집 항목 ID에서 세션 생성(topic과 정확히 하나만 지정)')
    .option('--level <level>', 'beginner|intermediate|advanced')
    .option('--time <minutes>', '학습 시간(분)', '45')
    .option('--json', 'JSON으로 출력')
    .action((topic: string | undefined, opts) => {
      const db = openDb();
      try {
        const config = loadConfig();
        const session = designLearningSession(db, {
          topic,
          fromItemId: opts.fromItem as string | undefined,
          level: parseLevel(opts.level as string | undefined) ?? config.learning.defaultLevel,
          timeBudgetMinutes: parsePositiveInt(opts.time as string, 45),
        });
        if (opts.json) printJson(session);
        else printText(formatSession(session));
      } finally {
        db.close();
      }
    });

  learn
    .command('record <topic>')
    .description('학습한 토픽을 이력에 기록합니다')
    .option('--level <level>', 'beginner|intermediate|advanced')
    .option('--time <minutes>', '소요 시간(분)')
    .option('--notes <text>', '메모')
    .action((topic: string, opts) => {
      const db = openDb();
      try {
        const id = recordLearning(db, {
          topic,
          level: parseLevel(opts.level as string | undefined),
          timeSpentMin: opts.time ? parsePositiveInt(opts.time as string, 0) : undefined,
          notes: (opts.notes as string | undefined) ?? undefined,
        });
        printText(`학습 기록됨: ${topic} (id ${id})`);
      } finally {
        db.close();
      }
    });
}
