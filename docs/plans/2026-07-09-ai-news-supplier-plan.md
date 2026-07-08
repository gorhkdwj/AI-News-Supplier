# ai-news-supplier (`ains`) 구현 계획

> 작성일: 2026-07-09
> 상태: 확정 (기존 AI Product Lab PRD 전면 폐기 후 방향 전환)

## Context

기존 `docs/PRD`의 "AI Product Lab"(PM 특화 학습 서비스) 계획을 전면 폐기하고 방향을 전환한다.
새 제품은 **로컬 우선 오픈소스 도구**로:

1. **수집**: API/RSS로 커뮤니티(HN, Reddit, DEV.to), 공식 업데이트(벤더 블로그 RSS), 핫레포(GitHub), 핫모델/논문(Hugging Face, arXiv)을 수집
2. **공급**: 수집·정규화된 데이터를 **MCP(stdio) + CLI**로 사용자의 LLM 에이전트에 공급
3. **학습**: 도구 자체는 LLM을 호출하지 않고, 학습 가치가 높은 토픽을 룰 기반으로 발굴해 **맥락 자료 + 지시문 패키지**를 에이전트에 건네 학습 세션을 설계하게 함

### 확정된 결정 사항

- 실사용 개인/공개 도구 (해커톤 제출용 아님)
- 로컬 실행 + 로컬 SQLite 축적 (`~/.ai-news-supplier/data.db`), 코어/통로 분리(향후 호스팅 전환 가능 구조)
- 소스는 최대한 구현: HN, GitHub, 공식 RSS, HF, arXiv, DEV.to + Reddit(사용자 OAuth 키 입력 시에만 활성화)
- 수집 트리거: 신선도(TTL) 기반 온디맨드 갱신 + 선택적 OS 스케줄러 등록(`ains schedule install`)
- 학습 기능: 후보 발굴 + 지시문 패키징 + 학습 이력 DB (자체 LLM 호출 없음)
- 스택: TypeScript/Node ≥20, ESM, 패키지명 `ai-news-supplier`, CLI `ains`

## 아키텍처 / 패키지 구조

단일 npm 패키지. `src/core`는 `src/cli`/`src/mcp`를 절대 import하지 않음(eslint no-restricted-imports로 강제).

```
src/
├── core/                  # 재사용 가능한 코어 (호스팅 전환 시 그대로 추출)
│   ├── types.ts           # NewsItem, ItemType, TopicCluster 등
│   ├── config.ts paths.ts # zod 검증 설정, AINS_HOME 해석
│   ├── db/                # better-sqlite3 연결(WAL), 번호형 마이그레이션
│   ├── store/             # itemStore(upsert/dedup/FTS), fetchLog, learningStore
│   ├── http.ts            # fetch 래퍼: timeout, retry, ETag 조건부 GET
│   ├── normalize.ts       # canonical URL(utm 제거 등) + sha256 id
│   ├── refresh.ts         # TTL 오케스트레이터 (핵심 동작)
│   ├── rank.ts            # hotness 점수
│   ├── learning/          # topics(용어 추출), candidates(클러스터링/스코어), session(지시문 조립)
│   └── logger.ts          # stderr 전용 (stdout은 MCP 전송로)
├── collectors/            # 플러그인형 수집기: types.ts(계약), registry.ts, keywords.ts,
│                          # hackernews, github, rss, huggingface, arxiv, devto, reddit
├── mcp/                   # server.ts(stdio), tools.ts, prompts.ts
├── cli/                   # commander 기반: index.ts, commands/*, format.ts
└── scheduler/             # windows.ts(schtasks), unix.ts(crontab)
```

bin: `{ "ains": "dist/cli/index.js", "ains-mcp": "dist/mcp/server.js" }` (`ains mcp`도 동일 서버 실행)

## SQLite 스키마 (요지)

