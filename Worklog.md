# Worklog · ai-news-supplier

주요 사용자 요청이 끝날 때마다 아래 형식으로 누적 기록한다. (규칙: CLAUDE.md 11절). 최신 항목을 위에 추가한다.

## 기록 형식
```
### W-00N · 작업 제목
**요청** / **수행 작업** / **변경 파일** / **검증** / **판단 근거** / **결과**
```

---

### W-010 · S5 스케줄러·보존·배포 준비 (구현 목표 완주)
**요청**
- S5 단계(스케줄러 + retention + doctor 완성 + README + 배포 준비) 구현 및 검증

**수행 작업**
- scheduler/index.ts: Windows(schtasks)·unix(crontab) 주기 수집 등록/해제/상태. 셸 없는 execFileSync 사용(보안)
- CLI `schedule install/uninstall/status`, `config path/show/init/edit`
- retention을 refreshStale 시작에 연결(retentionDays 초과 항목 + 30일 초과 fetch_log 정리)
- doctor에 보존 정책·스케줄 상태 표시
- README 전면 작성(실사용 기능만: 설치/CLI/MCP 등록/자동수집/설정/프라이버시), .gitattributes(LF 정규화)

**변경 파일**
- src/scheduler/index.ts, src/cli/commands/{schedule,config}.ts, src/cli/{index,commands/doctor}.ts, src/core/refresh.ts
- README.md, .gitattributes

**검증**
- typecheck 통과, 테스트 43개 통과, lint 0
- 라이브(Windows): schedule install → schtasks 등록 확인 → status "등록됨" → uninstall → "미등록" 라이프사이클
- config init/path/show, doctor(보존·스케줄·전 소스) 정상
- 배포물: npm pack이 dist+README+package.json만 포함(6파일, 131.7kB)
- **클린 설치 검증**: tarball을 빈 폴더에 설치 → better-sqlite3 프리빌드 정상 로드(DB 무결성 ok) → ains doctor 전 항목 정상 → .cmd 래퍼 --version=0.0.1

**판단 근거**
- 계획서 S5 완료 조건(schedule 라이프사이클, 클린 설치 후 doctor green) 충족. 목표(S0~S5 단계별 검증 완주) 달성.

**결과**
- 완료: S5 및 전체 MVP(수집 7종 + MCP 9도구/3프롬프트 + CLI + 학습 + 스케줄러)
- 미검증 범위: macOS/Linux cron 실기(Windows schtasks만 실기 검증, unix는 로직만). github/devto/huggingface/rss 수집기 단위 테스트(라이브+통합으로 커버). npm 레지스트리 실제 배포는 미수행(pack 검증까지)

### W-009 · S4 학습 기능
**요청**
- S4 단계(학습 후보 발굴/세션 설계/이력 + MCP 도구 4종 + learn 프롬프트 + CLI) 구현 및 검증

**수행 작업**
- core/learning/topics.ts: 룰 기반 용어 추출(엔티티 사전~80개, 별칭, 블록리스트, 버전형 토큰, arXiv 카테고리 태그 제외)
- core/learning/candidates.ts: 용어 클러스터링(60% 겹침 병합) + learnScore(novelty×(2×sourceSpread+hotSum+velocity+ln(1+n))) + 증거 버킷 + 채택 필터
- core/learning/session.ts: FTS 증거 수집 + 레벨/시간 파라미터 지시문 템플릿(브리핑→개념→실습→점검→추가자료→record 안내)
- core/store/learningStore.ts: 학습 이력 CRUD + 정규화 토픽 기반 novelty 조회
- MCP 도구 4종(get_learning_candidates, design_learning_session, record_learning, get_learning_history) + 프롬프트 learn-today/deep-dive
- CLI: learn(candidates 기본/session/record), history

**변경 파일**
- src/core/learning/{topics,candidates,session}.ts, src/core/store/learningStore.ts
- src/mcp/{tools,prompts}.ts, src/cli/commands/{learn,history}.ts, src/cli/{format,index}.ts
- tests/core/learning.test.ts, tests/mcp/smoke.test.ts(9종+프롬프트3+record→history)

**검증**
- typecheck 통과, 테스트 43개 통과, lint 0
- 학습 코어 단위: 3소스 등장 토픽(moe) 최상위 후보, 기록 후 includeLearned=false 제외, 세션 지시문 생성
- 라이브: learn candidates가 agentic/transformers/openai/gpt/reasoning 발굴, record 후 해당 토픽 제외, history 표시
- MCP 스모크: 학습 도구 4종 노출, record_learning→get_learning_history 반영

