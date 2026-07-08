# Troubleshootinglog · ai-news-supplier

실제 오류·실패·환경 문제·검증 실패·설계 충돌이 발생하면 기록한다. 같은 문제가 반복되면 새 T-ID를 만들기 전에 기존 T-ID를 먼저 확인한다. (규칙: CLAUDE.md 11절)

## 기록 형식
```
### T-00N · 문제 제목
**발생 상황** / **증상** / **확인된 원인** / **조치** / **재발 방지**
```

---

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
