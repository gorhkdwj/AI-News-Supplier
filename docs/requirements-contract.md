# 기준 계약 문서 · ai-news-supplier

> 구현 전에 합의해 고정하는 단일 규범 문서입니다. 기준이 바뀌면 코드보다 이 문서를 먼저 갱신하고 Decisionlog에 이유를 남깁니다. 랭킹 v2의 구현 순서는 `docs/plans/2026-07-10-trend-ranking-v2-plan.md`를 따르며 충돌하면 이 문서가 우선합니다.

## 1. 전역 불변 규칙

- Node.js 20 이상, TypeScript/ESM, 로컬 SQLite를 사용합니다.
- 도구 자체는 LLM API를 호출하지 않습니다.
- 공개 API·RSS·Atom·허용된 공개 데이터만 수집하며 HTML 스크레이핑은 하지 않습니다.
- 한 수집기의 실패가 다른 수집기나 저장된 데이터 조회를 실패시키지 않습니다.
- MCP 서버 stdout에는 MCP 전송만 쓰고 로그는 stderr에 씁니다.
- API 키·OAuth 비밀·사용자 토큰을 DB·로그·fixture·오류 메시지에 기록하지 않습니다.

## 2. 데이터 모델

### 2.1 Story (`items`)

- 물리 테이블 `items`는 하나의 canonical 콘텐츠를 뜻하는 Story aggregate로 유지합니다.
- Story `id`는 `sha256(canonical_url)` 앞 16자리 hex이며 기존 ID와 rowid를 변경하지 않습니다.
- `type`은 `community | official_update | hot_repo | model | paper | article` 중 하나입니다.
- `items`의 기존 source·type·score·comments·raw 필드는 레거시 호환 캐시입니다. v2 랭킹은 이를 지표 원천으로 사용하지 않습니다.
- FTS와 `learning_history.item_ids`는 Story ID를 계속 참조합니다.

### 2.2 Source Sighting (`source_sightings`)

한 Story가 특정 소스에서 관측된 사실을 다음 필드로 저장합니다.

```text
id, story_id, source, source_key, type,
source_url, discussion_url,
title, summary, author, tags[],
score_kind, score, comments_count,
published_at, published_precision, activity_at,
first_seen_at, last_seen_at, raw,
quality, verified_at, is_primary
```

- `(source, source_key)`는 유일합니다.
- Sighting ID는 `sha256(source + "\0" + source_key)` 앞 24자리 hex입니다.
- `published_precision`은 `exact_time | date_only | inferred`입니다.
- `quality`는 `live | legacy_unverified`입니다.
- 부분 유일 인덱스로 Story당 primary Sighting을 정확히 하나만 허용합니다.
- `source_key`는 HN objectID, Reddit post ID, DEV ID, GitHub repository ID, Hugging Face·arXiv 원천 ID, RSS GUID 또는 canonical link를 사용합니다.
- HN·Reddit은 콘텐츠 `source_url`과 토론 `discussion_url`을 모두 보존합니다.
- 동일 canonical URL의 공식 RSS, HN, Reddit 관측은 Story 하나와 서로 다른 Sighting으로 보존합니다.

### 2.3 Metric Snapshot (`metric_snapshots`)

```text
sighting_id, bucket_at, observed_at, score, comments_count
```

- `(sighting_id, bucket_at)`이 기본 키이며 `bucket_at`은 UTC 한 시간 버킷 시작입니다.
- 같은 버킷의 재관측은 가장 늦은 `observed_at`과 값을 저장합니다.
- 값이 변하지 않아도 새 시간 버킷에는 반드시 기록합니다.
- 실제 숫자 `0`은 유효한 관측이며 `null`만 수집 불가 또는 미관측입니다.
- 일반 스냅샷은 14일, Reddit Sighting과 스냅샷은 최대 48시간 보존합니다.
- 기준점은 목표 시각에서 가장 가까운 관측을 6시간±2시간, 24시간±4시간, 7일±12시간 범위에서 선택합니다. 범위 밖이면 `null`입니다.
- 기존 `score_history`는 보존하지만 v2 성장률 계산에는 사용하지 않습니다.

