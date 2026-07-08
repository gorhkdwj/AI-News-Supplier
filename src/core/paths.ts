import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 데이터 디렉터리. 기본은 사용자 홈의 ~/.ai-news-supplier/.
 * 테스트 격리를 위해 환경변수 AINS_HOME으로 오버라이드할 수 있다.
 */
export function getDataDir(): string {
  const override = process.env.AINS_HOME;
  return override && override.length > 0 ? override : join(homedir(), '.ai-news-supplier');
}

export function getDbPath(): string {
  return join(getDataDir(), 'data.db');
}

export function getConfigPath(): string {
  return join(getDataDir(), 'config.json');
}

export function getConfigExamplePath(): string {
  return join(getDataDir(), 'config.example.json');
}