- `items`: id(=sha256(canonical_url) 앞 16자), source, type(`community|official_update|hot_repo|model|paper|article`), title, url, canonical_url(UNIQUE), summary, author, score, comments_count, tags(JSON), published_at, first_seen_at, last_seen_at, raw(JSON)
- `items_fts`: FTS5 external-content(title, summary, tags) + 동기화 트리거 3종
- `score_history`: (item_id, observed_at, score) — 급상승(velocity) 감지용, 항목당 최근 20개 유지
- `source_state`: 소스별 last_success_at, etag, last_modified, consecutive_failures
- `fetch_log`: 수집 실행 감사 로그 (doctor/디버깅용)
- `learning_history`: topic, normalized_topic, learned_at, level, notes, item_ids(JSON)
- upsert: `ON CONFLICT(canonical_url) DO UPDATE` — first_seen_at 보존, 휘발 필드 갱신, 점수 변화 시 score_history 기록
- 보존 정책: retentionDays(기본 90) 초과 항목 삭제(학습 이력이 참조하는 항목은 보존)

## 수집기 계약 + 소스별 요점

```ts
interface Collector {
  name: string;                      // 'hackernews', 'rss:openai', ...
  defaultTtlMinutes: number;
  isEnabled(config): boolean;        // false → 에러 아닌 비활성 (Reddit 키 없을 때)
  fetch(ctx: FetchContext): Promise<CollectorResult>;
}
```

- 오케스트레이터(`refresh.ts`): TTL 미경과 소스 skip → `Promise.allSettled`(동시 4개, 소스당 30s 타임아웃) → **한 소스 실패가 전체를 절대 깨지 않음** → 실패 3회 연속 시 TTL×4 백오프
- AI 관련성 필터(`keywords.ts`): HN/DEV.to 등 범용 소스에 키워드 목록(데이터로 관리, config `extraKeywords`로 확장) 적용
- 소스별:
  - **Hacker News**: Algolia 검색 API, 키 불필요
  - **GitHub**: search/repositories API, 토큰 선택(한도 확대)
  - **RSS**: 피드별 개별 수집기 인스턴스 + ETag/Last-Modified 조건부 GET. 기본 피드: OpenAI, Google DeepMind, Google AI, Meta AI, HF 블로그 (설정으로 추가/교체 가능)
  - **Hugging Face**: trending models + daily_papers, 키 불필요
  - **arXiv**: Atom API(cs.AI/cs.CL/cs.LG), 버전 접미사 제거 dedup
  - **DEV.to**: 태그 기반(ai, machinelearning, llm) + 반응수 임계값
  - **Reddit**: client_credentials OAuth — 사용자 키가 있을 때만 활성화

## 랭킹 / 학습 후보 발굴 (룰 기반, LLM 미사용)

- **hotness** = 소스 내 percentile 정규화 × 시간감쇠(반감기 ~25h) × 타입 부스트(공식 1.2, 레포 1.1). 쿼리 시점 JS 계산. 상위 N에서 소스당 최대 ~40% 인터리브
- **학습 후보**: 제목/태그에서 용어 추출(내장 엔티티 사전 ~150개 + 대문자 패턴 + 별칭 맵, 범용어 블록리스트) → 용어별 클러스터링(60% 겹침 병합) → `learnScore = novelty × (2×sourceSpread + hotSum + velocity + ln(1+itemCount))`. novelty는 learning_history 기준(90일 내 학습 시 0.15)
- **세션 설계**: FTS로 30일 증거 수집 → 유형별 버킷(공식/논문/레포/토론) → 고정 지시문 템플릿(브리핑→개념→실습→확인문제→추가자료→record_learning 안내, level/time_budget 파라미터)

## MCP 표면

도구 9종 (모두 호출 전 `refreshStale()` 수행, zod 입력 스키마, structuredContent 반환):

| 도구 | 역할 |
|---|---|
| `get_trends` | 기간/소스/유형 필터로 hotness 순 트렌드 반환 |
| `search_news` | FTS5 전문 검색 |
| `get_item` | 항목 상세(raw, score_history 포함) |
| `refresh_sources` | 수동 수집 트리거 |
| `get_source_status` | 소스별 상태/건강도 |
| `get_learning_candidates` | 학습 가치 높은 토픽 클러스터 + 근거 자료 |
| `design_learning_session` | 토픽 맥락 자료 + 학습 세션 설계 지시문 패키지 |
| `record_learning` | 학습 이력 기록 |
| `get_learning_history` | 학습 이력 조회 |

프롬프트 3종: `learn-today`(후보 제시→선택→세션 실행→기록), `trend-briefing`, `deep-dive`

## CLI

