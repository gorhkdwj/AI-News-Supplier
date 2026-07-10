import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../../src/core/config.js';
import { logger } from '../../src/core/logger.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Reddit config', () => {
  it('AINS_REDDIT_USERNAME 환경변수가 config username보다 우선한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ains-config-'));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ tokens: { reddit: { username: 'config-fixture-user' } } }),
    );
    vi.stubEnv('AINS_HOME', dir);
    vi.stubEnv('AINS_REDDIT_USERNAME', 'env-fixture-user');

    expect(loadConfig().tokens.reddit.username).toBe('env-fixture-user');
  });

  it('손상된 config 원문을 파싱 실패 로그에 노출하지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ains-config-'));
    tempDirs.push(dir);
    const marker = 'private-config-fragment-marker';
    writeFileSync(join(dir, 'config.json'), `{"token":"${marker}", BAD`);
    vi.stubEnv('AINS_HOME', dir);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    loadConfig();

    expect(JSON.stringify(warn.mock.calls)).not.toContain(marker);
  });
});
