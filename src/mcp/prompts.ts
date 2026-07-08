import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function userMessage(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

/** 트렌드/브리핑 관련 MCP 프롬프트를 등록한다. (학습 프롬프트는 S4에서 추가) */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'trend-briefing',
    {
      description: '최신 AI 트렌드를 조회해 구조화된 브리핑을 작성하도록 안내합니다.',
      argsSchema: { focus: z.string().optional() },
    },
    ({ focus }) => {
      const focusLine = focus
        ? `특히 "${focus}" 주제에 초점을 맞추고, 필요하면 search_news도 사용하십시오.`
        : '';
      return userMessage(
        [
          'get_trends 도구를 호출해 최신 AI 소식을 가져오십시오.',
          focusLine,
          '결과를 다음 구조로 요약하십시오:',
          '1) 오늘의 핵심 3가지(제목 + 왜 중요한지 한 줄)',
          '2) 카테고리별 정리(공식 업데이트 / 핫레포 / 논문 / 커뮤니티)',
          '3) 더 깊이 볼 만한 항목 1개와 그 이유',
          '각 항목에는 출처 URL을 함께 표기하십시오.',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    },
  );
}
