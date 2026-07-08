# 구현 계획 · ai-news-supplier

> 처음부터 전체를 달리지 않는다. 가장 작은 성공 단위부터. 각 단계는 완료 조건과 검증 방법을 명시한다.
> 아키텍처·스키마·도구 사양 상세: `docs/plans/2026-07-09-ai-news-supplier-plan.md`

## 단계 개요
| 단계 | 목표 | 완료 조건 | 검증 방법 | 의존/연결 |
|------|------|-----------|-----------|-----------|
| S0 | 스캐폴드 | 빌드·테스트 파이프라인 동작 | `npm run build` 후 `node dist/cli/index.js --version`, vitest 통과 | 없음 |
| S1 | 워킹 스켈레톤 (DB+HN 수집기+CLI) | `ains fetch`→DB 축적, `ains trends/search/show` 동작 | 2회 실행 시 dedup+TTL skip 확인, 단위테스트 | S0 |
| S2 | 수집기 완성 (github/rss/hf/arxiv/devto/reddit) | 전 소스 수집 정상, 소스 1개 고장에도 나머지 성공 | 소스별 fixture 테스트, 고장 주입 테스트 | S1 |
| S3 | MCP 서버 | Claude Code에서 데이터 도구 5종 호출 가능 | SDK Client stdio 스모크 테스트, 실등록 확인 | S1 (S2와 병행 가능) |
| S4 | 학습 기능 | 학습 도구 4종+프롬프트 3종 동작, 이력 반영 | 합성 DB 후보 발굴 테스트, learn-today E2E | S2, S3 |
| S5 | 스케줄러·배포 준비 | schedule/retention/doctor 완성, npm 패키징 검증 | schtasks 등록·실행·해제, 클린 설치 후 doctor green | S1~S4 |

## 단계 상세

### S0 · 스캐폴드
- 왜 필요한가: 빌드·테스트가 처음부터 돌아야 이후 모든 단계가 검증 가능
- 내용: package.json(bin: ains/ains-mcp, engines node≥20), tsconfig(strict/ESM), tsup, vitest, eslint(core→cli/mcp import 금지 규칙)+prettier, 버전만 출력하는 빈 CLI
- 완료 조건: 빌드 산출물이 실행되고 placeholder 테스트 통과
- 검증 방법: `npm run build && node dist/cli/index.js --version`, `npx vitest run`
- 실패 시 중단점: better-sqlite3 설치 실패 시 Node 버전/프리빌드 확인(T-ID 기록)

### S1 · 워킹 스켈레톤
- 왜 필요한가: "수집→축적→조회" 전체 파이프라인을 한 소스로 끝까지 관통해야 구조 검증이 됨
- 내용: DB 연결(WAL)+마이그레이션+전체 스키마, itemStore(upsert/dedup/FTS/purge), normalize(canonical URL+sha256), config(zod), http 래퍼, 수집기 계약+registry+refresh 오케스트레이터, **Hacker News 수집기**, CLI `trends/fetch/search/show/doctor(기본)`
- 다음 단계로 전달: 수집기 계약과 스토어 — S2는 수집기만 추가, S3는 조회만 추가
- 완료 조건: `ains fetch`가 실제 HN 데이터를 DB에 축적, `ains trends` 랭킹 출력
- 검증 방법: 2회 연속 실행 시 두 번째는 dedup(items_new≈0)+TTL skip / normalize·upsert 충돌·마이그레이션 멱등성·HN fixture 단위테스트
- 실패 시 중단점: FTS5 미지원 빌드 감지 시 대체 검색(LIKE) 결정 필요

### S2 · 수집기 완성
- 왜 필요한가: "담을 수 있는 소스는 최대한"이 제품 요구
- 내용: github, rss(피드별 인스턴스+조건부 GET), huggingface, arxiv, devto, reddit(키 게이트), keywords(AI 관련성 필터), score_history 기록, rank.ts 완성(백분위+감쇠+인터리브)
- 완료 조건: 전 소스가 fetch_log에 ok, `ains trends`에 소스 혼합 노출
- 검증 방법: 소스별 fixture 테스트 / 설정에 잘못된 URL 주입 시 해당 소스만 error이고 나머지 성공+CLI 정상 종료(핵심 수용 기준)
- 실패 시 중단점: 특정 API 사양 변경 발견 시 계획서의 엔드포인트 갱신 후 진행

### S3 · MCP 서버
- 왜 필요한가: 에이전트 공급이 제품의 존재 이유
- 내용: tools.ts(get_trends/search_news/get_item/refresh_sources/get_source_status), prompts.ts, server.ts(stdio), `ains mcp` 명령, stdout 위생 감사(stderr 로거 강제)
- 완료 조건: MCP 클라이언트에서 listTools/callTool 정상
- 검증 방법: SDK Client+StdioClientTransport 스모크 테스트(임시 AINS_HOME, 시드 DB) / Claude Code 실등록 후 "AI 트렌드 알려줘" 실사용 확인
- 실패 시 중단점: stdout 오염 발견 시 로거 경로 전수 점검

### S4 · 학습 기능
- 왜 필요한가: 차별화 기능(에이전트 주도 학습 설계)
- 내용: topics(용어 추출+엔티티 사전+블록리스트), candidates(클러스터링+learnScore), session(증거 버킷+지시문 템플릿), learningStore, MCP 도구 4종+프롬프트 연결, CLI `learn/history`
- 완료 조건: 후보 발굴→세션 설계→이력 기록→다음 후보에서 제외의 순환이 동작
- 검증 방법: 합성 DB(3소스 등장 토픽)에서 최상위 후보 확인, record 후 제외 확인, Claude Code에서 learn-today E2E
- 실패 시 중단점: 후보 품질이 눈에 띄게 낮으면 사전/블록리스트 보강 후 재평가(D-003 재검토 조건)

### S5 · 스케줄러·배포 준비
- 왜 필요한가: 장기 축적 옵션과 공개 배포 품질 확보
- 내용: `ains schedule install/uninstall/status`(win32 schtasks 우선→cron), retention purge 연결, doctor 완성(연결 핑·DB 무결성·스케줄 상태), README 실사용 문서화, npm publish 준비(`files: dist`, prepublishOnly)
- 완료 조건: 스케줄 등록→수동 트리거→fetch_log 증가→해제 확인, 클린 설치 검증
- 검증 방법: Windows 11 실기 확인, `npm pack` 타르볼을 별도 폴더에 설치 후 `ains doctor` 전 항목 정상
- 실패 시 중단점: schtasks 권한 문제 시 사용자 안내 문구로 우아하게 실패 처리
