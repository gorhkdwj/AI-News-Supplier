/**
 * 제목/태그에서 학습 토픽 후보 용어를 추출한다. LLM을 쓰지 않는 룰 기반.
 * 엔티티 사전/별칭/블록리스트는 데이터로 관리해 확장하기 쉽게 둔다.
 */

// 알려진 엔티티(소문자). 멀티워드 포함. 필요에 따라 계속 확장 가능.
const ENTITY_DICT: readonly string[] = [
  // 모델/제품
  'gpt', 'claude', 'gemini', 'llama', 'mistral', 'mixtral', 'qwen', 'deepseek', 'phi', 'grok',
  'command r', 'sora', 'dall-e', 'stable diffusion', 'flux', 'whisper', 'sam', 'segment anything',
  // 기법/개념
  'rag', 'lora', 'qlora', 'moe', 'mixture of experts', 'rlhf', 'dpo', 'ppo', 'grpo',
  'fine-tuning', 'quantization', 'distillation', 'speculative decoding', 'chain of thought',
  'mcp', 'model context protocol', 'function calling', 'tool calling', 'embeddings',
  'vector search', 'prompt engineering', 'agentic', 'agent', 'multimodal', 'diffusion',
  'transformer', 'attention', 'flash attention', 'kv cache', 'context window', 'reasoning',
  'reinforcement learning', 'test-time compute', 'world model',
  // 프레임워크/도구
  'langchain', 'llamaindex', 'vllm', 'ollama', 'transformers', 'pytorch', 'tensorflow', 'jax',
  'cuda', 'triton', 'tensorrt', 'comfyui', 'autogen', 'crewai', 'langgraph', 'dspy',
];

// 정규화 별칭. 왼쪽(정규화된 형태) → 오른쪽(대표 형태)
const ALIASES: Record<string, string> = {
  'mixture of experts': 'moe',
  'model context protocol': 'mcp',
  'chain of thought': 'cot',
  'reinforcement learning from human feedback': 'rlhf',
  'segment anything': 'sam',
  agents: 'agent',
};

// 너무 흔해 클러스터를 오염시키는 일반어. 토픽에서 제외한다.
const BLOCKLIST = new Set([
  'ai', 'a.i.', 'model', 'models', 'llm', 'llms', 'open source', 'opensource', 'github',
  'paper', 'papers', 'new', 'release', 'released', 'using', 'guide', 'tutorial', 'ml',
  'api', 'data', 'code', 'app', 'the', 'introducing', 'show hn', 'ask hn', 'how', 'why',
  'machine learning', 'deep learning', 'neural', 'network', 'system', 'tool', 'tools',
]);

export interface ExtractedTerm {
  normalized: string;
  display: string;
}

/** 문자열을 정규화한다(소문자, 공백 정리, 별칭 적용). 토픽 키로 쓴다. */
export function normalizeTopic(raw: string): string {
  let s = raw.toLowerCase().trim().replace(/\s+/g, ' ');
  s = s.replace(/[.,;:!?()[\]{}"']/g, '').trim();
  return ALIASES[s] ?? s;
}

function isMeaningful(normalized: string): boolean {
  if (normalized.length < 3) return false;
  if (BLOCKLIST.has(normalized)) return false;
  return true;
}

function addTerm(map: Map<string, string>, display: string): void {
  const normalized = normalizeTopic(display);
  if (!isMeaningful(normalized)) return;
  if (!map.has(normalized)) map.set(normalized, display.trim());
}

// 버전형 토큰(문자+숫자 조합, 예: GPT-5, Llama4, Qwen2.5, o3)
const VERSIONED = /\b[A-Za-z][A-Za-z]*[-.]?\d[\w.]*\b/g;

/** 제목과 태그에서 의미 있는 토픽 용어를 추출한다(중복 제거). */
export function extractTerms(title: string, tags: readonly string[]): ExtractedTerm[] {
  const found = new Map<string, string>();

  for (const tag of tags) {
    // arXiv 분류 코드(cs.AI, stat.ML 등)는 학습 토픽이 아니므로 제외한다.
    if (/^(cs|stat|eess|math|q-bio|econ|physics)\.[a-z]{2}$/i.test(tag)) continue;
    addTerm(found, tag);
  }

  const lower = ` ${title.toLowerCase()} `;
  for (const entity of ENTITY_DICT) {
    // 단어 경계 매칭
    if (lower.includes(` ${entity} `) || lower.includes(` ${entity}s `) || lower.includes(`${entity}`)) {
      const re = new RegExp(`(^|[^a-z0-9])${entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
      if (re.test(title)) addTerm(found, entity);
    }
  }

  const versioned = title.match(VERSIONED);
  if (versioned) for (const v of versioned) addTerm(found, v);

  return [...found.entries()].map(([normalized, display]) => ({ normalized, display }));
}
