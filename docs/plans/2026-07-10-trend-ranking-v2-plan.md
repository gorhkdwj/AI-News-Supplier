# 유형별 트렌드 랭킹 v2 구현 계획

> 작성일: 2026-07-10  
> 상태: 확정  
> 적용 브랜치: `codex/trend-ranking-v2`

## 1. 결론과 문서 위계

단일 전역 `hotness`로 서로 다른 종류의 항목을 한 줄에 세우는 방식을 중단하고, 하나의 사건을 뜻하는 **Story**와 소스별 관측을 뜻하는 **Sighting**을 분리합니다. 커뮤니티·공식 업데이트·레포·연구 채널은 각 데이터의 의미에 맞는 랭커를 사용하며, 종합 브리핑은 채널별 결과를 정해진 몫과 우선순위로 조합합니다.

이 문서는 구현 순서와 영향 범위를 설명합니다. 스키마, 수식, 누락값, 공개 CLI/MCP 입출력, 오류, 보존, 롤아웃 및 수용 게이트의 유일한 규범 문서는 [`docs/requirements-contract.md`](../requirements-contract.md)입니다. 두 문서가 다르면 기준 계약을 따릅니다. 기존 [`2026-07-09-ai-news-supplier-plan.md`](./2026-07-09-ai-news-supplier-plan.md)는 제품 전체의 배경 기록으로 보존하되, 랭킹 v2 범위에서는 이 계획과 기준 계약이 우선합니다.

## 2. 목표와 비목표

### 목표

- 기존 `items.id` 16자리 hex 식별자와 FTS rowid, 학습 이력 참조를 깨뜨리지 않고 관측 모델을 확장합니다.
- 점수의 크기뿐 아니라 6시간·24시간·7일 변화량을 실제 시간대별 스냅샷으로 계산합니다.
- 커뮤니티는 참여·토론·속도, 공식 업데이트는 최신성·영향도, 레포는 성장·규모·활동성, 연구는 기존 연구 랭킹으로 각각 정렬합니다.
- v2를 바로 기본값으로 바꾸지 않고 데이터 워밍업과 그림자 비교를 거친 뒤 수용 게이트로 승격합니다.
- Reddit은 공식 OAuth와 식별 가능한 User-Agent만 사용하고 콘텐츠를 최대 48시간만 보유합니다.

### 비목표

- 도구 내부에서 LLM을 호출하거나 LLM으로 AI 관련성·영향도를 판정하지 않습니다.
- AI NEWS HUB의 정확한 순위를 복제하지 않습니다.
- Anthropic newsroom, GitHub Trending, Figma HTML을 스크레이핑하지 않습니다.
- 기존 Story ID를 재발급하거나 `items`를 논리 뷰로 교체하지 않습니다.
- v2에서 하향 마이그레이션을 제공하지 않습니다. 문제가 생기면 사전 백업을 복원합니다.
- MCP 도구 수를 9개보다 늘리지 않습니다.

## 3. 현재 구조의 문제

현재 `items` 한 행은 Story와 소스 관측을 동시에 표현합니다. 같은 발표가 공식 피드, HN, Reddit에 각각 나타나면 중복 Story가 생기고, 반대로 한 canonical URL로 합쳐지면 마지막 수집 소스의 점수와 제목이 다른 소스 정보를 덮어쓸 수 있습니다. `score_history`도 Story 단위 점수라서 GitHub 스타, HN 포인트 등 단위가 다른 관측을 안전하게 구분하지 못합니다.

또한 기존 전역 수식은 공식 공지, 레포, 논문, 커뮤니티 글을 같은 의미의 `hotness`로 비교합니다. 점수가 없는 공식 RSS에는 고정 정규값을 주고 타입 부스트를 적용하므로 실제 중요도와 무관한 결과가 생기며, 새 레포의 총 스타와 성장률도 분리할 수 없습니다.

## 4. 목표 아키텍처

데이터 흐름은 다음과 같습니다.

