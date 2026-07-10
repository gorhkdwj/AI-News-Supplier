import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { getConfigPath } from './paths.js';
import { logger } from './logger.js';

/** 기본 RSS 피드 목록. 구현 시점에 URL 실물 재확인 대상(계획서). */
export const DEFAULT_FEEDS = [
  { id: 'openai', title: 'OpenAI News', url: 'https://openai.com/news/rss.xml' },
  { id: 'deepmind', title: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
  { id: 'googleai', title: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/' },
  { id: 'hfblog', title: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml' },
  {
    id: 'claude-code',
    title: 'Claude Code Changelog',
    url: 'https://raw.githubusercontent.com/anthropics/claude-code/main/feed.xml',
  },
  { id: 'cursor', title: 'Cursor Changelog', url: 'https://cursor.com/changelog/rss.xml' },
  {
    id: 'figma',
    title: 'Figma Release Notes',
    url: 'https://www.figma.com/release-notes/feed/atom.xml',
  },
];

const RssFeedSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
});

const ConfigSchema = z.object({
  /** 이 일수보다 오래된 항목은 정리한다. null이면 영구 보존. */
  retentionDays: z.number().int().positive().nullable().default(90),
  defaultTtlMinutes: z.number().int().positive().default(60),
  /** 상위 결과에서 단일 소스가 차지할 최대 비율(0~1). */
  maxPerSourceRatio: z.number().min(0).max(1).default(0.4),
  /** AI 관련성 필터에 추가할 사용자 키워드. */
  extraKeywords: z.array(z.string()).default([]),
  sources: z
    .object({
      hackernews: z
        .object({
          enabled: z.boolean().default(true),
          ttlMinutes: z.number().int().positive().default(30),
          minPoints: z.number().int().min(0).default(10),
        })
        .prefault({}),
      github: z
        .object({
          enabled: z.boolean().default(true),
          ttlMinutes: z.number().int().positive().default(120),
        })
        .prefault({}),
      huggingface: z
        .object({
          enabled: z.boolean().default(true),
          ttlMinutes: z.number().int().positive().default(120),
        })
        .prefault({}),
      arxiv: z
        .object({
          enabled: z.boolean().default(true),
          ttlMinutes: z.number().int().positive().default(360),
          categories: z.array(z.string()).default(['cs.AI', 'cs.CL', 'cs.LG']),
        })
        .prefault({}),
      devto: z
        .object({
          enabled: z.boolean().default(true),
          ttlMinutes: z.number().int().positive().default(180),
          tags: z.array(z.string()).default(['ai', 'machinelearning', 'llm']),
          minReactions: z.number().int().min(0).default(10),
        })
        .prefault({}),
      reddit: z
        .object({
          enabled: z.boolean().default(true),
          ttlMinutes: z.number().int().positive().default(60),
          subreddits: z.array(z.string()).default(['MachineLearning', 'LocalLLaMA', 'artificial']),
        })
        .prefault({}),
      rss: z
        .object({
          enabled: z.boolean().default(true),
          ttlMinutes: z.number().int().positive().default(120),
          feeds: z.array(RssFeedSchema).default(DEFAULT_FEEDS),
        })
        .prefault({}),
    })
    .prefault({}),
  tokens: z
    .object({
      github: z.string().nullable().default(null),
      reddit: z
        .object({
          clientId: z.string().nullable().default(null),
          clientSecret: z.string().nullable().default(null),
        })
        .prefault({}),
    })
    .prefault({}),
  learning: z
    .object({
      defaultLevel: z.enum(['beginner', 'intermediate', 'advanced']).default('intermediate'),
      relearnAfterDays: z.number().int().positive().default(90),
    })
    .prefault({}),
});

export type ResolvedConfig = z.infer<typeof ConfigSchema>;
export type RssFeed = z.infer<typeof RssFeedSchema>;

/**
 * 설정을 로드한다. 파일이 없거나 손상되면 기본값으로 폴백한다.
 * 토큰은 환경변수가 config 파일보다 우선한다.
 */
export function loadConfig(): ResolvedConfig {
  const path = getConfigPath();
  let userRaw: unknown = {};

  if (existsSync(path)) {
    try {
      userRaw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      logger.warn(`설정 파일 파싱 실패, 기본값 사용: ${path}`, String(err));
      userRaw = {};
    }
  }

  const parsed = ConfigSchema.safeParse(userRaw);
  let config: ResolvedConfig;
  if (parsed.success) {
    config = parsed.data;
  } else {
    logger.warn('설정 검증 실패, 기본값으로 폴백합니다.', parsed.error.issues);
    config = ConfigSchema.parse({});
  }

  return applyEnvOverrides(config);
}

/** 환경변수 토큰을 config에 덮어쓴다(env 우선). */
function applyEnvOverrides(config: ResolvedConfig): ResolvedConfig {
  const githubToken = process.env.GITHUB_TOKEN;
  if (githubToken) config.tokens.github = githubToken;

  const redditId = process.env.AINS_REDDIT_CLIENT_ID;
  const redditSecret = process.env.AINS_REDDIT_CLIENT_SECRET;
  if (redditId) config.tokens.reddit.clientId = redditId;
  if (redditSecret) config.tokens.reddit.clientSecret = redditSecret;

  return config;
}

/** 기본 설정 객체를 반환한다(설정 파일 생성용). */
export function defaultConfig(): ResolvedConfig {
  return ConfigSchema.parse({});
}
