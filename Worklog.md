# Worklog · ai-news-supplier

주요 사용자 요청이 끝날 때마다 아래 형식으로 누적 기록한다. (규칙: CLAUDE.md 11절). 최신 항목을 위에 추가한다.

## 기록 형식
```
### W-00N · 작업 제목
**요청** / **수행 작업** / **변경 파일** / **검증** / **판단 근거** / **결과**
```

---

### W-019 · Codex 현재 작업의 ains MCP 실호출 확인

**요청**

- `/mcp` 목록에 `ains`가 표시되지 않는 상태에서 현재 Codex 작업이 실제로 ains MCP 도구를 호출할 수 있는지 확인

**수행 작업**

- 프로젝트 `.codex/config.toml`, 사용자 전역 MCP 이름 목록, 프로젝트 신뢰 상태와 `ains-mcp` 실행 파일 탐색 결과 확인
- 설정과 동일한 `command = "ains-mcp"`로 MCP 표준 연결을 열어 도구 9개 노출 확인
- 현재 작업의 지연 로딩 도구 카탈로그에서 `mcp__ains__*` 9개 등록 확인
- 우회 CLI가 아닌 네이티브 `mcp__ains__get_source_status`를 직접 호출해 실제 사용자 DB의 소스 상태 응답 확인

**변경 파일**

- `Worklog.md`
- `Troubleshootinglog.md`

**검증**

- `ains-mcp` stdio 초기화 및 `tools/list`: 9개 도구 반환
- 현재 Codex MCP 직접 호출: 성공, 14개 소스 상태 반환
- 프로젝트 신뢰 상태: `trusted`

**판단 근거**

- `/mcp` UI 표시는 현재 작업에서 사용할 수 있는 지연 로딩 도구 전체와 일치하지 않을 수 있으므로 실제 도구 카탈로그와 직접 호출 결과를 최종 근거로 사용

**결과**

- 완료: 현재 Codex 작업에서 ains MCP가 등록되어 있고 실제 호출 가능함을 확인

### W-018 · Codex 프로젝트 지침과 MCP 설정 저장소 반영

**요청**

- 병합 과정에서 보존만 했던 `AGENTS.md`, `.codex/config.toml`을 프로젝트 설정으로 커밋·푸시

**수행 작업**

- `AGENTS.md`를 `CLAUDE.md`와 대조해 파일명·대상 에이전트 표현 외 작업 헌법이 동일한지 재확인
- `.codex/config.toml`이 프로젝트 범위의 `ains-mcp` stdio 서버만 등록하고 비밀정보·개인 절대경로를 포함하지 않는지 확인
- 병합된 main의 전역 `ains-mcp`가 0.1.0 v2 도구 9개를 노출하는 기존 검증 결과와 설정 명령을 대조

**변경 파일**

- `AGENTS.md`
- `.codex/config.toml`
- `Worklog.md`

**검증**

- TOML 섹션·command 구문 확인
- `AGENTS.md`↔`CLAUDE.md` 의도된 차이 확인
- 비밀정보 패턴, Git ignore 여부, `git diff --check` 확인

**판단 근거**

- 두 파일은 로컬 데이터가 아니라 저장소를 여는 Codex 에이전트 전체가 공유해야 하는 프로젝트 지침·MCP 연결 설정임
- `command = "ains-mcp"`는 npm 패키지의 공개 bin 이름을 사용해 개인 경로에 의존하지 않음

**결과**

- 완료: Codex 프로젝트 지침과 ains MCP 자동 등록 설정을 main 추적 파일로 전환

### W-017 · 랭킹 v2 브랜치의 main 병합과 MCP 0.1.0 전환

**요청**

- `codex/trend-ranking-v2`를 기존 로컬 변경을 보존하는 안전한 순서로 `main`에 병합

**수행 작업**

- 기존 `Worklog.md`, `Troubleshootinglog.md` 변경만 stash하고 `.codex/`, `AGENTS.md`는 작업 트리에 유지
- 원격 `main`·기능 브랜치 동기화를 확인한 뒤 15개 커밋을 `--ff-only`로 병합
- stash 로그 충돌을 양쪽 내용 보존 방식으로 해결하고 기존 W-012/T-004를 W-016/T-007로 재번호화
- 병합된 `main`에서 0.1.0 번들을 다시 빌드하고 전역 `ains`, `ains-mcp`가 새 빌드를 가리키는지 확인
- 임시 `AINS_HOME`으로 MCP를 기동해 실제 사용자 DB를 건드리지 않고 v2 도구 계약을 검증

