# Troubleshootinglog · ai-news-supplier

실제 오류·실패·환경 문제·검증 실패·설계 충돌이 발생하면 기록한다. 같은 문제가 반복되면 새 T-ID를 만들기 전에 기존 T-ID를 먼저 확인한다. (규칙: CLAUDE.md 11절)

## 기록 형식
```
### T-00N · 문제 제목
**발생 상황** / **증상** / **확인된 원인** / **조치** / **재발 방지**
```

---

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