## 3. 마이그레이션과 복구

- 파일 DB가 v1이면 DDL 전에 동일 디렉터리에 `data.pre-v2.<UTC>.bak`을 `VACUUM INTO`로 생성합니다.
- 백업 실패 시 어떤 v2 DDL도 적용하지 않고 시작을 중단합니다. 메모리 DB와 데이터 없는 새 파일 DB는 백업을 생략합니다.
- v2 DDL, 기존 item별 legacy Sighting backfill, 불변식 검증, `user_version=2` 갱신은 하나의 트랜잭션입니다.
- 기존 item은 `quality=legacy_unverified`, `verified_at=null`, `is_primary=1`인 Sighting 하나로 이관하며 metric snapshot을 만들지 않습니다.
- legacy `source_key`는 `raw.objectID`, `raw.id`, `raw.permalink`, `raw.feedId + ':' + canonical_url`, `canonical_url` 순으로 선택합니다.
- 라이브 재수집 전 legacy Sighting은 v2 성장 점수 후보가 아닙니다.
- Story 수·ID·rowid·FTS 결과, `score_history`, `learning_history.item_ids`가 마이그레이션 전후 동일해야 하며 `PRAGMA foreign_key_check` 결과는 0건이어야 합니다.
- 지원 버전보다 높은 `user_version`은 명시적 오류로 거부합니다.
- 자동 down migration은 제공하지 않으며 복구는 프로세스를 종료하고 사전 백업을 복원하는 방식만 지원합니다.

## 4. 수집기 정규화 계약

모든 수집기는 기존 필드와 함께 다음 값을 제공합니다.

```text
sourceKey, discussionUrl, scoreKind, activityAt, publishedPrecision
```

- GitHub `scoreKind=stars`, `activityAt=pushed_at`입니다. 랭킹은 갱신되지 않는 raw 값을 읽지 않습니다.
- HN `scoreKind=points`, Reddit `scoreKind=upvotes`, DEV `scoreKind=reactions`입니다.
- 날짜만 제공된 피드를 자정의 정확한 시각처럼 표현하지 않고 `publishedPrecision=date_only`로 표시합니다.
- raw는 최신 라이브 관측으로 갱신하지만 랭킹의 유일한 정규화 필드를 대체하지 않습니다.

### 4.1 GitHub 후보

- 신규 AI 레포와 최근 push된 기존 AI 레포 검색을 분리하며 쿼리당 최대 100개를 받습니다.
- fork·archived를 제외하고 name·description·topics에 결정적 AI 관련성 규칙을 적용합니다.
- 추적 중이지만 검색 결과에서 빠진 저장소는 최대 50개까지 공식 Repository API로 재관측합니다.
- GitHub Trending HTML은 사용하지 않습니다.

### 4.2 Reddit

- 등록된 client credentials OAuth만 사용합니다.
- clientId, clientSecret, Reddit username이 모두 있어야 활성화합니다. username은 설정 또는 `AINS_REDDIT_USERNAME`에서 받습니다.
- User-Agent는 `desktop:ai-news-supplier:v<version> (by /u/<username>)`입니다.
- 기본 subreddit은 `MachineLearning`, `LocalLLaMA`, `artificial`, `ClaudeCode`, `ClaudeAI`, `cursor`, `OpenAI`입니다.
- subreddit마다 `GET /r/<name>/hot?limit=25&raw_json=1`을 별도로 호출하고 성공 결과만 병합합니다.
- rate-limit used/remaining/reset 헤더를 감시하며 잔여 한도가 부족하면 추가 요청을 중단합니다.
- 보관 중인 post ID를 공식 API로 재검증하고 deleted·removed 항목의 제목·본문·URL·작성자·raw·snapshot을 즉시 삭제합니다.
- Reddit 유래 데이터는 학습 이력 참조 여부와 무관하게 48시간 뒤 삭제합니다. 다른 Sighting이 없는 Story는 삭제하고 학습 이력의 dangling Story ID도 제거합니다.
- 자격증명 또는 username이 없으면 오류가 아니라 비활성입니다.

