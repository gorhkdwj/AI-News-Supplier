import { ITEM_TYPES, type ItemType } from '../core/types.js';
import { logger } from '../core/logger.js';

export function parseList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const list = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

export function parseTypes(value?: string): ItemType[] | undefined {
  const list = parseList(value);
  if (!list) return undefined;
  const valid: ItemType[] = [];
  for (const t of list) {
    if ((ITEM_TYPES as readonly string[]).includes(t)) {
      valid.push(t as ItemType);
    } else {
      logger.warn(`알 수 없는 유형 무시: ${t} (허용: ${ITEM_TYPES.join(', ')})`);
    }
  }
  return valid.length > 0 ? valid : undefined;
}

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function fail(message: string): never {
  process.stderr.write(`오류: ${message}\n`);
  process.exit(1);
}
