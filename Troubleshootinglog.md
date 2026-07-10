# Troubleshootinglog · ai-news-supplier

실제 오류·실패·환경 문제·검증 실패·설계 충돌이 발생하면 기록한다. 같은 문제가 반복되면 새 T-ID를 만들기 전에 기존 T-ID를 먼저 확인한다. (규칙: CLAUDE.md 11절)

## 기록 형식
```
### T-00N · 문제 제목
**발생 상황** / **증상** / **확인된 원인** / **조치** / **재발 방지**
```

---

### T-009 · 단일 HTML 검증 보조 명령의 인라인 코드 오탐과 PowerShell 인용 실패

**발생 상황**

- `docs/index.html`의 내부 앵커·JavaScript·비밀정보를 저장소 변경 없이 inline 검증 명령으로 확인

**증상**

- 첫 앵커 검사 정규식이 HTML 안의 JavaScript template literal인 `href="#${entry.id}"`까지 정적 문서 링크로 인식해 존재하지 않는 앵커라고 보고함
- 복합 비밀정보 정규식의 따옴표가 PowerShell 문자열 경계와 충돌해 parser 오류가 발생함

**확인된 원인**

- 문서 마크업과 `<script>` 본문을 분리하지 않고 같은 href 정규식으로 검사함
- JavaScript·정규식·PowerShell의 따옴표 계층을 한 명령 문자열에 혼합함
- HTML 자체의 앵커, 링크, JavaScript나 문서 내용에는 문제가 없었음

**조치**

- 앵커·상대 링크 검사 전 `<script>` 본문을 제외하고, JavaScript는 별도로 `new Function` 구문 검사를 수행하도록 분리
- 비밀정보 패턴을 인용 충돌이 없는 토큰 접두사 검사로 단순화하고 no-match 종료 코드 1을 명시적으로 정상 처리
- 수정한 검사에서 중복 ID·깨진 앵커·깨진 상대 링크·외부 자산·비밀정보 패턴이 모두 0임을 확인

**재발 방지**

- 자체 포함 HTML은 마크업, 스타일, 스크립트를 분리해 각각 검증하고 inline 다중 언어 명령은 최소한의 인용 계층만 사용함

### T-008 · `/mcp` 표시와 현재 작업의 지연 로딩 MCP 도구 불일치

**발생 상황**

- 프로젝트 `.codex/config.toml`에 ains 서버가 등록되어 있으나 사용자의 `/mcp` 목록에는 표시되지 않음

**증상**

- 표면적인 `/mcp` 목록만 보면 ains가 현재 Codex 작업에 연결되지 않은 것으로 보임
- 처음 노출된 기본 도구 설명에도 ains 도구가 나타나지 않음

**확인된 원인**

- ains 도구는 현재 작업의 지연 로딩 도구 카탈로그에 `mcp__ains__*` 9개로 등록되어 있었음
- `/mcp` 화면 표시가 지연 로딩된 실제 호출 가능 도구 상태를 완전히 반영하지 않는 것으로 관측됨
- `ains-mcp` 서버, PATH, 프로젝트 신뢰 설정에는 문제가 없었음
- Codex 앱은 프로젝트 설정 파일 생성 이후 실제로 재시작되었으므로 단순 재시작 누락도 원인이 아님
- 사용자 전역 설정에는 ains가 없고 프로젝트 설정 계층에만 존재해, 현재 앱 버전에서 프로젝트 범위 MCP의 `/mcp` 표시가 누락되는 것으로 추정됨

**조치**

- 설정과 동일한 `ains-mcp` 명령으로 stdio 연결 및 `tools/list`를 검증
- 현재 Codex 작업에서 `mcp__ains__get_source_status`를 직접 호출해 정상 응답을 확인

**재발 방지**

- MCP 등록 여부는 `/mcp` 표시만으로 판정하지 않고 지연 로딩 도구 카탈로그 조회와 읽기 전용 도구 직접 호출을 함께 확인
- 신규 설정 직후에는 공식 안내대로 Codex를 재시작하되, 재시작 후에도 표시가 다르면 실제 호출 결과를 우선 근거로 사용
- 표시가 반드시 필요하면 사용자 동의 후 `~/.codex/config.toml`에도 동일한 `[mcp_servers.ains]` STDIO 설정을 등록하고 앱을 재시작해 전역 계층 표시 여부를 확인
- 전역 등록 후에도 누락되면 Codex 앱 버전과 직접 호출 성공 증거를 포함해 제품 UI 문제로 보고

### T-007 · pnpm 실행으로 npm 의존성이 `.ignored`로 이동

**발생 상황**

- Codex 연동 커밋 전 회귀 검증에서 셸 PATH에 npm이 없어 번들 pnpm으로 package scripts 실행을 시도함.

**증상**

- pnpm이 npm으로 설치된 직접 의존성을 `node_modules/.ignored/`로 이동해 기존 `.bin` 경로가 깨짐.
- `npm ci` 복구 시 실행 중인 `ains` MCP가 `better_sqlite3.node`를 사용하고 있어 Windows `EPERM unlink`로 중단됨.

**확인된 원인**

- `package-lock.json` 기반 npm 프로젝트의 기존 `node_modules`에 다른 패키지 관리자인 pnpm을 사용함.
- 전역 `npm link`된 `ains-mcp` 프로세스들이 이 저장소의 better-sqlite3 네이티브 모듈을 로드해 삭제 잠금을 보유함.

**조치**

- pnpm 검증 명령을 즉시 중단하고 NVM의 Node v24.14.1/npm 11.11.0 경로를 확인함.
- `npm install --no-audit --no-fund`로 누락된 298개 패키지를 복구한 뒤 build/typecheck/test/lint를 모두 통과함.
- 실행 명령이 `ains-mcp`인 Node 프로세스 5개만 식별·종료하고, 작업공간 내부 경로를 검증한 후 `node_modules/.ignored`를 삭제함.
- 복구·정리 후 Git 추적 파일에 의도하지 않은 변경이 없음을 확인함.

**재발 방지**

- `package-lock.json`이 있는 이 프로젝트의 검증·설치는 npm만 사용함.
- 샌드박스 PATH에 npm이 없으면 pnpm으로 대체하지 말고 프로젝트가 사용한 NVM Node/npm 절대경로를 먼저 확인함.
- better-sqlite3 삭제가 필요한 재설치 전에는 전역 링크로 실행 중인 `ains-mcp` 프로세스의 파일 잠금을 확인함.

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
