# Troubleshootinglog · ai-news-supplier

실제 오류·실패·환경 문제·검증 실패·설계 충돌이 발생하면 기록한다. 같은 문제가 반복되면 새 T-ID를 만들기 전에 기존 T-ID를 먼저 확인한다. (규칙: CLAUDE.md 11절)

## 기록 형식
```
### T-00N · 문제 제목
**발생 상황** / **증상** / **확인된 원인** / **조치** / **재발 방지**
```

---

### T-006 · 랭킹 v2 최종 감사에서 경계·재관측 누락 발견

**발생 상황**

- 유형별 랭킹 v2 전체 diff를 계약·fixture·인라인 재현으로 독립 감사

**증상**

- 같은 Story의 낮은 커뮤니티 Sighting이 다양성 재배치 때문에 높은 Sighting보다 대표로 선택될 수 있었음
- GitHub 신규 검색이 `topic:llm`과 `topic:ai`를 동시에 요구하고 본선의 14일·100-star 경계를 일부 누락했으며, 추적 저장소가 50개를 넘으면 같은 50개만 반복 재관측했음
- Reddit hot 응답의 removed 게시물이 다음 주기까지 저장될 수 있었고 Gemini Releases의 비정상 200 응답은 표준 parse 오류가 아닌 `TypeError`가 되었음
- 오래전에 생성됐지만 최근 push된 Trending Repo가 학습 후보의 기간 필터에서 빠졌음

**확인된 원인**

- 전체 후보를 반환할 때도 source diversity가 순서를 바꾼 뒤 Story dedupe를 수행했음
- GitHub 검색 qualifier의 교집합·부등호·7일 범위와 `last_seen_at DESC` 입력의 앞 50개 고정 선택이 계약 경계와 맞지 않았음
- Reddit hot 병합 경로가 기존 `/api/info` 경로의 삭제 판정을 공유하지 않았고 Gemini JSON은 TypeScript 단언만 사용했음
- 학습 recency가 Repo의 `activity_at` 대신 게시·최초 관측 시각만 사용했음

**조치**

- 전체 population에는 diversity 재정렬을 적용하지 않고 최고 점수 Sighting을 Story 대표와 community echo에 사용
- GitHub 검색을 AI OR, 생성·push 14일, `stars:>=100`으로 수정하고 가장 오래 미관측된 저장소부터 50개씩 순환 재검증
- Reddit 신규·tracked removed를 같은 refresh에서 제외·삭제하고 삭제 key를 중복 제거하며, Gemini Releases 배열·필드를 런타임 검증해 `CollectorError(kind=parse)`로 분류
- 학습 Repo 기간 판정에 `activity_at`을 우선 사용하고 기간 밖 alternate Sighting을 sourceSpread·용어·velocity에서 제외

**재발 방지**

- 다중 Sighting 대표 선택, 정확한 경계값, 51개 2주기 재관측, removed hot, malformed 200, 기존 Repo 최근 push를 각각 fixture 회귀 테스트로 고정
- 단계 테스트 뒤에도 계약 전체를 보는 독립 감사를 수행하고 P0/P1 해소 후 전체 테스트·패키징을 새로 실행

### T-005 · VACUUM INTO 백업의 암시적 rowid 보존 비보장
**발생 상황**
- v1 사전 백업 복원 시 `items.rowid`와 external-content FTS docid가 안전한지 코드 리뷰

**증상**
- 로컬 SQLite에서는 간격 있는 rowid 71/701과 FTS MATCH가 보존됐지만, SQLite는 `INTEGER PRIMARY KEY`가 아닌 암시적 rowid를 VACUUM이 변경할 수 있다고 명시함

**확인된 원인**
- `items.id`는 `TEXT PRIMARY KEY`이며 FTS가 `items.rowid`를 content rowid로 사용하므로 item count만 같은 백업은 안전한 복구본임을 증명하지 못함

**조치**
- 원본과 백업의 전체 item 값·ID·rowid, FTS row/content·실제 MATCH, trigger, score/learning/source/fetch 상태를 비교하고 불일치 시 마이그레이션을 중단
- 같은 디렉터리의 `.bak.tmp`에 VACUUM한 뒤 검증 성공 시에만 최종 `.bak`로 rename하며 실패 임시 파일은 정리
- 고정 v1 fixture에 간격 있는 rowid를 넣어 백업 결과와 실제 FTS 검색을 자동 검증