### 4.3 기본 공식 소스

기존 OpenAI, DeepMind, Google AI, Hugging Face 피드를 유지하고 다음 허용 소스를 추가합니다.

- `rss:claude-code`: `https://raw.githubusercontent.com/anthropics/claude-code/main/feed.xml`
- `rss:cursor`: `https://cursor.com/changelog/rss.xml`
- `rss:figma`: `https://www.figma.com/release-notes/feed/atom.xml`; title·summary·tags를 소문자로 정규화하고 `ai`, `artificial intelligence`, `machine learning`, `generative`, `llm`, `prompt`, `agent`, `figma make`, `make kits`, `first draft` 중 독립 토큰 또는 구문이 일치하는 항목만 채택합니다. `ai` 부분 문자열은 허용하지 않으며 최초 수집은 `retentionDays`(기본 90일) 이내로 제한합니다.
- `github_release:gemini-cli`: 공식 GitHub Releases REST에서 `draft=false && prerelease=false`인 안정 릴리스만 수집

Anthropic 뉴스룸, GitHub Trending, Figma HTML은 수집하지 않습니다. 사용자가 `rss.feeds`를 명시하면 기존처럼 그 목록이 기본 피드를 대체합니다.

## 5. 공통 랭킹 원시 함수

모든 v2 점수는 소수 셋째 자리로 반올림합니다.

```text
midrankPct = (동률의 평균 오름차순 1-based rank - 0.5) / 후보 수
```

- 값이 클수록 rank가 높고 단일 후보의 `midrankPct`는 0.5입니다.
- `clamp(x,0,1)`은 0보다 작으면 0, 1보다 크면 1입니다.
- 서로 다른 `ranking.kind`의 점수는 전역 비교하지 않습니다.

## 6. Repository 랭킹

### 6.1 Trending 자격

- 결정적 AI 관련성 규칙 통과
- fork와 archived가 아님
- 누적 별 100개 이상
- `activity_at` 기준 최근 14일 이내 push
- 24시간·7일 기준점 모두 존재하고 Sighting quality가 live

```text
T_abs = clamp(ln(1+stars) / ln(100001), 0, 1)
T     = 0.5×midrankPct(stars) + 0.5×T_abs

relative_h = clamp(max(delta_h,0) / max(baseline_h,100), 0, 1)
G_h        = 0.7×midrankPct(max(delta_h,0)) + 0.3×relative_h

P = 0.25 + 0.75×2^(-pushAgeDays/7)

repoScore = round3(P × (0.50×G_24h + 0.25×G_7d + 0.25×T))
```

- 실제 음수 delta는 signals에 노출하고 점수 계산에서만 0으로 clamp합니다.
- 동률은 24시간 증가량, 총 별 수, Story ID 순으로 풉니다.

### 6.2 Discovery

- AI 관련, 비 fork·비 archived이며 생성 14일 이내인 저장소를 별 하한 없이 포함합니다.
- 본선 점수는 `null`이고 coverage 상태와 관측 신호만 제공합니다.
- 생성 시각 내림차순, 총 별 수 내림차순, Story ID 순으로 정렬합니다.
- Overview에는 자동 혼합하지 않습니다.

## 7. Community 랭킹

대상은 HN, Reddit, DEV이며 기본 후보 윈도는 72시간입니다.

```text
level(value, source, metric) =
  0.6×midrankPct(value, 동일 소스·현재 윈도)
  + 0.4×clamp(
      ln(1+value) / ln(1+max(P95_30d(source,metric), floor)),
      0, 1)

floor: score=100, comments=50

gain(metric,h) =
  0.7×midrankPct(max(delta_h,0), 동일 소스)
  + 0.3×clamp(max(delta_h,0)/max(baseline_h,relativeFloor),0,1)

relativeFloor: score=20, comments=10
V_h = 0.65×scoreGain_h + 0.35×commentGain_h
V   = 0.60×V_6h + 0.40×V_24h

communityScore = round3(
  coverageFactor × 2^(-ageHours/48)
  × weightedAverage(0.45×engagementLevel,
                    0.25×discussionLevel,
                    0.30×V)
)
```

