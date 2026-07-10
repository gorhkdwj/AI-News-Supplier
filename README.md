# ai-news-supplier (`ains`)

> AI 소식(커뮤니티·공식 업데이트·저장소·모델·논문)을 로컬에 수집하고, CLI와 MCP로 LLM 에이전트에 공급하는 도구입니다.

`ains`는 Node.js 20 이상에서 동작하며 사용자 홈의 SQLite에 데이터를 저장합니다. 별도 서버가 필요 없고 도구 자체는 LLM을 호출하지 않습니다. HTML 페이지를 크롤링하지 않으며 공개 API와 RSS/Atom만 사용합니다.

현재 `0.1.0`은 유형별 랭킹 v2의 **shadow 릴리스**입니다. Shadow는 기존 결과와 새 결과를 나란히 검증하되 기본값은 바꾸지 않는 방식입니다. v2 스키마와 관측 스냅샷은 사용하지만, 옵션 없는 `ains trends`의 기본 랭킹은 아직 `legacy`입니다. 실제 데이터 워밍업과 승인 게이트를 통과하기 전에는 v2를 기본값으로 간주하지 마십시오.

## 데이터 모델과 랭킹 v2

- **Story**는 하나의 이야기를 나타내는 기존 `items` 행입니다. 기존 Story ID, 전문 검색(FTS), 점수 이력과 학습 이력을 보존합니다.
- **Sighting**은 HN 게시물, Reddit 게시물, RSS 항목, GitHub 저장소처럼 출처별 관측입니다. 같은 공식 URL이 RSS와 HN에서 발견되면 Story는 하나로 유지하고 Sighting은 각각 보존합니다.
- **Metric snapshot**은 Sighting의 점수와 댓글 수를 1시간 UTC 버킷으로 기록합니다. v2 성장률은 이 스냅샷만 사용하며 기존 `score_history`를 섞지 않습니다.
- 일반 스냅샷은 14일 보존합니다. 이전 DB에서 이관된 `legacy_unverified` Sighting은 라이브 재관측 전까지 성장률 기준점으로 쓰지 않습니다.

저장소 `trending`은 24시간·7일 기준점을 모두 요구하므로 새 설치 직후에는 결과가 적거나 없을 수 있습니다. 생성 14일 이내 저장소는 별 수와 관계없이 무점수 `discovery`에서 별도로 확인할 수 있습니다. Community, Official, Repos, Research는 서로 다른 신호와 공식을 사용하며 점수를 전역 비교하지 않습니다.

## 수집 소스

| 소스                                       | 유형                          | 인증                       |
| ------------------------------------------ | ----------------------------- | -------------------------- |
| Hacker News                                | 커뮤니티                      | 불필요                     |
| GitHub Search·Repository API               | 저장소                        | 선택적 `GITHUB_TOKEN`      |
| OpenAI·DeepMind·Google AI·Hugging Face RSS | 공식 업데이트                 | 불필요                     |
| Claude Code Atom·Cursor RSS                | 공식 업데이트                 | 불필요                     |
| Figma Release Notes Atom                   | 공식 업데이트, AI 키워드 필터 | 불필요                     |
| Gemini CLI GitHub Releases                 | 공식 업데이트, 정식 릴리스만  | 선택적 `GITHUB_TOKEN`      |
| Hugging Face                               | 모델·논문                     | 불필요                     |
| arXiv                                      | 논문                          | 불필요                     |
| DEV.to                                     | Community 채널                | 불필요                     |
| Reddit                                     | 커뮤니티                      | OAuth 정보와 username 필수 |

GitHub Trending HTML, Anthropic 뉴스룸 HTML, Figma 일반 HTML은 수집하지 않습니다. 한 소스나 한 subreddit이 실패해도 나머지 수집 결과는 유지합니다.

## 설치와 빌드

현재는 소스에서 빌드해 사용합니다. npm 레지스트리 배포는 아직 수행하지 않았습니다.

```bash
git clone https://github.com/gorhkdwj/AI-News-Supplier.git
cd AI-News-Supplier
npm install
npm run build
```

빌드하면 `dist/cli/index.js`와 `dist/mcp/server.js`가 생성됩니다. 프로젝트 폴더에서 `npm link`를 실행하면 다른 폴더에서도 `ains`와 `ains-mcp`를 사용할 수 있습니다.

```bash
npm link
ains --version
```

`npm link` 없이 사용할 때는 아래 예시의 `ains`를 `node dist/cli/index.js`로 바꾸십시오.

> PowerShell에서 쉼표 목록은 따옴표로 감싸십시오. 예: `ains fetch --source "hackernews,arxiv"`

## CLI 사용법

