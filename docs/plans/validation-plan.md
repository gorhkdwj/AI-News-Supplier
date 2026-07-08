# 검증 계획 · ai-news-supplier

기능을 만들 때마다 영향 범위에 맞게 검증한다. 검증하지 못한 부분은 숨기지 않고 `미검증 범위`에 적는다. 실패한 테스트를 삭제·완화하지 않고 원인을 수정한다.

## 검증 항목
- 단위 테스트: normalize(canonical URL·해시), upsert 충돌 경로(first_seen_at 보존), 마이그레이션 멱등성, rank 수식, 학습 후보 스코어링(수식은 docs/requirements-contract.md 기준)
- 통합 테스트: refresh 오케스트레이터(정상+고장 수집기 혼합 → 부분 성공), MCP stdio 스모크(listTools/callTool)
- 입력 검증: config zod 스키마(잘못된 키 경고, 잘못된 타입 거부), MCP 도구 입력 스키마
- 오류 상황 검증: HTTP 4xx/5xx/timeout별 CollectorError 분류, 연속 실패 백오프, 소스 1개 고장 시 전체 생존(핵심 수용 기준)
- 경계값 검증: score null 항목의 hotness, 빈 DB에서의 trends/candidates, TTL 정확히 경계인 경우, FTS 특수문자 검색어
- 문서-코드 정합성: 지표 수식이 requirements-contract와 코드에서 일치하는지 단계 종료마다 대조
- README-기능 일치: 구현 완료된 기능만 README에 기재
- 배포물 구조: `npm pack` 산출물에 dist만 포함, 클린 설치 후 `ains doctor` 전 항목 정상

## 검증 방법과 도구
- vitest: 단위·통합 테스트. 수집기는 실제 네트워크 대신 `tests/fixtures/`의 녹화된 API 응답(JSON/XML)을 주입한 HttpClient 스텁으로 검증
- DB 테스트: better-sqlite3 `:memory:` 인스턴스, `now` 주입으로 결정적 시간 테스트
- MCP: SDK Client + StdioClientTransport로 자식 프로세스 실행, 임시 `AINS_HOME`과 시드 DB 사용(stdout 순수성 동시 검증)
- 실사용 검증: Claude Code에 MCP 등록 후 도구 호출, Windows 11 실기에서 schtasks 등록·해제
- CI(도입 시): GitHub Actions windows-latest+ubuntu-latest × Node 20/22 (Windows는 better-sqlite3 프리빌드 카나리)
- 라이브 네트워크 테스트는 CI에서 제외하고 수동 태그로만 실행

## 미검증 범위
- (현재) 전체 — 구현 미착수 상태
- (예정) macOS 실기 동작(cron 등록 포함): 실기 부재 시 미검증으로 명시하고 배포 문서에 표기
- (예정) 외부 API의 장기 사양 안정성: fixture 기준 검증이므로 실서비스 드리프트는 doctor·fetch_log로 사후 감지
