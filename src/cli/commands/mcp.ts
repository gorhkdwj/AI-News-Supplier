import type { Command } from 'commander';
import { startMcpServer } from '../../mcp/run.js';

export function registerMcp(program: Command): void {
  program
    .command('mcp')
    .description('MCP(stdio) 서버를 실행합니다(에이전트 연동용)')
    .action(async () => {
      await startMcpServer();
    });
}