```text
공개 API/RSS
  -> Collector의 원천 식별자·시간 정밀도·점수 종류 정규화
  -> (source, source_key) Sighting upsert
  -> canonical URL로 기존 Story 연결 또는 새 Story 생성
  -> 시간당 metric snapshot 저장(값이 같아도 저장)
  -> 채널별 후보/기준시점 조회
  -> category ranker
  -> 직접 채널 응답 또는 overview 조합
  -> CLI / 기존 9개 MCP 도구
```

`src/core`가 Story 결합, 스냅샷, 랭킹, 마이그레이션을 소유합니다. 수집기는 원천 데이터와 안정적인 `source_key`를 제공하고, CLI/MCP는 공통 코어 질의를 호출만 합니다. MCP 프로세스 stdout에는 프로토콜 전송만 기록하며 로그는 stderr로 보냅니다.

## 5. 데이터 설계

### 5.1 Story: 기존 `items`

물리 테이블 `items`와 기존 컬럼을 유지합니다. 기존 행의 `id`는 그대로이며 새 Story도 정규화한 canonical URL의 SHA-256 앞 16자리 hex를 사용합니다. `items`의 제목·URL·요약·작성자·태그·점수 관련 컬럼은 선택된 primary Sighting의 조회용 투영값입니다. FTS external-content rowid와 트리거도 같은 물리 행을 계속 사용합니다.

Story 연결은 먼저 기존 `(source, source_key)` Sighting을 찾고, 없으면 정규화한 콘텐츠 canonical URL의 정확 일치로만 수행합니다. 제목 유사도 같은 비결정적 병합은 하지 않습니다. 같은 Story의 primary는 `live` 우선, 채널 우선순위 `official -> repos -> community -> research`, 정보 충실도, `(source, source_key)` 사전순으로 재선정하며 트랜잭션 안에서 정확히 하나만 유지합니다.

### 5.2 Sighting: `source_sightings`

한 소스가 한 Story를 관측한 사실과 그 소스 단위 지표를 보관합니다. 필드는 `id`, `story_id`, `source`, `source_key`, `type`, `source_url`, `discussion_url`, `title`, `summary`, `author`, `tags`, `score_kind`, `score`, `comments_count`, `published_at`, `published_precision`, `activity_at`, `first_seen_at`, `last_seen_at`, `raw`, `quality`, `verified_at`, `is_primary`입니다.

`(source, source_key)`는 유일하고, 부분 유일 인덱스로 Story당 `is_primary=1`을 하나만 허용합니다. `quality`는 `live | legacy_unverified`, `published_precision`은 `exact_time | date_only | inferred`만 허용합니다. 랭킹 결과의 `sighting_id`는 실제로 점수·시간을 제공한 Sighting을 가리킵니다.

### 5.3 Metric Snapshot: `metric_snapshots`

`sighting_id`, `bucket_at`, `observed_at`, `score`, `comments_count`를 저장합니다. `bucket_at`은 관측 시각을 UTC 정시로 내린 값이며 `(sighting_id, bucket_at)`이 유일합니다. 같은 시간 버킷에서 다시 관측하면 최신 `observed_at`과 값을 갱신합니다. 직전 값과 같아도 새 시간 버킷에는 반드시 기록합니다.

일반 스냅샷 보존 기간은 14일입니다. 6시간 기준점은 목표 시각 ±2시간, 24시간은 ±4시간, 7일은 ±12시간에서 가장 가까운 관측을 고릅니다. 실제 숫자 `0`은 유효값이고 `null`만 미관측입니다. 기존 `score_history`는 보존하되 레거시 랭킹·학습 호환에만 사용하며 v2 성장률에는 사용하지 않습니다.

## 6. 스키마 v2 마이그레이션과 복구

파일 DB가 v1이면 DDL보다 먼저 같은 디렉터리에 `data.pre-v2.<UTC>.bak`를 `VACUUM INTO`로 생성합니다. 백업 생성이나 검증이 실패하면 아무 DDL도 적용하지 않고 시작을 중단합니다. 백업 뒤의 DDL, backfill, 불변식 검증, FTS 확인, `PRAGMA user_version` 갱신은 하나의 트랜잭션입니다.