**판단 근거**
- 계획서 S4 완료 조건(후보→세션→기록→제외 순환) 충족. 도구 자체 LLM 미호출(지능은 에이전트).
- 후보 품질 개선: arXiv 카테고리 태그(cs.AI 등) 토픽 제외

**결과**
- 완료: 학습 기능 전체(코어+MCP+CLI)
- 남은 작업: S5 스케줄러/retention/doctor완성/README/배포

### W-008 · S3 MCP 서버
**요청**
- S3 단계(MCP stdio 서버 + 데이터 도구 + ains mcp) 구현 및 검증

**수행 작업**
- MCP 데이터 도구 5종(get_trends, search_news, get_item, refresh_sources, get_source_status)을 zod 입력 스키마로 등록. structuredContent+text 반환
- 프롬프트 trend-briefing 등록(learn 계열은 S4)
- mcp/run.ts(startMcpServer), mcp/server.ts(bin 진입), cli `ains mcp` 명령
- tsup entry에 mcp/server 추가(dist/mcp/server.js 생성). 버전 상수에 define 미적용 환경(tsx) fallback 추가
- stdout 위생: 서버 경로는 logger(stderr)만 사용

**변경 파일**
- src/mcp/{tools,prompts,run,server}.ts, src/cli/commands/mcp.ts, src/cli/index.ts, tsup.config.ts
- tests/mcp/smoke.test.ts (tsx로 소스 stdio 실행)

**검증**
- typecheck 통과(zod 4가 MCP SDK 1.29 ZodRawShapeCompat와 호환 확인), 테스트 36개 통과, lint 0
- MCP stdio 스모크: Client 연결 → listTools 5종 → callTool get_trends가 시드 항목을 structuredContent로 반환 → listPrompts에 trend-briefing
- 빌드: dist/mcp/server.js 생성 확인

**판단 근거**
- 계획서 S3 완료 조건(MCP 클라이언트에서 도구 호출) 충족. 소스 disabled 시드로 네트워크 없이 통합 검증.

**결과**
- 완료: MCP 서버 + 데이터 도구 5종
- 남은 작업: S4 학습 기능(도구 4종 + learn 프롬프트)
- 미검증 범위: 빌드된 dist 서버를 실제 Claude Code에 등록한 end-to-end는 수동 확인 필요(스모크로 프로토콜/도구는 검증됨)

### W-007 · S2 수집기 완성
**요청**
- S2 단계(나머지 수집기 6종 + registry + rank 검증) 구현 및 단계별 검증

**수행 작업**
- 수집기 6종: github(search API, 토큰 선택), huggingface(models+daily_papers), arxiv(Atom XML, fast-xml-parser, 버전 접미사 제거 dedup), devto(태그+반응수+키워드 필터), reddit(OAuth client_credentials, 키 게이트, 토큰 메모리 캐시), rss(피드별 인스턴스+조건부 GET+필드 정규화)
- http 클라이언트에 postForm 추가(reddit OAuth). registry를 STATIC_COLLECTORS + 동적 RSS(enabledCollectors/allCollectors)로 확장. doctor를 allCollectors 기반으로 갱신
- 각 API 응답 형태를 라이브로 실물 확인 후 파서 작성(계획서 재확인 원칙)

**변경 파일**
- src/collectors/{github,huggingface,arxiv,devto,reddit,rss}.ts, registry.ts
- src/core/http.ts(postForm), src/core/config.ts(metaai 제거), src/cli/commands/doctor.ts
- tests: collectors/{arxiv,reddit}, core/rank, fixtures/{arxiv.atom.xml,reddit-hot.json}, refresh 격리 테스트, stubHttp postForm

**검증**
- typecheck 통과, 테스트 33개 통과, lint 0
- 라이브 fetch --force: hackernews 63, github 60, huggingface 55, arxiv 75, devto 24, rss:openai/deepmind/googleai/hfblog 정상 수집. reddit은 키 없어 비활성(정상)
- trends에 HN/RSS/devto/github 혼합 노출(인터리브 동작)
- 격리 검증: 한 소스(github) 실패해도 hackernews 정상 저장

**판단 근거**
- 계획서 S2 완료 조건(전 소스 수집, 소스 1개 고장 시 나머지 성공) 충족. T-001/T-002/T-003 해결.

**결과**
- 완료: 수집기 7종(HN+6) 가동, 랭킹 인터리브
- 남은 작업: S3 MCP 서버
- 미검증 범위: github/devto/huggingface/rss 단위 테스트 미작성(라이브 통합+매핑 단순성으로 커버, 추후 fixture 보강 가능). reddit 라이브(자격증명 없음, fixture 테스트로 로직만 검증)

