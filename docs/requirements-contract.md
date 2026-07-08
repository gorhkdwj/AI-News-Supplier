# 기준 계약 문서 · ai-news-supplier

> 구현 전에 합의해 고정한다. 기준이 바뀌면 코드보다 이 문서를 먼저 갱신하고 Decisionlog에 이유를 남긴다. 같은 지표가 파일마다 다르게 정의되지 않게 한다.
> 상세 스키마 DDL·엔드포인트는 `docs/plans/2026-07-09-ai-news-supplier-plan.md` 참조. 충돌 시 이 문서가 지표·판정 기준의 최종 기준이다.

## 입력 형식
- 외부 소스 응답: Hacker News(Algolia JSON), GitHub(search API JSON), RSS/Atom(XML), Hugging Face(JSON), arXiv(Atom XML), DEV.to(JSON), Reddit(OAuth JSON)
- 사용자 설정: `~/.ai-news-supplier/config.json` (sparse 오버라이드, zod 검증, 알 수 없는 키는 경고만)
- 환경변수: `AINS_HOME`(데이터 디렉터리 오버라이드), `GITHUB_TOKEN`, `AINS_REDDIT_CLIENT_ID/SECRET` (env가 config보다 우선)

## 출력 형식
- 정규화 항목(NewsItem): `{ id, source, type, title, url, canonical_url, summary, author, score, comments_count, tags[], published_at, first_seen_at, last_seen_at, raw }`
  - `id` = sha256(canonical_url) 앞 16자(hex)
  - `type` ∈ `community | official_update | hot_repo | model | paper | article`
  - `source` ∈ `hackernews | github | huggingface | arxiv | devto | reddit | rss:<feedId>`
- MCP 도구 응답: structuredContent(JSON) + 간결한 텍스트 렌더링 병행
- CLI: 사람이 읽는 표 형식 기본, `--json` 플래그 시 기계 판독 JSON

## 주요 지표 정의
- **hotness**: 항목의 현재 화제성. 소스 간 점수 단위가 다르므로(HN 포인트 vs GitHub 스타) 소스 내 백분위로 정규화한 뒤 시간 감쇠를 적용
- **learnScore**: 토픽 클러스터의 학습 가치. 멀티소스 등장(sourceSpread), 급상승(velocity), 화제성 합(hotSum), 신규성(novelty)의 조합
- **신선도(TTL)**: 소스별 마지막 성공 수집 후 경과 시간이 TTL(기본 60분, 소스별 설정) 이내면 신선한 것으로 판정, 수집 생략

## 수식
```
hotness = norm × decay × typeBoost
  norm      = 동일 소스·조회 윈도(기본 72h) 내 score 백분위 ∈ [0,1]
              (score가 null인 항목: 0.6 고정)
  decay     = exp(-age_hours / 36)            # 반감기 약 25시간
  typeBoost = official_update 1.2 / hot_repo 1.1 / 그 외 1.0

learnScore = novelty × (2×sourceSpread + hotSum + velocity + ln(1+itemCount))
  sourceSpread = 클러스터 내 고유 소스 수
  velocity     = (score_now - score_24h_ago)/max(score_24h_ago,1) 평균, [0,2]로 클램프
  hotSum       = 클러스터 상위 5개 항목 hotness 합
  novelty      = 미학습 1.0 / 90일 내 학습 0.15 / 90일 이전 학습 0.5
```

## 상태 판정 기준
- 수집기 활성: `isEnabled(config)` — Reddit은 clientId+clientSecret 둘 다 있을 때만 활성(없으면 오류가 아니라 비활성)
- 수집 실행: `now - last_success_at > TTL` 또는 `--force`일 때만 실행
- 학습 후보 채택: `sourceSpread ≥ 2` 또는 `(itemCount ≥ 3 AND velocity > 0.5)`
- 노출 인터리브: 상위 N 결과에서 단일 소스 비중 최대 40%(config `maxPerSourceRatio`)

## 오류 판정 기준
- 수집 오류는 typed `CollectorError { source, kind: http|parse|auth|timeout, status? }`로 분류
- **한 소스의 오류가 전체 수집·조회를 절대 실패시키지 않는다** (Promise.allSettled, 소스별 격리)
- 연속 실패 3회 이상 소스는 유효 TTL을 4배로 백오프
- HTTP 재시도: 5xx/네트워크 오류의 GET만 최대 2회(지수 백오프), 4xx는 재시도 금지
- 빈 결과는 오류가 아니다

## 허용 값 / 허용하지 않을 값
- 허용: 공개 API·RSS·허용된 공개 데이터만 수집, 각 API rate limit 준수(arXiv 3초당 1요청 등)
- 비허용: 도구 자체의 LLM API 호출, MCP 서버 프로세스의 stdout 로그 출력(stderr만 허용), 코드·문서·로그 내 토큰/키, 무단 크롤링

## 누락 데이터 처리
- `score` null(RSS, arXiv 등 투표 없는 소스) → hotness의 norm을 0.6 고정값으로 처리
- `published_at` 없음 → 수집 시각으로 대체하고 raw에 원본 보존
- summary 없음 → null 허용, upsert 시 기존 값이 있으면 COALESCE로 보존

## 시간대·단위·반올림 기준
- 모든 시각은 ISO8601 UTC 문자열로 저장, 표시할 때만 로컬 변환
- TTL·시간 예산은 분(minutes) 단위, 조회 윈도는 시간(hours)·일(days) 단위
- hotness/learnScore는 소수 셋째 자리 반올림해 노출

## 완료 기준
- 각 구현 단계(S0~S5)의 완료 조건·검증 방법은 `docs/plans/implementation-plan.md`를 따른다
- 최종 완료: `npm pack` 후 클린 환경 설치 → `ains doctor` 전 항목 정상, Claude Code에 MCP 등록해 도구 9종 호출 확인, vitest 전체 통과(Windows+Linux)
- 중복 판정: canonical_url(utm 제거·정규화, arXiv 버전 접미사 제거) 기준 UNIQUE — 같은 글이 두 번 수집되면 새 행이 아니라 기존 행 갱신(first_seen_at 보존)