- 30일 P95 표본은 null을 제외한 소스·지표별 값 20개 이상일 때 사용하며, 오름차순 nearest-rank(`ceil(0.95×n)-1`)로 계산합니다. 20개 미만이면 해당 floor만 사용합니다.
- 없는 구성요소는 0으로 넣지 않고 가중치에서 제외한 뒤 남은 가중치를 재정규화합니다.
- current score·comments·6h·24h가 모두 있으면 `coverageFactor=1.0`, 일부가 없으면 0.9입니다.
- current score가 `null`이면 `coverage=unavailable`이며 HOT에서 제외하고 Latest에는 포함합니다.
- 실제 0은 유효값입니다.
- HOT에만 대체 후보가 있을 때 단일 소스 40% 다양성 목표를 적용합니다.
- 동률은 게시 시각 내림차순, Story ID 순으로 풉니다.

## 8. Official 랭킹

- `latest`는 점수 없이 `published_at DESC, id ASC`로 정렬합니다.
- `important`는 title+summary의 결정적 규칙을 다음 우선순위로 판정합니다.

```text
critical 1.00: security, vulnerability, CVE, exploit, deprecation, sunset, EOL, breaking change, migration required
low      0.25: customer story, case study, event, webinar, conference, recap, podcast, interview
high     0.80: model/API/SDK launch, generally available, pricing, rate/usage limit, context window, fine-tuning
normal   0.50: 나머지

판정 우선순위: critical → low → high → normal
communityEcho = 동일 Story의 communityScore 최댓값, 없으면 0

officialScore = round3(
  2^(-ageDays/14) × (0.85×impactWeight + 0.15×communityEcho)
)
```

- Important에만 대체 후보가 있을 때 소스 40% 다양성 목표를 적용합니다.
- Latest에는 소스 제한을 적용하지 않습니다.

## 9. Research와 Legacy

- Research는 `model`, `paper`, DEV가 아닌 `article`입니다.
- `research_hot_v1 = source percentile × exp(-ageHours/36)`이고 score null이면 norm 0.6입니다.
- DEV는 저장 타입 `article`을 유지하지만 Community 채널에 속합니다.
- 기존 전체 공식은 `legacy_hotness_v1`로 유지하고 shadow 기간의 비교에만 사용합니다.

## 10. 공개 CLI·MCP 계약

기존 CLI `ains trends`와 MCP `get_trends` 이름 및 MCP 도구 9개를 유지합니다.

### 10.1 입력

```text
ranking_version: legacy | v2
channel: overview | community | official | repos | research
sort: briefing | hot | latest | important | trending | discovery
```

CLI 옵션은 `--ranking`, `--channel`, `--sort`입니다. 기존 source/type/hours/limit/no-refresh/json 옵션을 유지합니다.

| channel   | 허용 sort           | 기본 sort |
| --------- | ------------------- | --------- |
| overview  | briefing            | briefing  |
| community | hot, latest         | hot       |
| official  | latest, important   | latest    |
| repos     | trending, discovery | trending  |
| research  | hot, latest         | hot       |

- 잘못된 조합은 CLI 종료 코드 1 또는 MCP 입력 오류입니다. 조용히 다른 값으로 교정하지 않습니다.
- `legacy`는 overview/briefing만 허용합니다.
- 0.1.0~0.2.0에서는 옵션이 없으면 legacy가 기본이며 channel/sort를 명시하면 v2를 뜻합니다. 0.3.0부터 옵션 없는 기본은 v2 overview/briefing이며, legacy는 `--ranking legacy`를 명시할 때만 사용합니다(승인 게이트 통과, D-012).
- `channel`만 명시하면 그 채널의 기본 sort를 사용합니다. `sort`만 명시했는데 기본 overview와 호환되지 않으면 채널을 추측하지 않고 오류로 처리합니다. `--ranking legacy`와 v2 전용 channel/sort를 함께 명시해도 오류입니다.
- 기본 조회 기간은 Community 72시간, Official 720시간, Repos 336시간, Research 72시간이며 명시한 hours가 덮어씁니다.

