import { Command } from 'commander';

const program = new Command();

program
  .name('ains')
  .description('AI 소식을 수집해 로컬에 축적하고 MCP/CLI로 LLM 에이전트에 공급하는 도구')
  .version(__APP_VERSION__, '-v, --version', '버전을 출력합니다');

program.parse();