**변경 파일**

- 기능 브랜치의 v2 구현 파일 84개를 fast-forward 반영
- 병합 기록 정리: `Worklog.md`, `Troubleshootinglog.md`
- 커밋 제외·보존: `.codex/`, `AGENTS.md`

**검증**

- `npm test`: 30개 파일, 199개 테스트 통과
- `npm run typecheck`, `npm run lint`, `npm run build`: 모두 통과
- 전역 `ains --version`: 0.1.0
- MCP stdio 연결: 도구 9개, `get_trends`의 `ranking_version`·`channel`·`sort` 입력 확인
- `npm pack --json`: README·package.json·CLI/MCP 번들·소스맵 6개만 포함

**판단 근거**

- `main`이 기능 브랜치의 merge-base와 같아 merge commit 없이 fast-forward가 가장 단순하고 추적 가능함
- 실제 사용자 DB의 첫 v2 마이그레이션은 앱 재시작 뒤 수행되므로 병합 검증에서는 임시 데이터 홈을 사용

**결과**

- 완료: `main`의 코드·빌드·전역 MCP를 0.1.0 v2로 전환하고 전체 검증 통과
- 보존: 프로젝트 전용 MCP 설정과 `AGENTS.md`는 기존 미추적 상태 유지
- 후속: Codex 앱 재시작 후 프로젝트 `/mcp`에서 `ains` 재연결 확인 필요

### W-016 · Codex 프로젝트 연동 검증

**요청**

- 미커밋 상태인 `AGENTS.md`와 `.codex/config.toml`의 커밋·푸시 전 검증

**수행 작업**

- `AGENTS.md`와 `CLAUDE.md`를 비교해 제목과 주요 사용자 예시 두 줄만 의도대로 다른지 확인
- 신규 파일의 대표 비밀값·개인 절대경로 패턴 및 프로젝트 참조 정합성 검사
- `.codex/config.toml` TOML 파싱, `package.json`의 `ains-mcp` bin 및 빌드 산출물 경로 일치 확인
- 현재 Codex 도구 레지스트리에서 `ains` MCP 도구 9종 확인 후 `get_source_status`를 실제 호출해 구조화 응답 확인
- 빌드·타입 검사·전체 테스트·린트 fresh 실행
- 검증 중 잘못 선택한 pnpm이 npm 의존성을 `.ignored`로 이동한 문제를 복구하고 잔여 복제본 정리(T-007)

**변경 파일**

- Worklog.md, Troubleshootinglog.md
- 검증 대상(기존 미추적): AGENTS.md, .codex/config.toml

**검증**

- `npm run build`: 통과, CLI/MCP 산출물 생성
- `npm run typecheck`: 통과
- `npm test`: 11개 테스트 파일, 43개 테스트 모두 통과
- `npm run lint`: 통과
- TOML 구조 검사 및 AGENTS 동기화 검사: 통과
- Codex MCP 실제 호출: 도구 9종 등록, `get_source_status` 정상 응답
- 복구 후 Git 추적 파일 오염 없음 확인(로그 기록 전 기준 미추적 2개만 존재)

**판단 근거**

- 신규 파일은 제품 계약·실행 코드·npm 배포물에 영향을 주지 않는 Codex 협업/연동 설정이며 민감정보를 포함하지 않음.
- 실제 Codex 세션에서 프로젝트 설정 로드부터 MCP 도구 호출까지 확인했으므로 커밋·푸시를 막는 기능상 문제는 없음.

**결과**

- 완료: 두 신규 파일의 공개 저장소 커밋 적합성과 Codex MCP 연결 검증
- 참고: AGENTS.md와 CLAUDE.md의 향후 동기화 관리 필요. 정리 과정에서 현재 작업의 ains MCP 전송 연결을 종료했으므로 다음 작업 시작 또는 앱 재로딩 후 자동 재기동 여부는 확인 필요.

