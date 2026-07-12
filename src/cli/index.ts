import { Command } from 'commander';
import { registerTrends } from './commands/trends.js';
import { registerFetch } from './commands/fetch.js';
import { registerSearch } from './commands/search.js';
import { registerShow } from './commands/show.js';
import { registerDoctor } from './commands/doctor.js';
import { registerMcp } from './commands/mcp.js';
import { registerLearn } from './commands/learn.js';
import { registerHistory } from './commands/history.js';
import { registerSchedule } from './commands/schedule.js';
import { registerConfig } from './commands/config.js';
import { maybeNotifyUpdate } from './updateNotice.js';

const program = new Command();
const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';

program
  .name('ains')
  .description('AI 소식을 수집해 로컬에 축적하고 MCP/CLI로 LLM 에이전트에 공급하는 도구')
  .version(version, '-v, --version', '버전을 출력합니다');

registerTrends(program);
registerFetch(program);
registerSearch(program);
registerShow(program);
registerDoctor(program);
registerMcp(program);
registerLearn(program);
registerHistory(program);
registerSchedule(program);
registerConfig(program);

// MCP 서버로 뜰 때는 업데이트 안내를 포함해 어떤 부가 출력도 하지 않는다.
const isMcpProcess = process.argv[2] === 'mcp';

program
  .parseAsync()
  .then(() => (isMcpProcess ? undefined : maybeNotifyUpdate(version)))
  .catch((err: unknown) => {
    process.stderr.write(`오류: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
