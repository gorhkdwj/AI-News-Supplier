import type { DB } from '../db/connection.js';
import { normalizeTopic } from '../learning/topics.js';

export type LearningLevel = 'beginner' | 'intermediate' | 'advanced';

export interface LearningEntry {
  id: number;
  topic: string;
  normalizedTopic: string;
  learnedAt: string;
  level: LearningLevel | null;
  timeSpentMin: number | null;
  notes: string | null;
  itemIds: string[];
}

export interface RecordLearningInput {
  topic: string;
  level?: LearningLevel | null;
  timeSpentMin?: number | null;
  notes?: string | null;
  itemIds?: string[];
  now?: string;
}

export function recordLearning(db: DB, input: RecordLearningInput): number {
  const now = input.now ?? new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO learning_history (topic, normalized_topic, learned_at, level, time_spent_min, notes, item_ids)
       VALUES (@topic, @normalizedTopic, @learnedAt, @level, @timeSpentMin, @notes, @itemIds)`,
    )
    .run({
      topic: input.topic,
      normalizedTopic: normalizeTopic(input.topic),
      learnedAt: now,
      level: input.level ?? null,
      timeSpentMin: input.timeSpentMin ?? null,
      notes: input.notes ?? null,
      itemIds: JSON.stringify(input.itemIds ?? []),
    });
  return Number(result.lastInsertRowid);
}

interface LearningRow {
  id: number;
  topic: string;
  normalized_topic: string;
  learned_at: string;
  level: string | null;
  time_spent_min: number | null;
  notes: string | null;
  item_ids: string;
}

function rowToEntry(row: LearningRow): LearningEntry {
  return {
    id: row.id,
    topic: row.topic,
    normalizedTopic: row.normalized_topic,
    learnedAt: row.learned_at,
    level: (row.level as LearningLevel | null) ?? null,
    timeSpentMin: row.time_spent_min,
    notes: row.notes,
    itemIds: JSON.parse(row.item_ids) as string[],
  };
}

export function getLearningHistory(db: DB, limit = 20): LearningEntry[] {
  const rows = db
    .prepare('SELECT * FROM learning_history ORDER BY learned_at DESC LIMIT ?')
    .all(limit) as LearningRow[];
  return rows.map(rowToEntry);
}

/** 해당 토픽의 가장 최근 학습 기록을 반환한다(없으면 null). novelty 계산용. */
export function findRecentLearning(db: DB, topic: string): { learnedAt: string } | null {
  const normalized = normalizeTopic(topic);
  const row = db
    .prepare(
      'SELECT learned_at FROM learning_history WHERE normalized_topic = ? ORDER BY learned_at DESC LIMIT 1',
    )
    .get(normalized) as { learned_at: string } | undefined;
  return row ? { learnedAt: row.learned_at } : null;
}