### 10.2 항목 출력

기존 Story 필드에 다음을 추가합니다.

```text
sighting_id, score_kind, comments_count, discussion_url,
activity_at, published_precision,
ranking {
  version, channel, sort, kind, position,
  score, coverage, signals, explanation
}
```

- coverage는 `full | partial | warming | unavailable`입니다.
- `hotness`는 1.0까지 유지하는 deprecated nullable 별칭이며 v2에서는 `ranking.score`와 같습니다.
- Latest와 Discovery처럼 수치 점수가 없는 보기는 `ranking.score=null`, `hotness=null`입니다.
- 같은 ranking.kind 안에서만 score를 비교할 수 있습니다.
- `get_item`은 기존 Story와 legacy score_history에 `sightings[]` 및 Sighting별 metric_history를 추가합니다.
- CLI `--json`은 기존 최상위 배열을 유지하고 Overview 섹션은 각 항목의 `ranking.channel`로 구분합니다. MCP는 `sections[]`와 flattened `items[]`를 함께 반환합니다.

### 10.3 Overview

- Official/important, Repos/trending, Community/hot, Research/hot 네 섹션을 사용합니다.
- 각 섹션에 `floor(limit/4)`를 먼저 배정하고 나머지를 위 순서로 한 개씩 배정합니다.
- 부족한 섹션의 잔여량은 같은 순서로 재배분합니다.
- 같은 Story가 여러 섹션에 있으면 `official → repos → community → research` 순서로 한 번만 포함하고 다른 관측은 signals로 표시합니다.
- MCP 응답은 `sections[]`를 추가하고 기존 `items`에는 섹션 순서로 평탄화한 동일 항목을 제공합니다.
- position은 전역 순위가 아니라 섹션 안의 순위입니다.

### 10.4 빈 섹션 사유 (B-003)

빈 결과는 이유를 설명해야 합니다(11.1의 원칙을 트렌드 출력에 적용).

- `TrendSection`에 additive `notice?: string` 필드를 둡니다. 섹션이 0건이고 사유를 진단할 수 있을 때만 채우며, 기존 필드는 변경하지 않습니다.
- v2 Repos/trending이 0건이면 후보를 진단해 다음 중 하나의 사유를 notice로 제공합니다.
  - `no_candidates`: 조회 윈도 안에 수집된 레포 관측 자체가 없음 → 수집(fetch) 실행 안내
  - `warming`: 자격 조건(6.1)을 기준점 외에는 통과한 후보가 있으나 24시간·7일 기준점이 아직 없음 → 워밍업 중, 수집이 1~7일 쌓이면 표시된다고 안내
  - `filtered`: 후보는 있으나 자격 조건(별 100+, 최근 14일 push, AI 관련성 등) 미충족 → 기준 미충족 안내
- CLI 텍스트 출력은 "표시할 항목이 없습니다." 아래에 `(사유: …)`로 표시하고, MCP `sections[]`에는 `notice` 필드로 포함합니다.
- 다른 채널·정렬의 notice는 필요해질 때 같은 규칙(additive, 0건 + 진단 가능 시)으로 확장합니다.

## 11. 학습 후보 계약

- v2 Story의 `trendScore`는 사용 가능한 채널 점수 중 최댓값이며 같은 Story를 한 번만 집계합니다.
- `hotSum`은 클러스터의 상위 5개 Story trendScore 합입니다.
- velocity는 live Community/Repo Sighting의 유효한 증가율 중 최댓값을 [0,2]로 clamp합니다.
- warming/unavailable Story의 trendScore 기여는 0이지만 증거와 sourceSpread에서는 제외하지 않습니다.
- 기존 novelty와 후보 채택 규칙은 유지합니다.