기존 `items`마다 Sighting 하나를 backfill합니다. source key는 원본 `raw.objectID`, `raw.id`, `raw.permalink`, `raw.feedId + ':' + canonical_url` 순으로 선택하고 모두 없으면 `canonical_url`을 사용합니다. `quality=legacy_unverified`, `verified_at=null`, 과거 시간 정밀도를 증명할 수 없으므로 `published_precision=inferred`, `is_primary=1`로 둡니다. 기존 `score_history`나 현재 점수로 v2 스냅샷을 만들지 않습니다. 첫 라이브 갱신은 같은 Story·소스의 legacy 행을 가능한 경우 원천 key로 승격하고 `quality=live`, `verified_at`을 기록합니다.

검증 항목은 Story 수 보존, 모든 Sighting의 유효한 Story FK, `(source, source_key)` 중복 없음, Story당 primary 정확히 하나, 기존 ID·rowid·FTS 검색·`learning_history.item_ids`·`score_history` 보존입니다. 하향 마이그레이션은 없으며 장애 시 프로세스를 중단하고 백업 파일을 `data.db`로 복원합니다. 새 빈 DB는 v2를 직접 생성하므로 사전 백업 대상이 아닙니다.

## 7. 수집기와 허용 소스

모든 수집기는 원천의 안정적인 키, 콘텐츠 URL과 토론 URL의 구분, 점수 종류, 게시 시각 정밀도, 활동 시각을 반환하도록 계약을 확장합니다. 한 수집기의 실패는 `Promise.allSettled` 기반 격리로 다른 수집과 조회를 깨뜨리지 않습니다.

- 공식 추가 소스는 Claude Code Atom, Cursor RSS, Figma Atom, Gemini CLI GitHub Releases입니다.
- Figma는 피드 항목의 제목·요약·태그를 소문자로 정규화한 뒤 `ai`, `artificial intelligence`, `machine learning`, `generative`, `llm`, `prompt`, `agent`, `figma make`, `make kits`, `first draft` 중 하나가 단어 또는 구문으로 일치하는 항목만 수집합니다. `ai`는 독립 토큰으로만 판정해 `detail` 같은 부분 문자열을 제외합니다. 최초 수집 범위는 전역 `retentionDays`(기본 90일) 안으로 제한합니다.
- Gemini CLI는 공식 `google-gemini/gemini-cli` 저장소의 REST releases만 사용하고 `draft=false`, `prerelease=false`인 안정 릴리스만 채택합니다.
- GitHub 레포 검색은 fork·archived를 제외하고 결정적 AI 관련성 필터를 적용합니다. GitHub Trending 페이지는 사용하지 않습니다.

Reddit은 client credentials OAuth만 사용합니다. client id·secret과 Reddit username이 모두 있어야 활성화하며 username은 설정 또는 `AINS_REDDIT_USERNAME`에서 받습니다. User-Agent는 패키지 버전으로 `desktop:ai-news-supplier:v<version> (by /u/<username>)`을 생성합니다. 기본 subreddit은 `MachineLearning`, `LocalLLaMA`, `artificial`, `ClaudeCode`, `ClaudeAI`, `cursor`, `OpenAI`이며 각각의 `/hot`을 별도로 요청합니다. 응답의 rate-limit 헤더를 감시하고, 삭제·removed 상태를 재검증합니다.

Reddit Sighting, 원문/요약/raw 등 Reddit 유래 콘텐츠, 스냅샷은 48시간이 지나면 예외 없이 제거합니다. 다른 소스 Sighting이 남은 Story는 primary를 다시 정하고 Reddit 유래 투영값을 제거합니다. Reddit만 있던 Story는 삭제하며 학습 이력의 문자열 ID 목록에서도 dangling Story ID를 제거합니다. 자격증명과 username은 DB·로그·오류·fixture에 기록하지 않습니다.

## 8. 채널별 랭킹과 종합 브리핑

정확한 후보 조건, 수학 원시 함수, 공식, 누락값 재가중, 동률 기준은 기준 계약 5~10절을 구현합니다. 구현자가 이 계획만 보고도 점수 계열을 구분할 수 있도록 핵심 식을 아래에 함께 고정합니다.

