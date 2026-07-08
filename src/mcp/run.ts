import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../core/config.js';
import { openDb } from '../core/db/connection.js';
import { registerTools } from './tools.js';
import { registerPrompts } from './prompts.js';

/**
 * MCP(stdio) 서버를 시작한다. stdout은 전송로이므로 이 경로에서 어떤 것도 stdout에
 * 직접 쓰지 않는다(로그는 stderr, logger 사용).
 */
export async function startMcpServer(): Promise<void> {
  const db = openDb();
  const config = loadConfig();
  // tsup 빌드에서는 define으로 치환된다. tsx 등 define 없는 실행에선 fallback을 쓴다.
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';
  const server = new McpServer({ name: 'ai-news-supplier', version });
  registerTools(server, { db, config });
  registerPrompts(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