### W-015 · 유형별 트렌드 랭킹 v2 최종 감사와 릴리스 검증

**요청**

- 확정한 유형별 트렌드 랭킹 v2 계획을 끝까지 구현하고, 자동 검증·패키징·Git 푸시까지 완료

**수행 작업**

- 학습 후보를 v2 Story 단위로 집계하고 채널별 최대 점수, 상위 5개 Story 합, live Community·Repo 24시간 성장률을 연결
- 독립 전체 감사를 수행해 Story 대표 Sighting 선택, GitHub 검색 경계·추적 재관측 순환, Reddit removed 즉시 삭제, Gemini 응답 검증, 기존 Repo 학습 recency 결함을 수정
- GitHub 검색을 AI OR 조건과 생성·push 14일, `stars:>=100` 경계로 보정하고 실제 공식 Search API 200 응답을 수동 확인
- 패키지 버전 0.1.0의 CLI/MCP 번들을 빌드하고 npm tarball 포함 파일과 Git 상태를 검사

**변경 파일**

- `src/core/learning/candidates.ts`, `tests/core/learningV2.test.ts`
- `src/core/ranking/diversity.ts`, `tests/core/trends/service.test.ts`
- `src/collectors/github.ts`, `githubRelease.ts`, `reddit.ts`와 관련 fixture·테스트
- `README.md`, `package.json`, `package-lock.json`, `Worklog.md`, `Troubleshootinglog.md`

**검증**

- `npm test`: 30개 파일, 199개 테스트 통과
- `npm run typecheck`, `npm run lint`, `npm run build`: 모두 통과
- `npm pack --json`: 0.1.0 tarball 생성 성공, README·package.json·CLI/MCP 번들·소스맵 6개만 포함
- CLI/MCP 집중 검증: 2개 파일, 11개 테스트 통과(동일 ID·순서, 9개 도구, stdout 위생 포함)
- `git diff --check`, clean worktree, 로컬 HEAD와 원격 브랜치 일치 확인
- 미검증: 7일 warmup+7일 shadow 실데이터, Repo·Community 수동 precision@20, 0.2.0 전환 승인 수치

**판단 근거**

- 0.1.0은 기준점 수집을 시작하는 shadow 릴리스이므로 legacy 기본을 보존하고 가짜 과거 스냅샷을 만들지 않음
- 독립 감사의 P0/P1을 모두 해소한 뒤 전체 검증을 새로 실행하고, 실제 시간이 필요한 승인 게이트는 통과로 표시하지 않음

**결과**

- 완료: 유형별 랭킹 v2의 스키마·수집·랭킹·CLI/MCP·학습·문서·0.1.0 패키지 검증
- 원격 반영: `codex/trend-ranking-v2` 브랜치에 단계별 커밋 푸시
- 후속: 0.2.0 전환 전에 coverage·availability·legacy-v2 비교를 재현하는 내부 보고 스크립트와 실제 14일 관측 결과가 필요

### W-014 · 유형별 트렌드 랭킹 v2 구현과 0.1.0 shadow 릴리스 준비

**요청**

- Story를 유지하면서 출처 관측을 분리하고 Repository·Community·Official·Research에 독립 랭커를 적용하는 확정 계획을 구현
- 기존 CLI/MCP 호환, Reddit 48시간 보존, 공식 API/RSS 소스 확대, 7일 warmup+7일 shadow 롤아웃을 0.1.0 문서와 메타데이터에 반영

**수행 작업**

- v1 파일 DB 사전 백업과 원자적 v2 마이그레이션, Story/Sighting/Snapshot 저장·조회·기준점·14일 보존을 구현
- 기존 수집기를 안정적 source key·토론 URL·점수 종류·시간 정밀도·활동 시각 계약으로 전환하고 GitHub 신규/활성 검색과 추적 재관측을 분리
- Reddit credential+username 게이트, 식별 User-Agent, subreddit별 hot 격리, rate-limit 감시, 삭제 재검증, 48시간 hard purge를 구현
- Claude Code·Cursor·Figma 공식 피드와 Gemini CLI 안정 GitHub Release 수집을 추가
- Repository·Community·Official·Research 랭커와 quota 기반 Overview를 독립 모듈로 구현하고 CLI/MCP에 ranking/channel/sort를, MCP `get_item`에 Sighting 상세를 노출
- 패키지 버전을 0.1.0으로 맞추고 README를 legacy 기본, v2 명시 사용, 입력 조합, 설정·보존·복구·shadow 승인 게이트 기준으로 갱신