```text
midrankPct = (동률 평균 오름차순 1-based rank - 0.5) / 후보 수

repoScore = round3(P × (0.50×G24 + 0.25×G7 + 0.25×T))
T = 0.5×midrankPct(stars) + 0.5×clamp(ln(1+stars)/ln(100001),0,1)
G_h = 0.7×midrankPct(max(delta_h,0))
    + 0.3×clamp(max(delta_h,0)/max(baseline_h,100),0,1)
P = 0.25 + 0.75×2^(-pushAgeDays/7)

communityScore = round3(
  coverageFactor × 2^(-ageHours/48)
  × weightedAverage(0.45×engagementLevel,
                    0.25×discussionLevel,
                    0.30×velocity)
)

officialScore = round3(
  2^(-ageDays/14) × (0.85×impactWeight + 0.15×communityEcho)
)
```

Repo 본선은 AI 관련, 비 fork·비 archived, 별 100개 이상, 최근 14일 push, live 24시간·7일 기준점을 모두 요구합니다. 음수 증가는 signals에 원값을 남기고 점수에서만 0으로 처리합니다. Discovery는 생성 14일 이내 레포를 별 하한 없이 `created_at DESC, stars DESC, id ASC`로 보여 주며 점수는 `null`입니다.

Community의 level은 소스 내부 midrank 0.6과 최근 30일 P95 절대 로그 정규화 0.4를 결합합니다. P95는 null 제외 표본 20개 이상에서 nearest-rank로 계산하고, 그보다 적으면 추천 100·댓글 50을 씁니다. 상대 증가율 분모 하한은 추천 20·댓글 10입니다. velocity는 6시간 0.60과 24시간 0.40이며 각 시간대 안에서는 추천 증가 0.65와 댓글 증가 0.35입니다. 누락 신호는 제외하고 남은 가중치를 재정규화합니다. 현재 추천 점수가 `null`이면 HOT에서는 제외하고 Latest에는 남깁니다.

Official Latest는 `published_at DESC, id ASC`이며 점수가 없습니다. Important 영향도는 critical 1.00, low 0.25, high 0.80, normal 0.50이고 `critical -> low -> high -> normal` 순으로 판정해 고객 사례가 제품 키워드만으로 high가 되지 않게 합니다.

- `community`: HN, Reddit, DEV입니다. 기본 72시간 안에서 참여 수준, 댓글 수준, 6시간·24시간 속도와 48시간 반감기를 결합하고 소스 다양성 40%를 목표로 합니다.
- `official`: 공식 RSS/Atom과 Gemini CLI 안정 릴리스입니다. 직접 조회 기본값은 `latest`이며, `important`는 결정적 영향 키워드와 같은 Story의 community echo를 사용합니다.
- `repos`: 24시간·7일 완전 기준점을 가진 활성 AI 레포만 `trending`에 넣습니다. 새 레포 `discovery`는 별도 무점수 목록이며 overview에 자동 혼합하지 않습니다.
- `research`: model, paper, DEV가 아닌 article입니다. `hot`은 기존 수식을 `research_hot_v1`이라는 명시적 kind로 유지하고 `latest`는 시간순입니다.
- `overview`: `floor(limit/4)`를 네 채널에 먼저 배정하고 부족분을 재배분합니다. Story 중복은 `official -> repos -> community -> research` 우선순위로 제거합니다. 섹션과 같은 항목의 flattened 목록을 함께 반환합니다.

기존 전역 수식은 `legacy_hotness_v1`로 격리합니다. `hotness`는 1.0까지 nullable 호환 별칭이고, v2의 의미가 다른 점수를 다시 전역 비교 가능한 값처럼 사용해서는 안 됩니다.

## 9. 공개 CLI/MCP 설계

MCP 도구는 기존 9종을 유지합니다. `get_trends`에 `ranking_version`, `channel`, `sort`를 추가하고 기존 `sources`, `types`, `since_hours`, `limit`를 보존합니다. CLI `ains trends`에는 각각 `--ranking`, `--channel`, `--sort`를 추가하고 `--source`, `--type`, `--hours`, `--limit`, `--no-refresh`, `--json`을 보존합니다.

