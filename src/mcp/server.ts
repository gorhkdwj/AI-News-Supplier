import { startMcpServer } from './run.js';

startMcpServer().catch((err: unknown) => {
  process.stderr.write(`MCP 서버 오류: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