### W-006 · S1 워킹 스켈레톤 구현
**요청**
- S1 단계(DB+HN 수집기+CLI) 구현 및 단계별 검증

**수행 작업**
- 코어: types(NewsItem/CollectedItem/ItemType), paths(AINS_HOME), logger(stderr 전용), config(zod 전체 스키마, prefault로 sparse override), normalize(canonical URL+sha256 id)
- DB: connection(better-sqlite3 WAL), migrations(전체 스키마 DDL, user_version 관리, FTS5+트리거)
- store: itemStore(upsert/dedup/FTS검색/score_history/purge), fetchLog(source_state, fetch_log)
- http(fetch 래퍼: timeout, 지수백오프 재시도, 조건부 GET), rank(percentile×decay×typeBoost hotness, 소스 인터리브)
- collectors: types(Collector 계약, CollectorError), keywords(AI 관련성), hackernews(Algolia), registry
- refresh(TTL 오케스트레이터: 스킵/백오프/실패 격리, 동시성 4)
- cli: shared, format, commands(trends/fetch/search/show/doctor), index

**변경 파일**
- src/core/{types,paths,logger,config,normalize,http,rank,refresh}.ts, src/core/db/{connection,migrations}.ts, src/core/store/{itemStore,fetchLog}.ts
- src/collectors/{types,keywords,hackernews,registry}.ts
- src/cli/{shared,format,index}.ts, src/cli/commands/{trends,fetch,search,show,doctor}.ts
- tests/: normalize/itemStore/migrations/refresh, collectors/hackernews, helpers/stubHttp, fixtures/hn-search.json

**검증**
- typecheck 통과, 단위/통합 테스트 22개 통과, lint 0
- 라이브 검증(격리 AINS_HOME): `fetch` 63건 수집 → 재실행 시 TTL skip → `trends` hotness 순 출력 → `search`/`show`/`doctor` 정상
- 실패 격리 검증: 500 응답 시 예외 없이 status=error 보고, DB 무변경

**판단 근거**
- 계획서 S1 완료 조건(수집→축적→조회 파이프라인 관통, dedup+TTL skip) 충족. 계층별 typecheck로 충돌 조기 차단.
- 스키마 버전은 user_version으로 관리(계획서 meta.schema_version 대비 부트스트랩 견고성 개선).

**결과**
- 완료: S1 워킹 스켈레톤. T-001(HN points 400) 해결.
- 남은 작업: S2 나머지 수집기 6종 + keywords 광범위 적용 + rank 미세조정

### W-005 · S0 스캐폴드 구현
**요청**
- 구현 목표(S0~S5) 설정 후 단계별 검증하며 진행 (goal)

**수행 작업**
- package.json(ESM, bin: ains/ains-mcp, engines node≥20, scripts) 작성
- 런타임 의존성 설치: @modelcontextprotocol/sdk 1.29, better-sqlite3 12.11(프리빌드로 Windows 네이티브 빌드 문제 없음 확인), commander 15, rss-parser, fast-xml-parser, zod 4
- 개발 의존성 설치: typescript, tsup, vitest, eslint, prettier, typescript-eslint 등
- 설정 파일: tsconfig(strict/NodeNext), tsup(객체 entry로 dist/cli/index.js 고정, better-sqlite3 external, shebang banner, package.json 버전 define 주입), vitest(live 테스트 제외), eslint flat config(core/collectors→cli/mcp import 금지 규칙), .prettierrc
- 빈 CLI(src/cli/index.ts, commander 기반 --version), src/global.d.ts, tests/smoke.test.ts
- src/.gitkeep, tests/.gitkeep 제거(실제 파일 생성됨)

**변경 파일**
- package.json, package-lock.json, tsconfig.json, tsup.config.ts, vitest.config.ts, eslint.config.js, .prettierrc.json
- src/cli/index.ts, src/global.d.ts, tests/smoke.test.ts
- src/.gitkeep, tests/.gitkeep (삭제)

**검증**
- `npm run build`: dist/cli/index.js 생성 성공(bin 경로 일치 확인)
- `node dist/cli/index.js --version`: 0.0.1 출력
- `npm run typecheck`(tsc --noEmit): 통과
- `npm test`(vitest run): 1 passed
- `npm run lint`(eslint): 오류 0

**판단 근거**
- 계획서 S0 완료 조건(빌드 산출물 실행 + 테스트 통과) 충족. 버전은 package.json 단일 진실 원천에서 빌드 시 주입해 문서-코드 정합성 유지.

**결과**
- 완료: S0 스캐폴드, 빌드·타입·테스트·린트 파이프라인 동작
- 남은 작업: S1 워킹 스켈레톤(DB+HN 수집기+CLI)