지원 조합은 overview/briefing, community/hot|latest, official/latest|important, repos/trending|discovery, research/hot|latest입니다. 잘못된 enum이나 조합은 명시적 입력 오류이며 다른 정렬로 자동 교정하지 않습니다. `channel`만 주면 해당 기본 sort를 쓰지만, `sort`만 주어 overview와 맞지 않으면 채널을 추측하지 않습니다. 레거시 버전은 호환을 위해 overview/briefing만 허용합니다.

각 항목은 Story 필드에 더해 `sighting_id`, `score_kind`, `comments_count`, `discussion_url`, `activity_at`, `published_precision`, 아래 구조의 `ranking`, nullable `hotness`를 반환합니다.

```text
ranking {
  version, channel, sort, kind,
  position, score, coverage,
  signals, explanation
}
```

`hotness`는 deprecated 호환 별칭이며 1.0까지 유지합니다. Latest·Discovery처럼 점수가 없는 보기는 `ranking.score=null`, `hotness=null`입니다. `get_item`은 기존 상세와 `score_history`에 Story의 전체 `sightings`와 Sighting별 `metric_history`를 추가합니다. 다른 7개 MCP 도구의 이름과 기본 역할은 변경하지 않습니다.

CLI `--json`은 기존 최상위 배열을 유지하며 Overview의 섹션은 각 항목의 `ranking.channel`로 식별합니다. MCP 응답은 `sections[]`와 섹션 순서로 평탄화한 `items[]`를 함께 제공합니다.

## 10. 구현 순서와 중단점

| 단계 | 내용 | 완료 조건 | 실패 시 중단점 |
|---|---|---|---|
| V2-0 | 문서 게이트 | 계획·기준 계약·Decisionlog·Worklog 정합성 확인 | 계약이 모호하면 코드 작업을 시작하지 않습니다. |
| V2-1 | 타입·스키마·안전 백업 | v1 파일 DB 백업 후 v2 전환, 기존 ID/FTS 보존 | 백업 또는 불변식 검증 실패 시 즉시 롤백합니다. |
| V2-2 | Sighting 수집 계약 | 모든 fixture가 source key·시간 정밀도·점수 종류를 생성 | 원천 key가 불안정하면 해당 수집기만 중단합니다. |
| V2-3 | Snapshot·보존 | 시간 버킷, 기준점 허용 오차, 일반 14일/Reddit 48시간 검증 | 실제 0과 null이 섞이면 랭커 작업을 중단합니다. |
| V2-4 | 채널 랭커 | 합성 데이터에서 공식·동률·누락값·다양성 검증 | 수용 지표 계산이 재현되지 않으면 shadow를 시작하지 않습니다. |
| V2-5 | 공개 인터페이스 | CLI와 MCP가 같은 공통 질의·출력 계약 사용, 9도구 유지 | stdout 오염이나 호환 오류가 있으면 릴리스하지 않습니다. |
| V2-6 | 워밍업·shadow | 7일 워밍업 뒤 7일 legacy/v2 비교 자료 생성 | 기준점 coverage 미달이면 v2 기본 전환을 연기합니다. |
| V2-7 | 승격·정리 | 0.2.0 v2 기본, 0.2.x 동안 legacy 명시 지원 후 0.3.0에서 제거 | 모든 게이트 통과 전 기본값을 바꾸지 않습니다. |

## 11. 검증 전략과 수용 기준

수집기 검증은 라이브 네트워크 대신 녹화 fixture를 기본으로 합니다. 시간은 주입하고, in-memory DB와 파일 DB를 나누어 검사합니다. 파일 DB 테스트는 실제 `VACUUM INTO` 백업, 실패 주입, 트랜잭션 원자성, 복원 절차를 확인합니다.

랭킹 테스트는 동률 midrank, 단일 후보, 실제 0, null, 음수 delta, 기준점 허용 오차 경계, 부분 재가중, diversity 대안 유무, overview의 limit<4·부족분·Story 중복을 포함합니다. Reddit은 credential/username 게이트, per-subreddit 요청, rate header, 삭제 재검증, 48시간 hard purge를 검증합니다. MCP는 9도구 목록과 stdout 위생, CLI와 함께 유효/무효 조합을 검증합니다.