```
ains trends|search|show|fetch [--force]
ains learn [candidates|session <topic>|record <topic>]
ains history
ains config path|get|set|edit
ains schedule install [--every 60]|uninstall|status
ains mcp        # MCP 서버 실행
ains doctor     # 환경/DB/소스 연결 점검
```

전역: `--json`, `AINS_HOME` 환경변수(테스트 격리용)

## 설정 (`~/.ai-news-supplier/config.json`)

기본값에 sparse 오버라이드 deep-merge, zod 검증. 주요 키: retentionDays, defaultTtlMinutes, 소스별 `{enabled, ttlMinutes, ...}`, `rss.feeds[]`(id 기준 병합), `tokens.github`/`tokens.reddit`(env 변수 우선), `learning.defaultLevel`

## 기술 선택

tsup(bin별 단일 번들, better-sqlite3는 external), better-sqlite3 v12(win32-x64 프리빌드 확인, doctor에서 로드 검증), @modelcontextprotocol/sdk(버전 고정), commander, rss-parser + fast-xml-parser(arXiv Atom), zod, 내장 fetch, vitest, eslint+prettier

## 구현 단계

| 단계 | 내용 | 검증 |
|---|---|---|
| 0 스캐폴드 | package.json, tsconfig, tsup, vitest, 빈 CLI | `npm run build && node dist/cli/index.js --version` |
| 1 워킹 스켈레톤 | DB/마이그레이션/스토어/정규화/설정/http/수집기 계약/refresh + **HN 수집기** + CLI trends/fetch/search/show/doctor | `ains fetch`→DB 생성, `ains trends` 랭킹 출력, 2회 실행 시 dedup+TTL skip, 단위테스트 |
| 2 수집기 완성 | github/rss/hf/arxiv/devto/reddit, keywords, score_history, rank 완성 | 소스별 fixture 테스트, 고장 소스 1개에도 나머지 성공(핵심 수용 기준) |
| 3 MCP 서버 | tools/prompts/server, stdout 위생 감사 | SDK Client stdio 스모크 테스트, Claude Code에 등록해 실사용 확인 |
| 4 학습 기능 | topics/candidates/session, learningStore, 학습 도구 4종+프롬프트, CLI learn/history | 합성 DB에서 3소스 등장 토픽이 최상위 후보, 기록 후 후보 제외, learn-today E2E |
| 5 마무리 | schedule(win32 우선→cron), retention, doctor 완성, README, npm publish 준비 | schtasks 등록/실행/해제 확인, `npm pack` 클린 설치 후 doctor 전부 green |

## 테스트 전략

- 수집기: 녹화된 fixture(JSON/XML)를 주입한 HttpClient 스텁으로 매핑/필터/304/파싱오류 검증
- 스토어: `:memory:` DB, 마이그레이션 멱등성, upsert 충돌 경로, FTS 트리거 동기화, retention의 학습 참조 보존
- 랭킹/후보: now 주입한 결정적 합성 데이터
- 오케스트레이터: 고장 수집기 + 정상 수집기 혼합 → 부분 성공 확인
- MCP: 임시 AINS_HOME + 사전 시드 DB로 stdio 통합 스모크
- CI: GitHub Actions windows+ubuntu × Node 20/22 (Windows는 better-sqlite3 프리빌드 카나리)
- 라이브 네트워크 테스트는 CI 제외(수동 태그)

## 구현 시 재확인 항목

- RSS 피드 URL 실물 검증(특히 Meta AI/Google) — 피드별 오류 격리로 드리프트는 우아하게 저하
- HF `trendingScore` 정렬 파라미터, `daily_papers` 응답 형태 라이브 재확인
- arXiv 버전 접미사 제거 dedup
- MCP SDK 버전 고정, 등록 코드를 tools.ts 한 곳에 격리

## 핵심 파일

- `src/core/db/migrations.ts` — 스키마 DDL+버전 관리 (모든 것의 기반)
- `src/collectors/types.ts` — 수집기 플러그인 계약
- `src/core/refresh.ts` — TTL 오케스트레이션 + 실패 격리 (제품 핵심 동작)
- `src/core/learning/candidates.ts` — 차별화 기능(학습 후보 발굴)
- `src/mcp/tools.ts` — 에이전트 대면 도구 표면