### W-004 · 초기 커밋 및 원격 푸시
**요청**
- 현재 상태를 git 커밋·푸시

**수행 작업**
- 전체 파일 스테이징(out/은 .gitignore로 제외 확인) 후 root-commit 생성, origin/main 푸시 및 추적 설정

**변경 파일**
- 커밋 c3217e7: 15개 파일(운영 파일 6, docs 6, .gitkeep 3), 653줄

**검증**
- git push 성공 및 `main -> main` 추적 설정 출력 확인. 코드가 없어 테스트 실행은 해당 없음.

**판단 근거**
- CLAUDE.md 10절 Git 원칙(주요 단계 종료 시 commit→push)

**결과**
- 완료: 원격 저장소에 초기 상태 반영
- 남은 작업: S0 스캐폴드 시작(사용자 승인 대기)

### W-003 · plan 문서를 docs/plans로 통합
**요청**
- docs/ 하위의 plan 파일들을 docs/plans/ 하위로 이동

**수행 작업**
- project-plan.md, implementation-plan.md, validation-plan.md를 docs/plans/로 이동
- requirements-contract.md는 계획이 아닌 기준 계약 문서이므로 docs/ 유지(사용자에게 보고)
- 깨진 참조 경로 갱신: CLAUDE.md, requirements-contract.md, project-plan.md, Worklog.md

**변경 파일**
- docs/plans/{project-plan, implementation-plan, validation-plan}.md (이동)
- CLAUDE.md, docs/requirements-contract.md, docs/plans/project-plan.md, Worklog.md (경로 수정)

**검증**
- grep으로 `docs/(implementation|project|validation)-plan` 잔여 참조 전수 확인 후 수정 완료

**판단 근거**
- 계획 문서를 한 폴더에 모아 탐색성 개선(사용자 지시)

**결과**
- 완료: docs/plans에 계획 문서 4개 통합
- 남은 작업: 없음

### W-002 · 프로젝트 운영 체계 셋업
**요청**
- 확정 계획(docs/plans/2026-07-09-ai-news-supplier-plan.md)을 반영한 프로젝트 운영 구조 셋업

**수행 작업**
- CLAUDE.md(작업 헌법), README.md, Worklog/Decisionlog/Troubleshootinglog, .gitignore 생성
- docs/requirements-contract.md 및 docs/plans/{project-plan, implementation-plan, validation-plan}.md 생성(계획 내용으로 채움)
- src/, tests/, tools/, out/, docs/references/ 폴더 생성

**변경 파일**
- CLAUDE.md, README.md, Worklog.md, Decisionlog.md, Troubleshootinglog.md, .gitignore
- docs/requirements-contract.md, docs/plans/project-plan.md, docs/plans/implementation-plan.md, docs/plans/validation-plan.md
- src/, tests/, tools/, out/, docs/references/ (.gitkeep)

**검증**
- 파일 생성 및 구조 확인만 수행. 구현 미착수.

**판단 근거**
- 다세션 진행 프로젝트에서 판단·구조 일관성을 위해 운영 체계를 구현보다 먼저 적용

**결과**
- 완료: 운영 파일 생성
- 남은 작업: 초기 커밋/푸시, S0 스캐폴드부터 구현 시작

### W-001 · 방향 전환 및 구현 계획 확정
**요청**
- 기존 AI Product Lab(PM 특화 학습 서비스) PRD 전면 폐기, ai-news-supplier로 방향 전환 및 계획 수립

**수행 작업**
- 브레인스토밍으로 핵심 결정 확정(로컬 우선, SQLite 축적, 소스 최대 구현, TTL 온디맨드+스케줄러 옵션, 룰 기반 학습 기능, TS/Node 스택)
- 확정 계획서 작성: docs/plans/2026-07-09-ai-news-supplier-plan.md
- 기존 docs/PRD/ 문서 3개 삭제
- git 초기화, origin(https://github.com/gorhkdwj/AI-News-Supplier.git) 연결, main 브랜치 설정

**변경 파일**
- docs/plans/2026-07-09-ai-news-supplier-plan.md (신규)
- docs/PRD/ 전체 삭제

**검증**
- 문서 작업으로 코드 검증 해당 없음. git remote -v로 원격 연결 확인.

**판단 근거**
- 사용자가 원하는 핵심 가치가 "PM 학습 콘텐츠"가 아니라 "AI 소식을 에이전트에 공급"으로 재정의됨

**결과**
- 완료: 계획 확정, 저장소 연결
- 남은 작업: 운영 체계 셋업, 구현 시작