```bash
# 수집: 최근 수집한 소스는 TTL에 따라 건너뜁니다.
ains fetch
ains fetch --source "hackernews,github" --force

# 0.1.0 기본값: legacy overview/briefing
ains trends --limit 20
ains trends --ranking legacy --channel overview --sort briefing

# 유형별 랭킹 v2
ains trends --ranking v2 --channel overview --sort briefing --limit 20
ains trends --ranking v2 --channel community --sort hot --hours 48
ains trends --ranking v2 --channel official --sort latest
ains trends --ranking v2 --channel official --sort important
ains trends --ranking v2 --channel repos --sort trending
ains trends --ranking v2 --channel repos --sort discovery
ains trends --ranking v2 --channel research --sort hot

# 조회와 학습
ains search "mixture of experts"
ains show <story-id>
ains learn
ains learn session "rag"
ains learn record "rag"
ains history

# 상태·설정·스케줄
ains doctor
ains config init
ains config show
ains schedule install --every 60
ains schedule status
```

유형별 허용 조합과 기본 sort는 다음과 같습니다.

| channel     | 허용 sort               | channel 지정 시 기본값 |
| ----------- | ----------------------- | ---------------------- |
| `overview`  | `briefing`              | `briefing`             |
| `community` | `hot`, `latest`         | `hot`                  |
| `official`  | `latest`, `important`   | `latest`               |
| `repos`     | `trending`, `discovery` | `trending`             |
| `research`  | `hot`, `latest`         | `hot`                  |

`legacy`는 `overview/briefing`만 허용합니다. 잘못된 channel/sort 조합이나 호환되지 않는 type 필터는 자동 보정하지 않고 종료 코드 1로 거부합니다. `--source`, `--type`, `--hours`, `--limit`, `--no-refresh`, `--json` 옵션은 그대로 사용할 수 있습니다.

텍스트 출력은 모든 값을 `★`로 표시하지 않습니다. HN `points`, Reddit `upvotes`, DEV `reactions`, GitHub `stars`, Hugging Face `likes`처럼 출처가 제공하는 `score_kind` 라벨을 함께 표시합니다. 점수 없는 `latest`·`discovery` 결과는 `ranking.score`와 deprecated `hotness`가 `null`입니다.

학습 후보는 별도 ranking 옵션 없이 v2 Story 근거를 사용합니다. 같은 Story가 여러 Sighting이나 채널에 나타나도 한 번만 집계하고, 워밍업 중인 Story는 점수 0으로 두되 근거와 출처 다양성에는 남깁니다. 성장률은 live Community·Repo metric snapshot만 사용하며 기존 `score_history`를 사용하지 않습니다.

## MCP 서버

Claude Code 같은 MCP 클라이언트에는 stdio 서버를 등록하십시오.

```bash
claude mcp add ains -- node /절대경로/AI-News-Supplier/dist/mcp/server.js
```

도구 수와 이름은 9개로 유지됩니다.

| 도구                      | 설명                                                            |
| ------------------------- | --------------------------------------------------------------- |
| `get_trends`              | legacy 또는 유형별 v2 트렌드 조회                               |
| `search_news`             | 전문 검색                                                       |
| `get_item`                | Story 상세, 기존 점수 이력, 전체 Sighting과 metric history 조회 |
| `refresh_sources`         | 수동 수집                                                       |
| `get_source_status`       | 소스별 상태                                                     |
| `get_learning_candidates` | 학습 가치가 높은 토픽과 근거 자료                               |
| `design_learning_session` | 토픽별 학습 지시문과 맥락 자료                                  |
| `record_learning`         | 학습 이력 기록                                                  |
| `get_learning_history`    | 학습 이력 조회                                                  |

MCP `get_trends`는 유형별 `sections[]`와 같은 순서로 평탄화한 `items[]`를 함께 반환합니다. CLI의 `trends --json`은 호환을 위해 평탄화한 최상위 배열을 유지하며 각 항목의 `ranking.channel`로 섹션을 구분할 수 있습니다. 각 결과의 `ranking`에는 version, channel, sort, kind, position, score, coverage, signals, explanation이 포함됩니다. 기존 `hotness`는 1.0까지 `null`을 허용하는 폐기 예정 호환 별칭으로 유지합니다. 제공 프롬프트는 `trend-briefing`, `learn-today`, `deep-dive`입니다.

## 설정

설정 파일은 `~/.ai-news-supplier/config.json`이며 `AINS_HOME`으로 데이터 디렉터리를 바꿀 수 있습니다.

```bash
ains config path
ains config init
ains config edit
```

주요 설정은 `retentionDays`, 소스별 `enabled`·`ttlMinutes`, `maxPerSourceRatio`, `extraKeywords`, `sources.rss.feeds`입니다. GitHub 토큰은 `tokens.github` 또는 `GITHUB_TOKEN`에서 읽으며 환경변수가 설정 파일보다 우선합니다.

### Reddit

Reddit은 다음 세 값이 모두 있어야 활성화됩니다.

- `AINS_REDDIT_CLIENT_ID`
- `AINS_REDDIT_CLIENT_SECRET`
- `AINS_REDDIT_USERNAME`

