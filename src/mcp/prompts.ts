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

  server.registerPrompt(
    'learn-today',
    {
      description: '오늘 학습할 만한 AI 토픽을 추천받아 학습 세션을 진행하도록 안내합니다.',
      argsSchema: { level: z.string().optional(), time_budget_minutes: z.string().optional() },
    },
    ({ level, time_budget_minutes }) => {
      const lv = level ?? 'intermediate';
      const budget = time_budget_minutes ?? '45';
      return userMessage(
        [
          'get_learning_candidates 도구를 호출해 학습 후보를 가져오십시오.',
          '상위 3개를 각각의 why(추천 이유)와 함께 사용자에게 제시하고 하나를 고르게 하십시오.',
          `사용자가 고르면 design_learning_session(topic, level="${lv}", time_budget_minutes=${budget})을 호출하십시오.`,
          '반환된 instructions와 context에 따라 학습 세션을 진행하십시오.',
          '학습이 끝나면 record_learning으로 해당 토픽을 기록하십시오.',
        ].join('\n'),
      );
    },
  );

  server.registerPrompt(
    'deep-dive',
    {
      description: '이미 아는 특정 토픽으로 바로 학습 세션을 시작합니다.',
      argsSchema: { topic: z.string() },
    },
    ({ topic }) =>
      userMessage(
        [
          `design_learning_session(topic="${topic}") 도구를 호출하십시오.`,
          '반환된 instructions와 context에 따라 학습 세션을 진행하십시오.',
          '학습이 끝나면 record_learning으로 기록하십시오.',
        ].join('\n'),
      ),
  );
}
