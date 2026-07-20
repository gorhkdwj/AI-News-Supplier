import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cliSrc = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));
let home: string;

/** 실제 비밀정보가 아닌, 테스트 전용 더미 값(계약 §1: 실제 토큰을 fixture에 넣지 않는다). */
const FAKE = {
  github: 'test-fake-github-token-not-a-secret',
  clientId: 'test-fake-client-id',
  clientSecret: 'test-fake-client-secret',
  username: 'test-fake-username',
};

function runConfigShow(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', cliSrc, 'config', 'show', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AINS_HOME: home,
      GITHUB_TOKEN: FAKE.github,
      AINS_REDDIT_CLIENT_ID: FAKE.clientId,
      AINS_REDDIT_CLIENT_SECRET: FAKE.clientSecret,
      AINS_REDDIT_USERNAME: FAKE.username,
      ...env,
    },
    timeout: 30_000,
  });
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'ains-cli-config-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ retentionDays: 45 }));
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('config show 토큰 마스킹 (B-017)', () => {
  it('설정된 토큰 값을 출력하지 않는다', () => {
    const result = runConfigShow([]);
    expect(result.status).toBe(0);
    for (const value of Object.values(FAKE)) {
      expect(result.stdout).not.toContain(value);
    }
  });

  it('설정 여부는 알 수 있도록 마스킹 표시로 대체한다', () => {
    const result = runConfigShow([]);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.tokens.github).toBe('***');
    expect(parsed.tokens.reddit.clientId).toBe('***');
    expect(parsed.tokens.reddit.clientSecret).toBe('***');
    expect(parsed.tokens.reddit.username).toBe('***');
  });

  it('설정되지 않은 값은 null로 유지해 미설정과 구분한다', () => {
    const result = runConfigShow([], {
      GITHUB_TOKEN: '',
      AINS_REDDIT_CLIENT_ID: '',
      AINS_REDDIT_CLIENT_SECRET: '',
      AINS_REDDIT_USERNAME: '',
    });
    const parsed = JSON.parse(result.stdout);
    expect(parsed.tokens.github).toBeNull();
    expect(parsed.tokens.reddit.clientId).toBeNull();
  });

  it('토큰 이외의 설정은 그대로 출력한다', () => {
    const result = runConfigShow([]);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.retentionDays).toBe(45);
    expect(parsed.sources.hackernews.enabled).toBe(true);
  });

  it('--reveal을 명시하면 원값을 출력한다', () => {
    const result = runConfigShow(['--reveal']);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.tokens.github).toBe(FAKE.github);
    expect(parsed.tokens.reddit.clientSecret).toBe(FAKE.clientSecret);
  });

  it('--reveal은 stdout을 오염시키지 않도록 경고를 stderr로 낸다', () => {
    const result = runConfigShow(['--reveal']);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stderr).toContain('비밀정보');
  });
});