**재발 방지**
- 논리 행 수만 확인하지 않고 복구에 필요한 숨은 식별자와 파생 인덱스까지 원본-백업 전수 비교함

### T-004 · 마이그레이션 실패 시 SQLite 연결 미정리
**발생 상황**
- 파일 v1 DB의 사전 백업 실패를 강제하는 테스트에서 `openDb` 오류 경로를 검증

**증상**
- 마이그레이션 오류는 전달되지만 `openDb`가 연 연결이 닫히지 않아 Windows에서 임시 DB 폴더 정리가 `EPERM`으로 실패할 수 있음

**확인된 원인**
- 기존 `openDb`가 PRAGMA와 `runMigrations`를 호출한 뒤 성공 경로에서만 DB를 반환하며, 초기화 중 예외를 정리하는 `catch`가 없었음

**조치**
- 초기화·마이그레이션을 `try/catch`로 감싸고 예외 시 열린 연결을 닫은 뒤 원래 오류를 다시 던지도록 수정
- 실패 중 열린 인스턴스를 포착해 `close` 호출 여부를 확인하는 회귀 테스트 추가

**재발 방지**
- 파일 자원을 여는 초기화 함수는 성공 경로뿐 아니라 백업·검증·마이그레이션 실패 경로의 정리도 테스트함

### T-003 · Meta AI 블로그 RSS 피드 404
**발생 상황**
- S2 라이브 수집에서 `rss:metaai`가 404

**증상**
- `https://ai.meta.com/blog/rss/` 및 후보 URL(`/blog/feed/`, `/feed/`) 모두 404/오류.

**확인된 원인**
- Meta AI 블로그가 해당 경로로 공개 RSS를 제공하지 않음(피드 URL 드리프트/부재). 확실한 대체 URL 미확인.

**조치**
- 기본 피드 목록(DEFAULT_FEEDS)에서 metaai 제거. 피드별 오류 격리로 나머지 RSS는 정상 동작. 사용자가 유효 URL을 알면 config로 추가 가능.

**재발 방지**
- 존재가 확인되지 않은 피드는 기본값으로 두지 않는다(CLAUDE.md 8절). 피드 URL은 구현 시점 실물 확인 대상(계획서).

### T-002 · RSS 항목 필드가 객체로 파싱되어 SQLite bind 실패
**발생 상황**
- S2 라이브 수집에서 `rss:googleai`가 "SQLite3 can only bind numbers, strings, bigints, buffers, and null"로 실패

**증상**
- 특정 피드에서 upsert 시 bind 오류. 해당 소스 0건.

**확인된 원인**
- rss-parser가 일부 피드의 필드(title/creator 등)를 CDATA/속성 포함 객체(`{ _: '...', $: {...} }`)로 반환. 객체가 그대로 SQLite 바인딩에 전달됨.

**조치**
- rss 수집기에 asString() 헬퍼를 추가해 문자열/객체(`_` 추출)/숫자를 안전하게 문자열화, 그 외는 null. title/link null이면 항목 skip. 재실행 시 googleai 20건 정상.

**재발 방지**
- 외부 파서(rss-parser 등) 출력은 타입을 신뢰하지 말고 저장 전 원시 타입으로 정규화한다.

### T-001 · HN Algolia API가 points numericFilter에 400 반환
**발생 상황**
- S1 라이브 검증에서 `ains fetch` 실행 시 hackernews 수집이 HTTP 400으로 실패

**증상**
- `numericFilters=created_at_i>...,points>10` 요청이 400 Bad Request. 수집 0건.

**확인된 원인**
- 파라미터를 분리 테스트한 결과 `created_at_i>` 필터는 200이지만 `points>N`(및 `points>=N`)은 단독으로도 400. HN Algolia 검색 인덱스가 points를 numericFilters 대상으로 지원하지 않음(현재).

**조치**
- hackernews 수집기에서 numericFilters를 `created_at_i>` 만 사용하도록 수정하고, minPoints는 수집 후 클라이언트에서 `hit.points >= minPoints`로 필터링. 재실행 결과 72h 윈도로 63건 정상 수집.

**재발 방지**
- 외부 API 필터 파라미터는 라이브에서 파라미터별로 분리 검증한다. (fixture 테스트만으로는 실제 API 제약을 못 잡음 — 라이브 검증 병행 필요)
- 부수 확인: 초기에 클럭 스큐(시스템 2026-07 vs HN 데이터)를 의심했으나, 실제로는 최신 데이터가 존재했고 원인은 points 버그였음.