0.2.0 기본 전환 전에 다음을 모두 만족해야 합니다.

- repo 24시간 기준점 coverage 95% 이상, 7일 coverage 90% 이상
- repo top 20 전부 full coverage 및 eligibility 충족
- repo/community 수동 precision@20 각각 90% 이상
- active community 현재 score availability 90% 이상
- 전체 테스트, typecheck, lint, build, `npm pack` 통과

정확한 AI NEWS HUB 순위 일치는 게이트가 아닙니다.

## 12. 예상 코드 영향 범위

- 코어 타입·정규화: Story/Sighting/Snapshot 및 ranking 결과 타입
- DB: v2 마이그레이션, 백업/검증, Sighting·Snapshot store, retention
- 수집기: 안정 source key, URL 분리, 시간 정밀도, score kind, 추가 공식 소스, Reddit 규정
- 랭킹: 공통 수학 함수, community/official/repos/research/overview 랭커, legacy adapter
- 공개 통로: CLI trends 옵션/포맷, MCP `get_trends`·`get_item`
- 테스트/fixture: 마이그레이션·수집기·랭커·CLI/MCP 통합 및 개인정보 보존
- 사용자 문서: 실제 구현·기본값 전환 시점에 맞춘 README 갱신

## 13. 위험과 완화

- 7일 기준점이 즉시 없으므로 7일 warmup을 강제하고 가짜 과거값을 만들지 않습니다.
- source key 드리프트는 `(source, source_key)` 충돌과 legacy 재조정 테스트로 막습니다.
- 날짜만 있는 피드는 자정을 정확 시각처럼 취급하지 않고 `published_precision=date_only`로 노출합니다.
- 같은 Story의 여러 채널 점수는 비교 단위가 다르므로 overview에서 수치를 합산하지 않고 quota로 조합합니다.
- Reddit 정책 변경 가능성이 있으므로 credential gate와 짧은 보존을 보수적으로 적용하고 정책을 릴리스마다 재확인합니다.
- 원래 `main` 작업 트리의 관련 없는 미커밋 변경은 별도 작업 트리에서 보존하고, 이 계획과 직접 관련된 파일만 단계별로 스테이징합니다.

## 14. 외부 자료 기록

| URL | 제목 | 확인일 | 판단 근거 | 적용 범위 |
|---|---|---|---|---|
| https://raw.githubusercontent.com/anthropics/claude-code/main/feed.xml | Claude Code Changelog | 2026-07-10 | 공식 저장소가 제공하는 Atom 피드이며 HTML 스크레이핑이 필요 없습니다. | `rss:claude-code` 공식 업데이트 |
| https://cursor.com/changelog/rss.xml | Cursor Changelog | 2026-07-10 | 응답 200과 RSS content type을 확인했습니다. | `rss:cursor` 공식 업데이트 |
| https://www.figma.com/release-notes/feed/atom.xml | Figma product news and release notes | 2026-07-10 | 응답 200의 공식 피드이며 AI 외 항목도 포함합니다. | `rss:figma`, AI 필터·보존 cutoff 적용 |
| https://docs.github.com/en/rest/releases/releases#list-releases | REST API endpoints for releases | 2026-07-10 | 공개 릴리스 조회와 응답의 `draft`, `prerelease`, `published_at` 필드를 확인했습니다. | Gemini CLI 안정 릴리스 수집 |
| https://www.reddit.com/dev/api/ | reddit.com: api documentation | 2026-07-10 | OAuth listing의 `/hot`과 listing pagination 계약을 확인했습니다. | per-subreddit hot 수집 |
| https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki | Reddit Data API Wiki | 2026-07-10 | OAuth, 식별 가능한 User-Agent 형식, rate-limit 헤더, 삭제 의무와 48시간 보존 권고를 확인했습니다. | UA 생성·rate header 감시·삭제·보존 |
| https://redditinc.com/policies/data-api-terms | Data API Terms | 2026-07-10 | OAuth 식별을 숨기지 말 것, API 제한 준수, 사용자 콘텐츠 취급 의무를 확인했습니다. | OAuth 전용·삭제 재검증·48시간 보존 |
