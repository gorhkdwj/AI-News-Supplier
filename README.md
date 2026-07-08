# ai-news-supplier (`ains`)

> AI 소식(커뮤니티·공식 업데이트·핫레포·핫모델·논문)을 수집해 로컬에 축적하고, **MCP와 CLI로 LLM 에이전트에 공급**하는 로컬 우선 도구.
> 부가로, 학습 가치가 높은 토픽을 발굴해 에이전트가 학습 세션을 설계하도록 돕습니다.

로컬에서 동작하며 서버·계정이 필요 없습니다. 데이터는 사용자 홈(`~/.ai-news-supplier/`)의 SQLite에 쌓입니다. 도구 자체는 LLM을 호출하지 않습니다 — 지능은 사용자의 에이전트가 담당하고, 이 도구는 좋은 재료(데이터)와 지시문을 공급합니다.

## 수집 소스

| 소스 | 유형 | 인증 |
|---|---|---|
| Hacker News | 커뮤니티 | 불필요 |
| GitHub | 핫레포 | 불필요(토큰 있으면 한도↑) |
| 공식 블로그 RSS (OpenAI, DeepMind, Google AI, Hugging Face…) | 공식 업데이트 | 불필요 |
| Hugging Face | 핫모델·논문 | 불필요 |
| arXiv | 논문 | 불필요 |
| DEV.to | 커뮤니티 | 불필요 |
| Reddit | 커뮤니티 | OAuth 키 입력 시에만 활성화 |

한 소스가 실패해도 나머지 수집과 조회는 정상 동작합니다.

## 설치와 빌드

Node ≥ 20 필요. 현재는 소스에서 빌드해 사용합니다(npm 배포는 준비 중).

```bash
git clone https://github.com/gorhkdwj/AI-News-Supplier.git
cd AI-News-Supplier
npm install
npm run build
```

빌드하면 `dist/cli/index.js`(CLI)와 `dist/mcp/server.js`(MCP 서버)가 생성됩니다.

## CLI 사용법

```bash
# 최신 소식 수집(로컬 DB에 축적)
node dist/cli/index.js fetch

# 트렌드를 화제성(hotness) 순으로 보기
node dist/cli/index.js trends --limit 20
node dist/cli/index.js trends --source hackernews,github --type paper --hours 48

# 전문 검색
node dist/cli/index.js search "mixture of experts"

# 항목 상세
node dist/cli/index.js show <id>

# 학습 후보 → 세션 설계 → 기록
node dist/cli/index.js learn                       # 학습 가치 높은 토픽 후보
node dist/cli/index.js learn session "rag"         # 세션 지시문 생성
node dist/cli/index.js learn record "rag"          # 학습 이력 기록
node dist/cli/index.js history                     # 학습 이력

# 환경·DB·소스 상태 점검
node dist/cli/index.js doctor
```

모든 조회 명령은 `--json`으로 기계 판독 출력을 지원합니다. `fetch`는 신선도(TTL) 기반으로, 최근에 수집한 소스는 건너뜁니다. `--force`로 강제 수집합니다.

## MCP 서버 (에이전트 연동)

Claude Code 등 MCP 클라이언트에 등록하면 에이전트가 소식을 직접 조회하고 학습 세션을 진행할 수 있습니다.

```bash
claude mcp add ains -- node /절대경로/AI-News-Supplier/dist/mcp/server.js
```

제공 도구:

| 도구 | 설명 |
|---|---|
| `get_trends` | 화제성 순 트렌드 |
| `search_news` | 전문 검색 |
| `get_item` | 항목 상세(raw·점수 이력) |
| `refresh_sources` | 수동 수집 |
| `get_source_status` | 소스별 상태 |
| `get_learning_candidates` | 학습 가치 높은 토픽 + 근거 자료 |
| `design_learning_session` | 토픽 학습 세션 지시문 + 맥락 자료 |
| `record_learning` | 학습 이력 기록 |
| `get_learning_history` | 학습 이력 조회 |

제공 프롬프트: `trend-briefing`, `learn-today`, `deep-dive`.

## 자동 수집 (선택)

OS 스케줄러(Windows 작업 스케줄러 / unix cron)에 주기적 수집을 등록할 수 있습니다.

```bash
node dist/cli/index.js schedule install --every 60   # 60분마다
node dist/cli/index.js schedule status
node dist/cli/index.js schedule uninstall
```

## 설정

설정 파일은 `~/.ai-news-supplier/config.json`입니다.

```bash
node dist/cli/index.js config init   # 예제(config.example.json)와 설정 파일 생성
node dist/cli/index.js config show   # 현재 유효 설정 출력
node dist/cli/index.js config edit   # 편집기로 열기
```

주요 항목: `retentionDays`(보존 기간), 소스별 `enabled`/`ttlMinutes`, `rss.feeds`(피드 추가), `tokens.github`·`tokens.reddit`(또는 환경변수 `GITHUB_TOKEN`, `AINS_REDDIT_CLIENT_ID`/`AINS_REDDIT_CLIENT_SECRET`). 환경변수가 설정 파일보다 우선합니다.

## 데이터와 프라이버시

- 모든 데이터는 로컬 `~/.ai-news-supplier/data.db`에만 저장됩니다(환경변수 `AINS_HOME`로 변경 가능).
- 외부에는 공개 API·RSS 요청만 보내며, 토큰은 저장소·로그에 남기지 않습니다.
- `retentionDays`(기본 90일)보다 오래된 항목은 자동 정리됩니다(학습 이력이 참조하는 항목은 보존).

## 개발

```bash
npm run typecheck   # 타입 검사
npm test            # 테스트(vitest)
npm run lint        # eslint
npm run build       # tsup 번들
```

## 라이선스

MIT
