# Troubleshootinglog · ai-news-supplier

실제 오류·실패·환경 문제·검증 실패·설계 충돌이 발생하면 기록한다. 같은 문제가 반복되면 새 T-ID를 만들기 전에 기존 T-ID를 먼저 확인한다. (규칙: CLAUDE.md 11절)

## 기록 형식
```
### T-00N · 문제 제목
**발생 상황** / **증상** / **확인된 원인** / **조치** / **재발 방지**
```

---

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
