import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { openDb } from '../../src/core/db/connection.js';

const cliSrc = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));
let home: string;

function runDoctor(env: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', cliSrc, 'doctor'], {
    encoding: 'utf8',
    env: { ...process.env, AINS_HOME: home, GITHUB_TOKEN: '', ...env },
    timeout: 30_000,
  });
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'ains-cli-doctor-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({}));
  openDb(join(home, 'data.db')).close();
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('doctor GitHub 토큰 진단 (B-009)', () => {
  it('토큰이 없으면 rate limit 경고와 발급 안내를 출력한다', () => {
    const result = runDoctor({});
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('GitHub 토큰 : 없음');
    expect(result.stdout).toContain('60회');
    expect(result.stdout).toContain('github.com/settings/tokens');
  });

  it('토큰이 있으면 설정됨으로 표시하고 값은 절대 노출하지 않는다', () => {
    const fakeToken = 'test-fake-token-not-a-secret';
    const result = runDoctor({ GITHUB_TOKEN: fakeToken });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('GitHub 토큰 : 설정됨');
    expect(result.stdout).not.toContain(fakeToken);
    expect(result.stdout).not.toContain('github.com/settings/tokens');
  });
});
