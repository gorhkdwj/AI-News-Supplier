import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  compareSemver,
  formatUpdateNotice,
  isCacheFresh,
  maybeNotifyUpdate,
  readUpdateCache,
  shouldSkipCheck,
  writeUpdateCache,
} from '../../src/cli/updateNotice.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ains-update-'));
  tempDirs.push(dir);
  vi.stubEnv('AINS_HOME', dir);
  return dir;
}

/** 옵트아웃·CI 스텁 없이 검사 로직만 시험하기 위한 빈 환경. */
const cleanEnv = {} as NodeJS.ProcessEnv;

describe('compareSemver', () => {
  it('major/minor/patch를 숫자로 비교한다', () => {
    expect(compareSemver('0.1.0', '0.2.0')).toBe(-1);
    expect(compareSemver('0.2.0', '0.2.0')).toBe(0);
    expect(compareSemver('1.0.0', '0.9.9')).toBe(1);
    expect(compareSemver('0.10.0', '0.9.0')).toBe(1); // 문자열 비교가 아님
  });

  it('프리릴리스 태그는 무시한다', () => {
    expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBe(0);
  });
});

describe('shouldSkipCheck', () => {
  it('dev 버전은 건너뛴다', () => {
    expect(shouldSkipCheck('0.0.0-dev', cleanEnv)).toBe(true);
  });

  it('AINS_NO_UPDATE_CHECK 옵트아웃을 존중한다', () => {
    expect(shouldSkipCheck('0.2.0', { AINS_NO_UPDATE_CHECK: '1' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('CI 환경에서는 건너뛴다', () => {
    expect(shouldSkipCheck('0.2.0', { CI: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('일반 환경에서는 검사한다', () => {
    expect(shouldSkipCheck('0.2.0', cleanEnv)).toBe(false);
  });
});

describe('isCacheFresh', () => {
  const now = new Date('2026-07-12T12:00:00Z');

  it('24시간 이내 캐시는 신선하다', () => {
    expect(isCacheFresh({ checkedAt: '2026-07-12T00:00:00Z', latestVersion: '0.2.0' }, now)).toBe(
      true,
    );
  });

  it('24시간이 지난 캐시는 만료된다', () => {
    expect(isCacheFresh({ checkedAt: '2026-07-11T11:00:00Z', latestVersion: '0.2.0' }, now)).toBe(
      false,
    );
  });

  it('캐시가 없거나 checkedAt이 손상되면 만료로 본다', () => {
    expect(isCacheFresh(null, now)).toBe(false);
    expect(isCacheFresh({ checkedAt: 'garbage', latestVersion: '0.2.0' }, now)).toBe(false);
  });
});

describe('update cache io', () => {
  it('write 후 read로 복원된다', () => {
    tempHome();
    const cache = { checkedAt: '2026-07-12T00:00:00Z', latestVersion: '0.3.0' };
    writeUpdateCache(cache);
    expect(readUpdateCache()).toEqual(cache);
  });
});

describe('maybeNotifyUpdate', () => {
  const now = new Date('2026-07-12T12:00:00Z');

  it('새 버전이 있으면 stderr로 안내하고 캐시를 기록한다', async () => {
    tempHome();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await maybeNotifyUpdate('0.2.0', { now, env: cleanEnv, fetcher: async () => '0.3.0' });

    const output = stderr.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('0.2.0 → 0.3.0');
    expect(readUpdateCache()?.latestVersion).toBe('0.3.0');
  });

  it('최신 버전이면 아무것도 출력하지 않는다', async () => {
    tempHome();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await maybeNotifyUpdate('0.3.0', { now, env: cleanEnv, fetcher: async () => '0.3.0' });

    expect(stderr).not.toHaveBeenCalled();
  });

  it('신선한 캐시가 있으면 네트워크를 확인하지 않는다', async () => {
    tempHome();
    writeUpdateCache({ checkedAt: now.toISOString(), latestVersion: '0.3.0' });
    const fetcher = vi.fn(async () => '9.9.9');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await maybeNotifyUpdate('0.2.0', { now, env: cleanEnv, fetcher });

    expect(fetcher).not.toHaveBeenCalled();
    expect(stderr.mock.calls.map((c) => String(c[0])).join('')).toContain('0.2.0 → 0.3.0');
  });

  it('조회 실패(null)는 조용히 지나가고 캐시를 만들지 않는다', async () => {
    tempHome();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await maybeNotifyUpdate('0.2.0', { now, env: cleanEnv, fetcher: async () => null });

    expect(stderr).not.toHaveBeenCalled();
    expect(readUpdateCache()).toBeNull();
  });

  it('fetcher가 던져도 예외가 밖으로 새지 않는다', async () => {
    tempHome();
    await expect(
      maybeNotifyUpdate('0.2.0', {
        now,
        env: cleanEnv,
        fetcher: async () => {
          throw new Error('network');
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe('formatUpdateNotice', () => {
  it('업데이트 명령과 옵트아웃 방법을 안내한다', () => {
    const text = formatUpdateNotice('0.2.0', '0.3.0');
    expect(text).toContain('npm install -g ai-news-supplier');
    expect(text).toContain('AINS_NO_UPDATE_CHECK=1');
  });
});
