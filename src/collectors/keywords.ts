/**
 * AI 관련성 판정용 시드 키워드. 데이터로 관리해 config.extraKeywords로 확장 가능.
 * (요구사항 계약 문서: HN/DEV.to 등 범용 소스에 적용)
 */
export const BASE_KEYWORDS: readonly string[] = [
  'ai',
  'a.i.',
  'llm',
  'gpt',
  'claude',
  'gemini',
  'llama',
  'mistral',
  'deepseek',
  'qwen',
  'openai',
  'anthropic',
  'transformer',
  'diffusion',
  'rag',
  'agent',
  'agents',
  'agentic',
  'mcp',
  'fine-tune',
  'fine-tuning',
  'finetune',
  'embedding',
  'inference',
  'cuda',
  'prompt',
  'multimodal',
  'machine learning',
  'deep learning',
  'neural',
  'chatbot',
  'copilot',
  'hugging face',
  'stable diffusion',
  'vision model',
  'text-to-image',
  'text-to-video',
];

function buildMatcher(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 단어 경계 매칭. 공백/하이픈을 포함한 키워드도 그대로 처리한다.
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu');
}

let cachedMatchers: { keywords: readonly string[]; matchers: RegExp[] } | null = null;

/** 텍스트가 AI 관련 키워드를 하나라도 포함하는지 판정한다. */
export function isAiRelevant(text: string, extraKeywords: readonly string[] = []): boolean {
  const all = extraKeywords.length > 0 ? [...BASE_KEYWORDS, ...extraKeywords] : BASE_KEYWORDS;
  if (!cachedMatchers || cachedMatchers.keywords !== all) {
    cachedMatchers = { keywords: all, matchers: all.map(buildMatcher) };
  }
  return cachedMatchers.matchers.some((re) => re.test(text));
}