**변경 파일**

- `src/core/db`, `src/core/store`, `src/core/ranking`, `src/core/trends`, `src/core/refresh.ts`, `src/core/types.ts`
- `src/collectors`, `src/cli`, `src/mcp`
- 관련 `tests/`와 fixture
- `package.json`, `package-lock.json`, `README.md`, `Worklog.md`

**검증**

- 스키마·저장소·랭커·수집기·CLI/MCP 구현 단계마다 영향 범위 fixture 테스트와 typecheck·lint·diff 검증을 수행
- 이 기록 시점의 README·패키지 메타데이터는 Prettier와 package-lock 정합성을, W-014는 CommonMark 형식과 실제 CLI help·지원 조합을 대조하고 `git diff --check`를 검증
- 최종 전체 `npm test`, typecheck, lint, build, `npm pack`과 tarball 검사는 후속 통합 단계에서 새로 실행 예정
- 라이브 API 지속 동작, 7일+7일 관측, 실제 Repo·Community precision@20은 미검증이며 승인 게이트 미통과

**판단 근거**

- `docs/requirements-contract.md`와 `docs/plans/2026-07-10-trend-ranking-v2-plan.md`의 확정 계약을 우선 적용
- 유형마다 의미가 다른 점수를 전역으로 섞지 않고, 가짜 과거 스냅샷 없이 실제 기준점이 쌓인 뒤 기본 랭킹 전환 여부를 판단
- 0.1.0에서는 무옵션 legacy 동작을 보존하고 사용자가 `--ranking v2`를 명시할 때만 유형별 랭킹을 사용

**결과**

- 완료: v2 데이터 경로·수집 정책·유형별 공개 랭킹 인터페이스와 0.1.0 shadow 릴리스 문서 준비
- 별도 병행: 학습 후보를 v2 Story 단위 근거로 연결하는 작업과 root의 최종 전체 릴리스 검증
- 전환 보류: 실제 warmup·shadow와 정량/수동 승인 게이트를 통과하기 전까지 legacy 기본 유지

### W-013 · Story Sighting 스키마 v2 마이그레이션과 백업 게이트
**요청**
- 기존 Story·FTS·점수/학습 이력을 보존하면서 `source_sightings`와 `metric_snapshots`를 추가하고, 파일 v1 DB의 사전 백업·검증·원자적 롤백을 구현

**수행 작업**
- 스키마 버전을 2로 올리고 Sighting/Snapshot 테이블, CHECK·UNIQUE·부분 유일 인덱스·연쇄 외래키를 추가
- 기존 item마다 결정적 source key와 24자리 `sightingId`를 사용한 primary `legacy_unverified` Sighting을 백필하고 legacy 시간 정밀도는 모두 `inferred`로 처리
- 파일 v1 DB를 `VACUUM INTO`로 sibling 백업한 뒤 integrity, user_version, item count를 검증하고, 백업 생성/검증 실패 시 DDL 전에 중단
- 임시 백업을 검증한 뒤 최종 `.bak`로 전환하고, 원본↔백업 및 트랜잭션 전후의 item/rowid·실제 FTS MATCH·score/learning/source/fetch 상태를 전수 비교
- 미래 스키마 버전과 중복 legacy source identity 거부, 마이그레이션 실패 원자적 롤백, `openDb` 실패 시 연결 정리를 구현
- v1 보존, FTS 트리거, source key 우선순위, discussion/activity/score kind, 빈 snapshot, FK와 제약을 테스트

**변경 파일**
- `src/core/db/migrations.ts`
- `src/core/db/connection.ts`
- `src/core/normalize.ts`
- `tests/core/migrations.test.ts`
- `tests/fixtures/schema-v1.sql`
- `Worklog.md`, `Troubleshootinglog.md`
- `out/sdd/task-2a-report.md`(Git 제외 보고서)