### 11.1 학습 세션 자료 검색 (T-012)

- `learn session` / `design_learning_session`의 자료 검색은 topic 전체 일치(FTS AND)로 시작하고, 0건이면 단어별 일치(OR)로 1회 완화합니다.
- 완화 후에도 0건이면 오류가 아닙니다. 다만 조용히 빈 뼈대만 반환하지 않고, 0건 사실과 재시도 안내(topic을 영어 키워드 1~2개로 변경 — 수집 코퍼스가 대부분 영어)를 instructions에 명시합니다.
- 완화(OR) 결과가 사용된 경우 instructions에 완화 검색임을 표시해 에이전트가 관련 자료만 선별하게 합니다.
- MCP 응답에는 `search { mode: exact|relaxed|none, matched }` 메타 필드를 추가합니다. 기존 필드(topic, context, instructions)는 변경하지 않습니다.

### 11.2 학습 세션 근거 자료 표기와 지시문 규칙 (B-001·B-002)

- instructions의 근거 자료 목록에는 원문 URL과 함께, 존재하면 대표 토론 URL(primary Sighting 우선, 그다음 점수 높은 Sighting)·점수·댓글 수를 병기합니다. 에이전트가 링크를 열기 전에 우회 경로와 자료의 두께를 가늠하게 하기 위함입니다.
- instructions에는 자료 접근·부족 대응 규칙을 포함합니다: 원문 접근이 차단되면 토론 URL로 우회하되 토론 경유 내용은 2차 자료로 표시하고 미검증 범위로 명시합니다. 근거가 부족하면 ① 세션 범위 축소(사유 명시) ② 보강 검색 또는 재호출 ③ 수집 누적 후 재시도 제안 ④ 세션 미구성·근거 부족 보고 순으로 대응하고, 근거 없는 내용 생성을 금지합니다.
- 실습 단계 지시문은 핫레포/모델 버킷이 비어 있으면 "근거 자료의 방법을 재현하는 실습"으로 대체 렌더링합니다. 지시문은 패키지에 존재하지 않는 자료를 지시하지 않습니다.

### 11.3 항목 기반 세션 설계 (B-005)

- `learn session`은 topic 대신 수집 항목 ID로 세션을 설계할 수 있습니다: CLI `--from-item <id>`, MCP `design_learning_session.from_item`.
- topic과 from-item은 정확히 하나만 지정합니다. 둘 다 지정하거나 둘 다 없으면 CLI 종료 코드 1 또는 MCP 입력 오류이며, 존재하지 않는 항목 ID도 같은 오류로 처리합니다. 조용히 교정하지 않습니다.
- 도구는 토픽을 추출하지 않습니다(D-014): 항목 제목 전체를 검색 토픽으로 사용하고 11.1의 완화 검색 규칙을 그대로 따릅니다. 자료의 품질 판단·선별은 호출 에이전트의 몫입니다.
- 출발 항목은 검색 결과와 무관하게 근거 버킷에 항상 포함하며(검색 결과와 중복이면 한 번만, 해당 버킷 맨 앞), 지시문에 출발 항목임을 명시합니다. 완화 후에도 추가 자료가 0건이면 출발 항목 외 추가 자료가 없다는 안내를 넣되 세션은 성립합니다(출발 항목이 근거로 존재하므로 11.1의 "0건" 재시도 안내와 구분).
- 응답에는 additive `from_item { id, title, url }` 메타 필드를 추가합니다. topic 기반 호출의 기존 필드·동작은 변경하지 않습니다.

- 수집 오류는 `CollectorError { source, kind: http|parse|auth|timeout, status? }`로 분류합니다.
- 5xx·네트워크 GET은 최대 2회 지수 백오프 재시도하고 4xx는 재시도하지 않습니다.
- 연속 실패 3회 이상 소스는 TTL을 4배로 백오프합니다.
- 빈 결과는 오류가 아닙니다.
- summary 없음은 null을 허용합니다.
- 게시 시각 없음은 수집 시각으로 대체하되 `published_precision=inferred`로 표시하고 원본 누락을 raw에 남깁니다.
- 모든 시각은 ISO8601 UTC이고 화면에서만 현지 시간으로 변환합니다.