설정 파일에서는 각각 `tokens.reddit.clientId`, `tokens.reddit.clientSecret`, `tokens.reddit.username`을 사용할 수 있습니다. User-Agent는 `desktop:ai-news-supplier:v<version> (by /u/<username>)` 형식입니다. 기본 subreddit은 `MachineLearning`, `LocalLLaMA`, `artificial`, `ClaudeCode`, `ClaudeAI`, `cursor`, `OpenAI`입니다.

Reddit Sighting, 본문·작성자·raw, 스냅샷은 전역 `retentionDays`와 관계없이 최초 관측 48시간 뒤 강제 삭제됩니다. `/api/info` 재검증에서 삭제·removed가 확인된 항목은 즉시 제거합니다. 다른 출처가 남지 않은 Story와 학습 이력의 dangling Story ID도 함께 정리합니다. 자격증명과 username을 저장소, 로그, fixture에 넣지 마십시오.

### 사용자 정의 RSS

`sources.rss.feeds`를 설정하면 기본 피드에 추가되는 것이 아니라 **기본 목록 전체를 대체**합니다. 기본 피드와 사용자 피드를 함께 쓰려면 유지할 기본 피드도 배열에 포함하십시오. 각 항목은 고유한 `id`, 표시용 `title`, 공개 RSS/Atom `url`이 필요합니다.

Figma 피드는 AI 관련 키워드가 일치하는 항목만 저장합니다. Gemini CLI는 RSS 설정이 아니라 GitHub 수집기의 공식 Releases API에서 `draft=false`, `prerelease=false`인 항목만 수집합니다.

## DB 마이그레이션과 복구

기존 v1 파일 DB를 처음 열면 DDL 적용 전에 같은 디렉터리에 `data.pre-v2.<UTC>.bak`을 생성합니다. `<UTC>`는 `20260710T010203456Z`처럼 구두점을 뺀 UTC 시각입니다. 백업은 SQLite `VACUUM INTO`로 만들고 무결성·rowid·FTS·기존 점수/학습 이력을 검증합니다. 백업 생성이나 검증이 실패하면 v2 마이그레이션을 시작하지 않습니다.

복구가 필요하면 다음 순서로 진행하십시오.

1. 실행 중인 `ains`, 스케줄 작업, MCP 서버를 모두 종료합니다.
2. 현재 `~/.ai-news-supplier/data.db`를 삭제하지 말고 별도 이름으로 보존합니다.
3. 선택한 `data.pre-v2.<UTC>.bak`의 복사본을 `data.db`로 둡니다.
4. 마이그레이션 문제가 해결된 버전 또는 이전 호환 버전으로 다시 시작합니다.

자동 하향 마이그레이션은 제공하지 않습니다. 새 빈 DB와 in-memory DB에는 사전 백업을 만들지 않습니다.

## 데이터와 프라이버시

- 데이터는 기본적으로 `~/.ai-news-supplier/data.db`에만 저장합니다.
- 일반 Story 보존 기간은 `retentionDays`(기본 90일)이고 일반 metric snapshot은 14일입니다.
- 공개 API·RSS/Atom만 요청하며 HTML 크롤링, 리디렉션 추적 기반 병합, 제목 유사도 자동 병합을 하지 않습니다.
- API 키·비밀번호·세션 쿠키를 코드, 로그, fixture에 기록하지 않습니다.
- 번역·요약·학습 설명 생성은 `ains` 내부 LLM이 아니라 데이터를 소비하는 에이전트가 수행합니다.

## 0.1.0 shadow 롤아웃 상태

1. 최초 7일 동안 실제 24시간·7일 기준점을 수집합니다. 과거 스냅샷을 합성하지 않습니다.
2. 다음 7일 동안 `--ranking v2`로 legacy와 shadow 비교합니다. 이 기간에도 기본값은 legacy입니다.
3. 아래 승인 게이트를 모두 통과한 뒤 `0.2.0`에서 v2 Overview를 기본으로 전환합니다.
4. `0.2.x` 한 minor 동안 명시적 legacy 옵션을 유지하고 `0.3.0`에서 제거합니다. `hotness` 출력 별칭은 1.0까지 유지합니다.

승인 게이트는 Repo 24시간 기준점 확보율 95% 이상, 7일 기준점 확보율 90% 이상, Repo 상위 20개 전체 기준점 확보, Repo·Community 상위 20개의 수동 AI 관련 정확도 각각 90% 이상, 활성 Community의 현재 점수 확보율 90% 이상입니다.

현재 이 게이트는 **통과하지 않았습니다**. 자동 검증은 녹화 fixture와 합성 데이터 중심이며, 모든 라이브 API의 지속 동작, 14일 shadow 관측, 실제 데이터의 수동 precision@20은 아직 미검증 범위입니다. AI NEWS HUB와 정확히 같은 순위를 만드는 것은 승인 기준이 아닙니다.

## 개발

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm pack
```

라이브 네트워크 검증은 기본 테스트에서 제외합니다. 수집기 테스트는 저장된 fixture를 사용합니다.

## 라이선스

MIT