**검증**
- `npm test -- tests/core/migrations.test.ts`: 13개 통과
- `npm test`: 54개 통과
- `npm run typecheck`: 통과
- `npm run lint`: 통과
- 대상 파일 Prettier 검사 및 `git diff --check`: 통과

**판단 근거**
- `docs/requirements-contract.md` 2~3절과 `docs/plans/2026-07-10-trend-ranking-v2-plan.md` V2-1 계약을 우선 적용
- 기존 저장 로직이 누락 게시 시각을 수집 시각으로 치환하므로 legacy 행의 실제 정밀도를 증명할 수 없어 모두 `inferred`로 백필

**결과**
- 완료: 스키마 v2, legacy 백필, 파일 백업/검증 게이트, 롤백·미래 버전 방어
- 남은 작업: Task 2B에서 live Sighting upsert와 수집 계약 연결

### W-012 · AI NEWS HUB 벤치마크와 유형별 랭킹 v2 계약 확정
**요청**
- AI NEWS HUB의 핫레포·커뮤니티·공식 업데이트를 비교하고, 단순 최신성·전역 hotness 문제를 해결하는 수정 계획을 구현 가능한 계약으로 확정

**수행 작업**
- AI NEWS HUB 공개 화면/API를 GitHub Trending·HN·Reddit·공식 RSS/원문과 교차 확인
- 현재 ains의 수집 후보, 점수식, canonical 중복, CLI/MCP 노출을 코드·계약·테스트 기준으로 감사
- Story/Sighting/Snapshot 데이터 모델, Repo·Community·Official·Research 랭킹 공식, Overview·호환 인터페이스, warmup/shadow 게이트 확정
- 공식 RSS/Atom/API가 확인된 Claude Code, Cursor, Figma, Gemini CLI와 Reddit 최신 정책을 외부 자료로 기록

**변경 파일**
- `docs/plans/2026-07-10-trend-ranking-v2-plan.md`
- `docs/requirements-contract.md`
- `Decisionlog.md`
- `Worklog.md`

**검증**
- 문서 간 스키마·공식·CLI/MCP 옵션·보존 기간·롤아웃 수치 정합성을 `rg`와 `git diff --check`로 확인
- 문서 선행 단계이므로 런타임 테스트는 실행하지 않음

**판단 근거**
- 코드보다 기준 계약을 먼저 갱신해야 한다는 프로젝트 원칙과, 타입마다 서로 다른 화제성 신호를 사용해야 한다는 벤치마크 결론

**결과**
- 완료: 구현이 의사결정 없이 진행 가능한 v2 계약과 단계 계획 확정
- 남은 작업: 스키마 v2부터 fixture 기반 TDD로 구현하고 7일 warmup·7일 shadow 수행

### W-011 · 로컬 전역 설치 사용성 확인 및 문서 보강
**요청**
- API 키 발급 없이 어떻게 동작하는지, 로컬 터미널에 설치해 바로 쓸 수 있는지 확인

**수행 작업**
- 인증 실태 설명: 7소스 중 6종(HN·GitHub·RSS·HF·arXiv·DEV.to)은 공개 API/RSS로 키 불필요, Reddit만 키 게이트로 비활성
- `npm link`로 전역 설치 후 프로젝트 밖에서 ains 동작 검증(9소스 실수집)
- README에 전역 설치(npm link) 안내 및 PowerShell 쉼표 리스트 따옴표 팁 추가

**변경 파일**
- README.md

**검증**
- 프로젝트 밖 폴더에서 `ains fetch` → 9소스 정상(HN 66/GitHub 60/HF 55/arXiv 75/DEV.to 23/RSS 4종)
- PowerShell 쉼표 이슈 재현: `--source hackernews,arxiv`(배열 해석 실패) vs `--source "hackernews,arxiv"`(정상). 도구 버그 아님(셸 특성)

**판단 근거**
- 실사용 진입 장벽(설치·인증)을 실제로 확인해 문서화

**결과**
- 완료: 전역 설치로 즉시 사용 가능 확인, 문서 보강
- 참고: npm link는 로컬 개발 심링크(커밋 대상 아님). npm 레지스트리 배포는 여전히 미수행

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