## 13. 롤아웃과 완료 기준

- 0.1.0: v2 스키마와 snapshot을 배포하고 legacy 기본을 유지합니다. (2026-07-12 publish 완료)
- 워밍업 달력 기준일은 상시 수집(60분 주기)이 시작된 2026-07-12입니다.
- 최초 7일(~2026-07-19): 기준점 워밍업만 수행합니다.
- 다음 7일(~2026-07-26): v2를 shadow/명시 옵션으로 노출하고 legacy 기본을 유지합니다.
- 0.2.0: D-007 개선 묶음(Node 22.12 상향, 숨김 스케줄러, 업데이트 안내, 이중 언어 README, 커스텀 피드 문서)과 미러 export 명령을 배포하고 legacy 기본을 유지합니다. 실사용자 발생으로 게이트 전 publish를 허용합니다(D-010, 2026-07-12).
- 승인 게이트 통과(2026-07-19 조기 통과, D-012)에 따라 0.3.0에서 v2 Overview를 기본으로 전환합니다(D-010으로 0.2.0에서 이동).
- legacy 실행 옵션은 한 minor release 유지하고 0.4.0에서 제거합니다. hotness 출력 별칭은 1.0까지 유지합니다.

승인 게이트는 다음과 같습니다.

- 추적 Repo 24시간 기준점 coverage 95% 이상, 7일 coverage 90% 이상
- Repo top20 전부 full coverage, 별 100개 이상, 최근 14일 push, AI 관련성 통과
- 수동 라벨 Repo·Community precision@20 각각 90% 이상
- 활성 Community current score availability 90% 이상
- 대체 후보가 충분할 때 Community·Official 단일 소스 비중 40% 이하
- HTML 크롤링 0건, GitHub·Reddit rate-limit 오류 증가 없음
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm pack` 전부 통과
- CLI와 MCP가 같은 입력에 같은 Story ID·순서를 반환하고 MCP 도구 수가 9개이며 stdout이 오염되지 않음

AI NEWS HUB와 정확한 순위 일치는 승인 기준이 아닙니다.

## 14. 스냅샷 미러 (D-009)

중앙(GitHub Actions)이 관측을 대신 수행해 정적 파일로 게시하고, 클라이언트는 원할 때 내려받아 로컬 DB에 병합한다. 중앙은 저장·계산·서비스를 하지 않는다(로컬 우선 유지).

### 14.1 범위와 제외

- 포함 소스: `hackernews`, `devto`, `github`만. 해당 소스의 Story·Sighting 메타데이터(제목, URL, 식별자, score_kind, 시각)와 metric snapshot(수치)을 게시한다.
- 제외: Reddit(약관상 재배포 제한·48시간 삭제 의무 — 미러 불가), 공식 RSS 전체(재배포 명시 허용 없음 + 점수가 없어 성장 기준점 불필요 — 피드 자체가 이력을 보관하므로 기능 손실 없음), arXiv·Hugging Face(성장 신호 불필요로 실익 없음).
- 제외 소스는 각 사용자의 로컬 수집으로만 축적되며, 기기가 꺼진 동안의 관측은 복구되지 않는다(완전성 미보장 — 약관 준수를 위한 의도된 제한). 이 사실을 사용자 문서에 명시한다.

### 14.2 산출물과 게시

- 산출물은 시간 버킷 단위 증분 JSON이며 gzip으로 압축한다: `mirror-<UTC 시각 버킷>.json.gz`.
- 각 파일은 `formatVersion`, `exportedAt`, `bucketAt`, 포함 소스 목록, `stories[]`, `sightings[]`, `snapshots[]`를 담는다.
- 같은 저장소의 rolling release(태그 `mirror-data`)에 자산으로 게시하고, `manifest.json`에 자산 목록과 각 파일의 sha256을 기록한다.
- 14일이 지난 자산은 워크플로가 정리한다(일반 스냅샷 보존 정책과 일치).
- 게시 파이프라인의 상태 DB(`mirror-state.db`)는 같은 release에 보관해 실행 간 연속성을 유지하며, 포함 소스(14.1절) 외의 데이터를 담지 않는다.
- 미러 수집·게시 실패는 다음 주기에 재시도하며 클라이언트 동작에 영향을 주지 않는다.

### 14.3 클라이언트 병합 (`ains fetch --seed`, B-007에서 확정)

- 시딩은 옵트인이다: `ains fetch --seed`가 미러 manifest와 자산을 내려받아 병합한 뒤 일반 수집을 이어서 수행한다.
- 병합은 기존 유일 키를 그대로 사용해 멱등이어야 한다: Story `sha256(canonical_url)`, Sighting `sha256(source, source_key)`, Snapshot `(sighting_id, bucket_at)` — ID가 결정적이므로 미러와 로컬이 같은 관측에 같은 ID를 만든다.
- 충돌 규칙(로컬 우선): Story·Sighting이 로컬에 이미 있으면 내용 필드는 로컬을 유지하고 관측 시각 범위만 넓힌다(`first_seen_at`은 이른 쪽, `last_seen_at`은 늦은 쪽). Snapshot 충돌은 최신 `observed_at` 우선(2.3절 규칙).
- `quality`는 게시된 값을 그대로 병합한다. 중앙 파이프라인도 동일 수집기의 라이브 관측이며, 별도 표기를 하면 랭킹 자격(quality=live)에서 제외되어 시딩 목적(성장 기준점 공급)이 무산되기 때문이다. `raw`는 미러에 없으므로 null로 저장한다.
- 병합 후 영향받은 Story의 primary Sighting을 재계산한다.
- 다운로드 파일은 병합 전 manifest의 sha256과 대조하고, 검증 실패·손상 파일은 그 파일만 폐기하고 나머지를 계속 처리한다. 시딩 전체의 실패(미러 접속 불가 등)는 일반 수집을 깨지 않는다(1절 격리 원칙).
- 미러 주소는 설정 `mirror.repo`(기본 `gorhkdwj/AI-News-Supplier`)와 `mirror.tag`(기본 `mirror-data`)로 변경할 수 있다. 사용자는 fork에서 같은 워크플로를 돌려 자기만의 미러를 운영하고 그 주소를 지정할 수 있다(탈중앙 대비).

## 15. 외부 자료 기록

| URL                                                                                  | 제목                     | 확인일     | 판단 및 적용                                    |
| ------------------------------------------------------------------------------------ | ------------------------ | ---------- | ----------------------------------------------- |
| https://raw.githubusercontent.com/anthropics/claude-code/main/feed.xml               | Claude Code Changelog    | 2026-07-10 | 공식 Atom 피드, `rss:claude-code`               |
| https://cursor.com/changelog/rss.xml                                                 | Cursor Changelog         | 2026-07-10 | 공식 RSS, `rss:cursor`                          |
| https://www.figma.com/release-notes/feed/atom.xml                                    | Figma Release Notes      | 2026-07-10 | 공식 Atom, AI 필터 후 `rss:figma`               |
| https://docs.github.com/en/rest/releases/releases#list-releases                      | GitHub Releases REST API | 2026-07-10 | Gemini CLI stable release 수집                  |
| https://www.reddit.com/dev/api/#GET_hot                                              | Reddit API `GET hot`     | 2026-07-10 | OAuth per-subreddit hot 수집                    |
| https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki | Reddit Data API Wiki     | 2026-07-10 | OAuth, User-Agent, rate limit, 삭제·48시간 보존 |
| https://redditinc.com/policies/data-api-terms                                        | Reddit Data API Terms    | 2026-07-10 | 콘텐츠 삭제·사용 범위 준수                      |
