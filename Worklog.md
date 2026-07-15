# Worklog · ai-news-supplier

주요 사용자 요청이 끝날 때마다 아래 형식으로 누적 기록한다. (규칙: CLAUDE.md 11절). 최신 항목을 위에 추가한다.

## 기록 형식

```
### W-00N · 작업 제목
**요청** / **수행 작업** / **변경 파일** / **검증** / **판단 근거** / **결과**
```

---

### W-043 · 백로그 문서 신설 — 피드백 ①~⑥ 태스크 등록 + 잔여 태스크 전수 정리

**요청**

- 피드백 ①~⑥을 태스크로 올리고, 남은 태스크를 모두 정리

**수행 작업**

- `docs/plans/backlog.md` 신설: 앞으로 할 일 전용 문서(B-ID 체계). Worklog·Decisionlog·계획서·대화에 흩어져 있던 잔여 과제 16건(B-001~B-016)을 5개 그룹으로 등록 — ① 즉시(0.2.x) 2건 ② 0.3.0 범위 8건 ③ 일정 기반 검증 3건 ④ 사용자 결정 대기 2건 ⑤ 0.4.0 이후 1건
- 피드백 매핑: ⑤→B-001, ⑥→B-002, ①→B-003, ④→B-004, ③→B-005(+선행 결정 B-015), ②→B-011

**변경 파일**

- docs/plans/backlog.md(신설), Worklog.md(본 기록)

**검증**

- Decisionlog(D-008~D-011)·Worklog(W-034·W-035·W-040~W-042)와 대조해 누락·중복 없음 확인. 코드 변경 없음

**판단 근거**

- 기존 계획 문서는 단계(S0~S5)·릴리스 결정 중심이라 세부 태스크 추적 위치가 없었음. 완료 기록(Worklog)과 할 일(backlog)을 분리해 게이트(~7/26) 전후 작업을 한눈에 관리

**결과**

- 완료: 태스크 16건 등록. 다음 착수 후보는 B-001·B-002(사용자 확정 시)

### W-042 · 개선안 6건(W-040·W-041 피드백 ①~⑥) 우선순위 검토

**요청**

- 학습 세션 정상화(T-012) 이후, 누적 피드백 ①~⑥의 구현 가능성·규모·우선순위 검토

**수행 작업**

- 각 항목의 코드 접점 확인: ①은 TrendSection(src/core/trends/service.ts)에 0건 사유 필드 없음, ⑤는 NewsItem.discussionUrl이 이미 존재하나 session.ts linkList가 미출력, ⑥은 지시문 3단계가 무조건 렌더링, ④는 searchItems가 types 필터를 이미 지원, ③은 extractTerms(learning/topics.ts) 재사용 가능
- 우선순위 제안: 즉시(⑤·⑥ — session.ts 렌더링만 수정, 저위험) / 0.3.0(①·④ — 계약 갱신 동반) / 설계 확정 후 0.3.0 후보(③) / 코드 아닌 게이트 관찰 항목(② — 7/26 precision@20)

**변경 파일**

- Worklog.md (본 기록 — 검토만, 코드 변경 없음)

**검증**

- 코드 리딩으로 접점 확인. 구현·테스트는 미착수(사용자 우선순위 확정 대기)

**판단 근거**

- ⑤·⑥은 지시문 텍스트 조립만 바꾸므로 계약 11.1 소폭 보강으로 충분. ①은 T-012와 동일 원칙("0건은 이유를 말해야 함")이나 core→CLI→MCP 3층 additive 변경이라 0.3.0 규모. ④는 quota 수치를 실데이터로 정해야 하므로 검증 동반 필요. ③은 토픽 추출 주체(도구 룰 기반 vs 에이전트) 설계 결정 선행

**결과**

- 완료(검토): 사용자 확정 대기. 확정 시 ⑤·⑥부터 착수 제안

### W-041 · 학습 세션 패키지의 에이전트 소비 단계 시행 (W-040 후속)

**요청**

- W-040에서 생성한 세션 JSON을 에이전트가 실제로 소비해 학습 세션을 구성하는 마지막 단계까지 테스트 시행

**수행 작업**

- "llm juries" 세션 지시문(6단계)대로 진행: 근거 2건(DoorDash 글, LLM-as-Judge 신뢰성 논문)의 실물 내용 확보 → 브리핑/개념 4개/실습/점검 질문/읽을거리 구성해 대화로 세션 전달
- DoorDash 원문이 봇 차단(403) → HN 토론(algolia items API)으로 우회해 내용 확보
- 테스트 시행이므로 record_learning은 미호출(사용자 확인 대기)

**변경 파일**

- Worklog.md (본 기록 — 코드 변경 없음)

**검증**

- 근거 자료만으로 중급 45분 세션 구성 가능함을 확인. 출처 규율 유지됨

**판단 근거·피드백(0.3.0 검토 후보, W-040 피드백에 추가)**

- ⑤ 세션 자료에 원문 URL만 포함되고 discussionUrl이 없음 — 원문 차단 시 에이전트의 우회 경로 제공을 위해 포함 검토
- ⑥ 지시문 3단계("핫레포/모델 중 하나로 실습")가 repos 버킷이 빈 경우를 가정하지 못함 — 버킷 상태 조건부 렌더링 검토

**결과**

- 완료: 생성→소비 전 구간 검증 종료. 피드백 누적 6건은 0.3.0 계획 시 일괄 검토

### W-040 · E2E 시나리오 검증 — 트렌드 탐색 → 항목 선택 → 학습 세션 구성

**요청**

- 데이터 분석가 페르소나로 트렌드에서 쓸만한 레포/커뮤니티 글을 골라 학습 세션 구성까지 실사용 흐름을 시행하고 과정 기록·검증·피드백

**수행 작업**

- `trends --ranking v2` repos(trending·discovery)·community(hot) 조회 → community 후보 중 "Building Food Metadata with LLM Juries"(DoorDash, HN 40점, id 55abe260e5053ec4) 선택. 근거: LLM 배심원단 기반 대규모 메타데이터 생성은 데이터 분석가의 데이터 보강·라벨링·품질 평가 업무에 직접 응용 가능
- `show`로 상세 확인 → 영어 키워드 토픽 2종 비교: "llm juries"(exact 2건 — 선택 글+LLM-as-Judge 신뢰성 논문) vs "llm evaluation"(exact 40건 — limit 도달, 논문 38 편중) → 정밀 토픽으로 세션 확정
- 학습 미수행이므로 record_learning은 호출하지 않음(이력 오염 방지)

**변경 파일**

- Worklog.md (본 기록 — 도구 실행 검증이라 코드 변경 없음)

**검증**

- W-039 수정판(로컬 dist)으로 전 과정 실행: search 메타 정상(exact/matched), 선택 항목이 근거 버킷에 포함됨을 확인

**판단 근거·피드백(0.3.0 검토 후보)**

- ① v2 repos·trending이 워밍업 중 "표시할 항목이 없습니다"만 출력 — 0건 사유(워밍업/델타 미확보) 미설명. T-012와 같은 교훈: 0건은 이유를 말해야 함
- ② repos discovery 상위권에 데이터 분석 관련·신뢰성 있는 레포가 부족(정체불명 고스타 레포 다수) — 게이트의 precision@20 평가에서 주시 필요
- ③ 트렌드에서 고른 항목 id를 세션 토픽으로 잇는 수단이 없어 키워드 추출이 수동 — `learn session --from-item <id>` 같은 연결 옵션 검토 가치
- ④ 광범위 토픽은 limit 40 도달 시 논문 편중(38/40) — 버킷별 quota 검토 여지

**결과**

- 완료: 실사용 흐름 검증 성공. 피드백 4건은 0.3.0 계획 시 검토

### W-039 · T-012 수정 — 학습 세션 자료 검색 단계적 완화 + 0건 사유 노출

**요청**

- "학습세션 구성도 수정했나?" → 미수정 상태 확인 후 즉시 수정 진행

**수행 작업**

- 계약 문서 11.1 신설(완화 검색·0건 안내·search 메타 규칙)을 코드보다 먼저 갱신
- itemStore.searchItems에 `operator: 'and'|'or'` 옵션 추가(FTS OR 완화, bm25 관련도 순 유지)
- designLearningSession: AND 0건 → OR 완화 → 그래도 0건이면 instructions에 사유+영어 키워드 재시도 안내. 반환값에 `search { mode, matched }` 추가
- MCP design_learning_session: 도구 설명에 영어 키워드 권장·자동 완화 동작 명시, 응답에 search 메타 추가
- docs/index.html 도구 설명 갱신, CHANGELOG [Unreleased] 추가
- tests/core/learning.test.ts: 고정 날짜 fixture를 상대 시각으로 교체(T-013 잠복 시한폭탄 제거) + relaxed/none 케이스 테스트 2건 추가

**변경 파일**

- docs/requirements-contract.md, src/core/store/itemStore.ts, src/core/learning/session.ts, src/mcp/tools.ts, docs/index.html, CHANGELOG.md, tests/core/learning.test.ts, Troubleshootinglog.md(T-012 최종 해결), Worklog.md(본 기록)

**검증**

- typecheck·lint·테스트 33파일/236건(+2) 전부 통과(각 EXIT=0)
- E2E: "에이전트 평가" → relaxed 1건(이전엔 빈 뼈대) / 무의미 토픽 → none+재시도 안내 / "ai agent evaluation benchmark" → exact 14건

**판단 근거**

- search_news의 AND 의미는 사용자 기대이므로 완화를 기본화하지 않고 호출자(학습 세션)가 operator로 선택하게 설계. MCP 응답 필드는 추가만 하여 하위 호환 유지

**결과**

- 완료: T-012 종결. 0.3.0 publish 시 CHANGELOG [Unreleased]로 반영 예정

### W-038 · CI 실패 진단·수정 — trends CLI 테스트 시간 의존 fixture (T-013)

**요청**

- 문서 커밋 후 CI test 잡 3개 OS 전부 실패 메일 수신 → 원인 확인 요청 후 수정 승인

**수행 작업**

- CI 로그 확인: `tests/cli/trends.test.ts` 2건 실패(기대 3건, 수신 0건). 로컬 재현 성공
- 원인 확정: fixture 시각이 `'2026-07-10T12:00Z'` 고정인데 CLI 자식 프로세스는 실제 현재 시각으로 72시간 윈도 계산 → 07-13 12:00 UTC 이후 무조건 실패하는 시한폭탄 테스트
- fixture를 실행 시점 1시간 전 상대 시각으로 변경, 동일 유형 전수 점검(spawn 테스트 2개 중 나머지 1개는 이미 안전)

**변경 파일**

- tests/cli/trends.test.ts, Troubleshootinglog.md(T-013), Worklog.md(본 기록)

**검증**

- 전체 테스트 33파일/234건 로컬 통과(EXIT=0). 푸시 후 CI 초록불 확인 예정

**판단 근거**

- pack smoke 3개는 통과 → 배포물 결함이 아닌 테스트 결함. 프로세스 경계에서는 시계 주입이 불가하므로 상대 시각 fixture가 유일한 안정적 해법

**결과**

- 완료: 수정 커밋·푸시. 재발 방지 규칙 T-013에 기록

### W-037 · T-012 학습 세션 빈 근거 자료 CLI 재현 검증

**요청**

- 학습 세션 구성 기능 오동작(빈 근거 자료) 현상을 직접 CLI로 호출해 재현·확인 요청

**수행 작업**

- `ains learn session "에이전트 평가" --level beginner --time 30` 실행 → 지시문 뼈대는 정상 생성되나 근거 자료 4버킷(공식/논문/핫레포/커뮤니티) 전부 `(없음)` — 빈 자료 현상 재현
- `ains learn session "agent" --level beginner --time 30` 실행 → 동일 DB에서 공식 3건·논문 3건·핫레포 32건·커뮤니티 2건이 채워짐 — 대조 검증

**변경 파일**

- Worklog.md (본 기록)

**검증**

- 로컬 CLI 실행 2회로 T-012 원인 가설(FTS AND 검색 + 영어 코퍼스에 한국어/다단어 토픽 → 0건) 재확인. 코드 변경 없음

**판단 근거**

- 동일 명령·동일 DB에서 topic 문자열만 바꿔 결과가 극단적으로 갈리므로, 결함 위치가 topic→FTS 직결 검색(session.ts:65)임이 재확인됨

**결과**

- 완료: T-012 재현 확정. 수정(단계적 완화 검색, 0건 사유 노출, 도구 설명 갱신)은 0.3.0 범위로 유지

### W-036 · GitHub 토큰 교체 후 rate limit 해소 검증

**요청**

- GitHub 수집 중 rate limit 발생 → 사용자가 새 토큰을 발급해 config에 등록 → rate limit이 완화되었는지 확인 요청

**수행 작업**

- `~/.ai-news-supplier/config.json`의 `tokens.github` 존재 확인(토큰 값은 출력하지 않음)
- 해당 토큰으로 GitHub `/rate_limit` API 직접 조회 → HTTP 200, core 4,998/5,000 · search 30/30 확인(인증 한도 정상 적용)
- `ains fetch --source github` 실행 시 TTL로 skipped → `--force`로 강제 수집해 E2E 검증

**변경 파일**

- Worklog.md (본 기록)

**검증**

- 라이브 네트워크 수동 검증: GitHub 수집 `ok / found 244, new 98` — 토큰 인증 및 수집 정상

**판단 근거**

- 비인증 한도는 시간당 60회, 인증 시 5,000회. remaining 4,998은 새 토큰이 실제로 적용되고 있다는 직접 증거
- API 조회만으로는 ains 내부 경로 검증이 안 되므로 실제 수집기 실행으로 마무리

**결과**

- 완료. rate limit 문제 해소 확인, 남은 작업 없음

---

### W-024 · 데스크톱 60분 주기 자동 fetch 스케줄 등록

**요청**

- ains fetch가 데스크톱에서 60분마다 자동 실행되도록 설정

**수행 작업**

- 기존 `ains schedule` 기능(W-010에서 구현)을 사용해 Windows 작업 스케줄러에 `ai-news-supplier-fetch` 작업 등록 (`ains schedule install --every 60`)
- 등록된 실행 명령이 npm link 전역 설치본(`C:\nvm4w\nodejs\node_modules\ai-news-supplier` → 이 저장소 Junction)의 `dist/cli/index.js`를 가리킴을 확인

**변경 파일**

- 없음 (OS 작업 스케줄러 등록만 수행. Worklog.md 기록 추가)

**검증**

- `schtasks /Query /V`로 등록 명령·반복 주기(1시간) 확인
- 등록된 명령을 그대로 1회 수동 실행: 종료 코드 0, 보존 정책 정리 1건 수행. arxiv 소스 1건이 시간 초과(30000ms)로 실패했으나 전체 수집은 정상 진행(소스 격리 불변 규칙대로 동작)

**판단 근거**

- 전역 `ains`가 npm link로 이 저장소 dist를 가리키므로, 저장소를 옮기거나 dist를 삭제하면 스케줄이 조용히 실패함. 해제는 `ains schedule uninstall`

**결과**

- 완료: 60분 주기 자동 수집 활성화
- 남은 작업: 없음 (arxiv 시간 초과는 일시적 네트워크 지연으로 추정, 반복 시 T-ID 기록 필요)

---

### W-027 · LICENSE 파일 추가와 3-OS CI 구축

**요청**

- 서비스 한계 분석에서 도출한 즉시 항목 2개(LICENSE, CI) 진행

**수행 작업**

- MIT 라이선스 전문 LICENSE 파일 추가(package.json의 license/author 선언과 일치, npm은 LICENSE를 자동 포함하므로 files 수정 불필요)
- GitHub Actions CI 신설(.github/workflows/ci.yml): ubuntu/macos/windows × Node 20/22/24 매트릭스에서 npm ci→build→typecheck→lint→test, 별도 pack-smoke job 3-OS에서 tarball 전역 설치 후 `ains --version`/`ains doctor` 실행
- 1차 푸시가 workflow scope 없는 fine-grained PAT으로 거부됨 → 사용자가 토큰에 Workflows 권한(Read and write) 추가 후 푸시 성공

**변경 파일**

- LICENSE (신규), .github/workflows/ci.yml (신규), Worklog.md

**검증**

- CI 실행 결과로 검증(run 29183343737). npm pack이 prepublishOnly를 실행하지 않는 점을 반영해 smoke job에 빌드 단계 명시.

**판단 근거**

- LICENSE 부재는 법적 공백, CI 부재는 macOS/Linux 미검증(W-026 한계)의 유일한 자동 해소 수단. 테스트가 fixture 기반이라 CI 신호가 네트워크에 오염되지 않음.

**결과**

- 완료: 커밋 5ff24f6 푸시. CI 첫 실행(run 29183343737) 12개 중 11개 통과 — macOS/Linux 전 조합 green으로 **타 OS 미검증(W-026) 해소**. 유일한 실패 `test (windows-latest, node 20)`은 Node 20 지원 문제로 판명 → D-006/W-028로 이어짐.

---

### W-035 · CHANGELOG 도입과 GitHub Release 노트 소급 작성 (D-011)

**요청**

- 업데이트 내역을 파일로 보관하고 GitHub Release에도 패치 내역을 남기자는 제안 → 채택

**수행 작업**

- CHANGELOG.md 신설(Keep a Changelog 형식, 영어): 0.1.0(최초 공개)·0.2.0(Breaking/Added/Changed/Infrastructure) 소급 작성, compare 링크 포함
- v0.1.0 태그를 publish 시점 커밋(cf23e5f, version 0.1.0 확인)에 소급 생성·푸시
- GitHub Release 2건 생성: v0.1.0(최초 릴리스 요약), v0.2.0(Breaking 강조 + Windows 업그레이드 주의 + CHANGELOG 링크)
- 양어 README 개발 절에 CHANGELOG·Releases 링크 추가, D-011 결정 기록(릴리스 절차에 CHANGELOG 작성 + 태그 + Release 생성 단계 추가)

**변경 파일**

- CHANGELOG.md(신규), README.md, README.ko.md, Decisionlog.md(D-011), Worklog.md (+ GitHub 태그 v0.1.0, Release 2건 — 저장소 외부 산출물)

**검증**

- 태그 대상 커밋의 package.json version=0.1.0 확인 후 태깅. Release 2건 URL 생성 확인. mirror-data는 prerelease라 버전 릴리스 목록과 분리 유지됨

**판단 근거**

- 업데이트 경험 3요소 중 "무엇이 바뀌었나"(신뢰) 공백 해소. 소급 작성은 Worklog·커밋 기록이 정확히 남아 있어 가능했음

**결과**

- 완료. 이후 릴리스 절차: CHANGELOG 항목 → publish → git tag → gh release create (D-011)

---

### W-034 · Claude 데스크톱 앱(Cowork) MCP 연결 해결과 문서화

**요청**

- 데스크톱 앱/Cowork에서 ains 조회 불가 문제 해결, 해결 방법을 0.3.0 전 README에 기재

**수행 작업**

- 원인 진단: ① MCP 등록 장부는 클라이언트(Claude Code/데스크톱 앱/Codex)마다 별개 — 데스크톱 앱에는 등록된 적 없음. ② 설정 수정 후에도 앱이 트레이에 살아 있어 재시작 안 됨(로그의 MCP 초기화 시각으로 확정)
- 사용자 `claude_desktop_config.json`에 ains 항목 추가(절대 경로 방식, JSON 유효성 검증) → 트레이 완전 종료·재시작 후 일반 채팅·Cowork 모두 9개 도구 인식 확인
- Claude Code 연결은 현 세션에서 `mcp__ains__get_source_status` 네이티브 호출로 실증(14소스 응답). 부수 확인: 응답의 last_success_at(10:33Z)로 숨김 스케줄러의 실제 fetch 성공 검증 — W-029 미검증 항목 해소
- README.md/README.ko.md MCP 절에 "Claude Desktop app (Cowork 포함)" 하위 절 신설: 별도 장부 설명, config 예시(npx), 트레이 완전 종료 주의, GUI PATH 차이 시 절대 경로 대안, 웹 불가 명시. docs/index.html Claude Code 탭에 동일 요지 추가

**변경 파일**

- README.md, README.ko.md, docs/index.html, Worklog.md (+ 사용자 로컬 claude_desktop_config.json — 저장소 외부)

**검증**

- 3개 환경 실증: 데스크톱 일반 채팅(스크린샷), Cowork(스크린샷), Claude Code(네이티브 호출)
- 미검증: npx 방식의 데스크톱 앱 동작(사용자 환경은 절대 경로로 등록됨 — README의 npx 예시는 일반 사용자용 표준 경로이나 GUI PATH 제약 주의를 병기함)

**판단 근거**

- "npm 배포 ≠ 클라이언트 연결"이라는 간극은 모든 신규 사용자가 겪을 문제로 문서화 가치가 높음. 발견성 개선 3종(MCP 레지스트리 등록, ains setup 명령, MCPB 번들)은 0.3.0 이후 후보로 식별

**결과**

- 완료: 3개 환경 연결 + 문서 반영. npm README는 다음 publish(0.3.0) 때 갱신되고 GitHub에는 즉시 반영

---

### W-033 · D-010: 0.2.0 즉시 publish 결정과 문서 재정렬

**요청**

- 지인 공유를 위해 0.2.0을 지금 publish, v2는 추후 검증으로. 미러 첫 관측 279개의 정상 여부 질의

**수행 작업**

- 279개 분석: 첫 1시간 버킷 기준 정상(GitHub 검색 상한 200 + HN 72h/10점/AI 필터 + DEV 10반응). 기준은 트렌드 목적에 적절하며 minPoints/extraKeywords로 사용자 조정 가능함을 확인
- D-010 기록: 실사용자 발생으로 D-008 전제 해제 → 0.2.0(개선 묶음, legacy 기본) 즉시 publish, v2 기본 전환 0.3.0, legacy 제거 0.4.0
- 계약 13절·v2 계획서 부기 버전 재정렬

**변경 파일**

- Decisionlog.md(D-010), docs/requirements-contract.md, docs/plans/2026-07-10-trend-ranking-v2-plan.md, Worklog.md

**검증**

- README/README.ko "현재 상태"(0.2.0·legacy 기본)가 배포 내용과 이미 일치함을 확인. publish는 prepublishOnly(빌드+테스트 234)가 최종 관문

**판단 근거**

- 버전 번호는 약속의 단위 — 약속 변경은 조용히가 아니라 D-010으로 공식 갱신. 하루 2회 publish는 첫날 특수 상황의 명시적 예외로 기록

**결과**

- 완료: 문서 정합 후 사용자가 publish(2026-07-12T10:35Z). 레지스트리 검증: `npm view` 0.2.0/latest·engines >=22.12.0 확인, 클린 실설치(취약점 0) 후 `--version` 0.2.0, 명령 12개(mirror 포함), doctor가 신규 manifest 기반 스케줄 표시("등록됨 (60분마다)") 정상 동작, MCP 핸드셰이크 정상. 0.2.0 공개 완료

---

### W-032 · 스냅샷 미러 게시 파이프라인 구현 (D-009 채택, M1·M2)

**요청**

- "미러를 먼저 구현해둬도 괜찮지 않나" — 미러 데이터는 소급 생성이 불가능하므로 게시를 즉시 시작하고, 클라이언트 시딩(M3)은 v2 전환과 함께 구현하기로 확정

**수행 작업**

- D-009 기록(미러 채택, 게시 선구현) 및 기준 계약 14절 신설(범위 hackernews/devto/github, Reddit·공식 RSS 제외와 사유, 산출물 형식, 상태 DB, 멱등 병합 규칙)
- M1: `src/core/mirror/export.ts`(listMirrorBuckets, exportMirrorBucket — raw 원문 제외) + `ains mirror export --hours --out` CLI(gzip + sha256 요약 JSON 출력) + 테스트 8개
- M2: `.github/workflows/mirror.yml` — 매시 7분 cron으로 미러 소스만 fetch → 시간 버킷 증분 내보내기 → rolling release(`mirror-data`, prerelease)에 자산 게시, `mirror-state.db`로 실행 간 상태 유지, `tools/mirror-manifest.mjs`로 manifest 병합·14일 초과 자산 정리
- docs/index.html 운영 명령 절에 mirror 명령 안내(유지관리용, Reddit 제외 사유) 추가

**변경 파일**

- Decisionlog.md(D-009), docs/requirements-contract.md(14절 신설, 기존 외부 자료 기록은 15절), src/core/mirror/export.ts(신규), src/cli/commands/mirror.ts(신규), src/cli/index.ts, tests/core/mirrorExport.test.ts(신규 8), tools/mirror-manifest.mjs(신규), .github/workflows/mirror.yml(신규), docs/index.html, Worklog.md

**검증**

- 테스트 33파일·234개 통과, typecheck·lint·prettier 클린
- 실기 export: 실제 DB에서 4개 버킷(27~90KB/버킷) 산출, 포함 소스 github/hackernews만·raw 부재 확인(계약 14.1 준수)
- manifest 스크립트: 신규 생성·병합·cutoff 정리 3케이스 로컬 검증
- workflow_dispatch 수동 트리거는 PAT의 Actions 권한 부재로 403 → cron(매시 7분) 자동 실행으로 검증 대기. 결과는 확인 후 추기.
- 메인 CI가 tools/mirror-manifest.mjs의 no-undef 4건으로 실패(T-011: 로컬 검증의 tail 파이프가 종료 코드를 가려 통과로 오보) → eslint에 tools 전역 선언 추가, 파이프 없이 종료 코드 0 재확인 후 재커밋.

**판단 근거**

- 미러 가치는 축적 기간에 비례("가짜 과거값 금지" 원칙상 소급 불가) → 게시 조기 시작이 곧 기능. 클라이언트 시딩은 소비자(v2 기본 사용자)가 생기기 전 실익이 없어 분리.

**결과**

- 완료: 게시 파이프라인 코드·문서. cron 첫 실행이 2슬롯 넘게 지연되어(신규 스케줄 등록 지연, GitHub 측) 사용자가 PAT에 Actions 권한 추가 후 workflow_dispatch로 첫 실행(run 29188799600, 23초, success). 끝-대-끝 검증 통과: release mirror-data 생성, 자산 3종(json.gz 120KB·manifest·state.db 876KB), 다운로드 sha256 = manifest 기재값 일치, 내용 279 sightings/snapshots — 소스 devto·github·hackernews만, raw 부재(계약 14.1 준수). 이후 매시 7분 cron 자동. 남은 작업: M3(fetch --seed)는 v2 전환(0.2.0)과 함께

---

### W-031 · 정적 스냅샷 미러 후보 검토: 공식 RSS 약관 조사

**요청**

- 정적 스냅샷 미러(D-009 후보) 논의 중 공식 RSS 7종의 재배포 약관 확인. Reddit은 "정책상 미러 제외 → 완전성 미보장"으로 표기하기로 방향 확인

**수행 작업**

- 공식 RSS 운영 주체 6곳(OpenAI, Google, Hugging Face, Cursor, Figma, Anthropic)의 약관·라이선스를 웹 검색·원문 확인. 결과: **재배포 명시 허용 없음**(Cursor는 reproduce/harvest 명시 금지, Claude Code 저장소는 All rights reserved — 1차 조회가 MIT로 오답하여 LICENSE.md 원문 재확인으로 정정)
- 구조적 결론 도출: 공식 RSS는 점수가 없어 스냅샷·성장 기준점이 필요 없고 피드 자체가 이력을 보관하므로 **미러에서 제외해도 기능 손실 0** → 약관 회색지대 전면 회피
- 미러 구성안 확정(후보): HN·DEV·GitHub 스냅샷(숫자) 중심 포함(DEV 메타데이터 확인 필요), arXiv·HF 필요 시, 공식 RSS·Reddit 제외
- Reddit 표기 문안 확정: "정책상 미러 제외, 로컬 수집만 — 꺼진 동안 관측 복구 불가(완전성 미보장), 약관 준수를 위한 의도된 제한"

**외부 자료 기록** (확인일 2026-07-12)

| URL                                                                      | 제목                    | 판단 근거                               | 적용 범위                                 |
| ------------------------------------------------------------------------ | ----------------------- | --------------------------------------- | ----------------------------------------- |
| https://openai.com/policies/row-terms-of-use/                            | OpenAI Terms of Use     | 콘텐츠 권리 유보, 재게시 명시 허용 없음 | rss:openai 미러 제외 판단                 |
| https://policies.google.com/terms                                        | Google Terms of Service | 소유자 명시 허용 없는 복사·배포 불가    | rss:deepmind, rss:googleai 미러 제외 판단 |
| https://huggingface.co/terms-of-service                                  | Hugging Face ToS        | 블로그 일괄 재배포 허용 없음            | rss:hfblog 미러 제외 판단                 |
| https://cursor.com/terms-of-service                                      | Cursor ToS              | reproduce/harvest/extract 명시 금지     | rss:cursor 미러 제외 판단                 |
| https://www.figma.com/legal/tos/                                         | Figma ToS               | 명시 부여 외 권리 유보                  | rss:figma 미러 제외 판단                  |
| https://raw.githubusercontent.com/anthropics/claude-code/main/LICENSE.md | Claude Code LICENSE.md  | © Anthropic PBC. All rights reserved.   | rss:claude-code 미러 제외 판단            |

**변경 파일**

- Worklog.md

**검증**

- Claude Code 라이선스는 1차 검색 결과(MIT 추정)가 원문과 달라 raw LICENSE.md 직접 확인으로 교차 검증

**판단 근거**

- 재배포는 개인 구독과 법적 성격이 다르므로 "관행상 안전" 추정 대신 원문 확인(9절). 미러 필요성은 성장 기준점 유무로 판단 — 점수 없는 채널은 미러 실익이 없음

**결과**

- 완료: 미러 후보의 법적 검토 종료. 결정은 7/26 게이트 수치 확인 후 D-009로 기록 예정

---

### W-030 · v2 롤아웃 문서 정합화 (D-008)

**요청**

- v2 랭킹 재확인 중 발견된 문서 모순(D-007 vs 계약 13절) 해소. v2 기본 전환을 0.2.0 묶음에 합류시키는 방향으로 문서부터 수정

**수행 작업**

- Decisionlog에 D-008 추가: v2 기본 전환을 0.2.0에 합류, publish는 승인 게이트 통과 후로 연기(계약 원안 복원). D-007은 기록 보존
- requirements-contract.md 13절: 워밍업 달력 기준일(2026-07-12), 단계별 목표일(~07-19 워밍업, ~07-26 shadow), 0.2.0 구성(D-007 묶음 + v2 전환)과 publish 조건 명시
- v2 계획서 10절에 부기: V2-0~V2-5 완료 상태, 일정, 계약 13절 우선 명시

**변경 파일**

- Decisionlog.md, docs/requirements-contract.md, docs/plans/2026-07-10-trend-ranking-v2-plan.md, Worklog.md

**검증**

- 문서 작업. 세 문서의 버전·일정 표기가 D-008 기준으로 일치함을 상호 대조로 확인

**판단 근거**

- CLAUDE.md 5절: 기준이 바뀌면 코드보다 계약 문서를 먼저 갱신. 과거 결정(D-007)은 수정하지 않고 새 결정(D-008)으로 대체해 이력 보존

**결과**

- 완료: 문서 정합. 다음 작업: ~07-26 shadow 데이터로 게이트 평가 → 통과 시 v2 기본 전환 구현 → 0.2.0 publish. 0.2.0 publish는 그때까지 보류(npm 최신은 0.1.0 유지)

---

### W-029 · 0.2.0 묶음 릴리스 준비 (schedule 견고화·업데이트 안내·피드 문서화·영어 README)

**요청**

- 개선사항을 묶어 한 번에 publish (D-007 묶음 릴리스 정책에 따라 0.2.0)

**수행 작업**

- schedule 견고화: Windows 등록을 wscript 숨김 래퍼(fetch-hidden.vbs)로 전환해 콘솔 창 깜빡임 제거, 설치 내용을 schedule.json manifest로 기록, doctor가 구버전 방식·실행 대상 유실·래퍼 유실을 구분 경고 (src/scheduler/index.ts, doctor.ts)
- 업데이트 안내: CLI 종료 후 stderr로 새 버전 안내. 24시간 캐시, 2초 타임아웃, 실패 침묵, AINS_NO_UPDATE_CHECK/CI 옵트아웃, MCP 프로세스 제외 (src/cli/updateNotice.ts, index.ts)
- 커스텀 RSS 피드 README 노출(대체 방식 주의 포함), docs/index.html에 schedule·업데이트 안내 추가
- README 이중화: 영어 README.md(npm 첫 화면) + 한국어 README.ko.md, 상호 언어 링크, files에 ko 추가
- 부수: eslint ignore에 .remember/**, .gitignore에 .remember/ 추가(로컬 도구 산출물)

**변경 파일**

- src/scheduler/index.ts, src/cli/commands/doctor.ts, src/cli/index.ts, src/cli/updateNotice.ts(신규), tests/core/scheduler.test.ts(신규 11), tests/cli/updateNotice.test.ts(신규 16), README.md, README.ko.md(신규), docs/index.html, package.json(0.2.0, files), eslint.config.js, .gitignore, Decisionlog.md(D-007), Worklog.md

**검증**

- build·typecheck·lint 통과, 테스트 32파일·226개 통과(신규 27개 포함)
- npm pack: 9파일(LICENSE·양어 README 포함), 298.2kB
- 실기(Windows): doctor가 기존 구버전 스케줄을 "재등록 권장"으로 감지 → 재등록 후 "등록됨(60분마다)" → 작업이 wscript 래퍼로 등록됨 확인 → 수동 실행 결과 0
- 미검증: 스케줄 Last Result 0은 wscript 성공 기준(내부 fetch 성공은 다음 주기의 doctor 마지막성공으로 확인 예정). 업데이트 안내 stderr 실출력은 구버전 설치 환경이 없어 테스트로만 검증.

**판단 근거**

- 창 숨김은 schtasks가 콘솔 앱을 세션에서 띄우는 구조상 래퍼가 표준 해법. manifest 방식은 OS 역파싱보다 단순·크로스 플랫폼·테스트 가능. 업데이트 안내는 stdout 순수성(MCP)·JSON 파이프 안전(stderr)·LLM 무호출 원칙과 충돌하지 않게 설계.

**결과**

- 완료: 0.2.0 릴리스 준비. 커밋 4e50509 푸시, CI(run 29184458753) 3-OS 테스트 6조합 + pack smoke 3개 전부 green. 남은 작업: 사용자 npm publish(OTP)

---

### W-028 · 최소 Node 버전 22.12 상향과 0.1.1 준비

**요청**

- CI가 발견한 Node 20 호환성 문제 처리(선택지 제시 후 사용자가 상향 결정)

**수행 작업**

- CI 실패 로그 분석: ① better-sqlite3 win32+Node20 프리빌트 부재로 소스 컴파일 실패, ② commander@15의 engines가 node >=22.12.0 요구 → "Node ≥ 20" 선언이 애초 성립하지 않았음을 확인
- D-006 결정 기록 후 일괄 반영: package.json(version 0.1.1, engines >=22.12.0), doctor.ts(검사 22 기준), tsup.config.ts(target node22), ci.yml(매트릭스 [22,24]), README·docs/index.html(3곳)·CLAUDE.md·AGENTS.md의 Node 표기

**변경 파일**

- package.json, src/cli/commands/doctor.ts, tsup.config.ts, .github/workflows/ci.yml, README.md, docs/index.html, CLAUDE.md, AGENTS.md, Decisionlog.md, Worklog.md, Troubleshootinglog.md

**검증**

- 로컬: build 성공, 테스트 199개 통과, `--version` 0.1.1, prettier 통과
- CI 재실행(run 29183843394): 테스트 6조합(3-OS × Node 22/24) + pack smoke 3-OS **전부 통과**. macOS/Linux에서 better-sqlite3 설치·CLI 실행·doctor까지 검증됨

**판단 근거**

- Node 20은 2026-04 EOL. 의존성 요구(commander 22.12+)와 실측 실패(win32 프리빌트 부재)가 겹쳐, 지원 유지가 아니라 기준 상향이 정직한 해결. 기준 변경이므로 CLAUDE.md·계약 수준 문서를 코드와 같은 커밋에서 갱신(5절)

**결과**

- 완료: 커밋 2250db7 푸시. 남은 작업: CI green 확인 → 사용자 npm publish(0.1.1, OTP 필요)

---

### W-026 · npm 최초 배포(0.1.0)와 설치 문서 전환

**요청**

- 배포 task 순서대로 진행: 소스맵 결정 → MCP 등록 문서화 → 설치 안내 갱신 → publish → 스모크 테스트

**수행 작업**

- 소스맵 포함 유지 결정: `sourcesContent` 내장 확인(56개 원본 포함, 패키지 단독으로 디버깅 가능). 737kB는 npm 생태계 기준 무시 가능 판단
- README·docs/index.html 설치 안내를 `npm install -g ai-news-supplier` 기준으로 전환(소스 빌드는 개발용으로 이동), MCP 절에 Claude Code 등록과 npx 무설치 대안(`npx -y -p ai-news-supplier ains-mcp`) 추가, 문제 해결 절 갱신
- publish 1차 시도 403(2FA 필요, T-010) → 사용자가 2FA 등록 후 본인 터미널에서 publish 성공
- 레지스트리 실검증: `npm view`(0.1.0, latest), 새 폴더에 레지스트리 실설치(취약점 0) 후 `ains --version`/`doctor` green, 문서화한 npx MCP 명령으로 initialize 핸드셰이크 성공

**변경 파일**

- README.md, docs/index.html, Worklog.md, Troubleshootinglog.md

**검증**

- prettier 통과, "배포 전" 잔여 문구 0건
- prepublishOnly에서 테스트 30파일·199개 전부 통과 후 업로드됨
- 공개 패키지 기준 설치→CLI→DB(네이티브 모듈)→MCP 전 구간 스모크 통과 (Windows x64, Node v24.14.1)

**판단 근거**

- 문서를 publish와 같은 흐름에서 갱신해 "구현되지 않은 것을 제공한다고 표현하지 않는다"(8절)를 유지
- OTP는 시간 민감 비밀정보이므로 publish 최종 단계는 사용자 터미널에서 직접 수행

**결과**

- 완료: https://www.npmjs.com/package/ai-news-supplier 0.1.0 공개
- 미검증 범위: macOS/Linux에서의 better-sqlite3 설치·동작(추후 실기 확인 시 기록)

---

### W-025 · README 정합성 점검 (npm publish 전)

**요청**

- 배포 단계를 task로 등록하고 README 정합성부터 점검

**수행 작업**

- README의 모든 주장(기능 표, CLI 명령·옵션, MCP 도구·프롬프트 수, 수집 소스, 데이터·보안 수치, 기본 랭킹)을 실행 결과·코드와 대조
- CLI: `trends/fetch/search/learn/schedule/config` 하위 옵션 전부를 클린 설치본 `--help` 출력과 대조 → 일치
- MCP: stdio로 `tools/list`(9개)·`prompts/list`(3개: trend-briefing, learn-today, deep-dive) 실호출 → README 표기와 일치
- 수치: 보존 90일(config.ts:33), snapshot 14일(sightingStore.ts:823), Reddit 48시간(sightingStore.ts:744), `AINS_HOME`(paths.ts:9) → 일치
- 기본 랭킹: request.ts:131-133에서 옵션 없으면 legacy, channel/sort 지정 시 v2 → README 문구와 일치

**변경 파일**

- Worklog.md (기록. W-023 제목 줄이 W-024 추가 시 유실된 것도 복원)

**검증**

- 전 항목 실행 기반 대조 완료. 불일치 0건.
- publish 시점에 갱신 필요한 곳 2곳 식별: README "5분 빠른 시작"(배포 전 단계 문구), docs/index.html:1325(같은 문구)

**판단 근거**

- CLAUDE.md 8절(README에는 실제 구현만) 준수 확인이 publish 전제 조건. 현재 문구는 배포 전 상태 기준으로 정확하므로, npm 설치 안내로의 교체는 publish와 같은 커밋에서 수행해야 문서가 거짓이 되는 구간이 없음.

**결과**

- 완료: README 정합성 green. 남은 작업: 소스맵 결정 → MCP npx 문서화 → publish 직전 설치 안내 갱신 → publish → 스모크 테스트

---

### W-023 · npm 배포 개념 설명 및 배포물 검증(publish 전)

**요청**

- ains CLI/MCP가 로컬 파일 의존이라는 점 확인과 배포 방법 문의 → 개념 설명 후 배포 검증 진행

**수행 작업**

- npm 패키지 배포 개념 설명(서비스 배포 vs 패키지 배포, src→dist 빌드, bin/files/deps, 네이티브 모듈, semver, MCP npx 등록, stdout 순수성)
- 배포 검증: `npm run build`(성공) → `npm view`로 이름 `ai-news-supplier` 미사용(가용) 확인 → `npm pack --dry-run`(7파일 288.9kB) → scratchpad에 실제 tarball 생성 후 빈 프로젝트에 클린 설치(143 deps, 취약점 0)
- 클린 설치 환경에서 실행 검증: `ains --version`(0.1.0), `ains --help`(명령 목록), `ains doctor`(better-sqlite3 네이티브 모듈 로드·DB 878건 읽기 성공), MCP initialize 핸드셰이크(stdout 순수 JSON-RPC, stderr 비어있음)

**변경 파일**

- 없음(검증 전용, 산출물은 scratchpad에 격리). Worklog.md만 갱신.

**검증**

- 위 클린 설치 후 CLI/DB/MCP 전 항목 정상. 플랫폼: Windows x64, Node v24.14.1.
- 미검증: macOS/Linux 네이티브 모듈 동작, README 내용-기능 정합성.

**판단 근거**

- publish는 되돌리기 어려운 외부 공개 작업이므로, 실제 업로드 전 `npm pack`→클린 설치로 배포물 무결성을 먼저 확인(validation-plan.md 배포물 구조 기준).

**결과**

- 완료: 배포물 검증 green, 이름 가용 확인. 남은 작업: README 정합성 점검, `npm login` 후 `npm publish --access public`, 타 OS 미검증 표기.

---

### W-022 · trend-ranking-v2 worktree와 브랜치 정리

**요청**

- `0.Ai_News_Supplier-trend-v2` 작업 폴더와 관련 로컬·원격 브랜치를 모두 정리

**수행 작업**

- `codex/trend-ranking-v2`가 `main`에 완전히 포함됐는지 재확인
- 대상 worktree의 미커밋 변경과 제거 대상 절대경로를 재확인
- `git worktree remove`와 `git worktree prune`으로 작업 폴더·등록 정리
- 로컬 `codex/trend-ranking-v2` 브랜치 삭제
- 원격 `origin/codex/trend-ranking-v2` 브랜치 삭제
- 별개인 `main`의 `.codex/config.toml` 미커밋 변경은 보존

**변경 파일**

- `Worklog.md`

**검증**

- `npm test`: 30개 파일·199개 테스트 통과
- feature HEAD가 `main`의 ancestor임을 확인
- 제거 전 worktree 상태: clean
- 대상 경로 `Test-Path`: `False`
- `git worktree list`: main worktree 하나만 존재
- 로컬·원격 `codex/trend-ranking-v2` 브랜치가 모두 없음을 확인

**판단 근거**

- v2 구현과 후속 수정이 이미 `main`에 병합·푸시됐고 별도 worktree에 고유 변경이 없어 안전하게 정리할 수 있었음
- 폴더를 탐색기에서 직접 지우지 않고 Git worktree 등록을 먼저 정상 해제해 stale 메타데이터를 남기지 않음

**결과**

- 완료: trend-ranking-v2 작업 폴더, worktree 등록, 로컬 브랜치와 원격 브랜치 전체 정리
- 보존: `main`과 `origin/main`, 사용자 의도 확인 중인 `.codex/config.toml` 변경

### W-021 · README 요약본과 단일 HTML 사용자 설명서 구축

**요청**

- README는 빠른 시작·전체 기능 요약·일반적인 GitHub 안내로 간결하게 개편
- CLI와 MCP의 개발 배경, 기능별 예시, 작업 예시와 주의사항을 여러 Markdown이 아닌 하나의 보기 좋은 HTML 설명서로 작성

**수행 작업**

- README를 프로젝트 소개, 주요 기능, 5분 빠른 시작, MCP 빠른 연결, 대표 명령, 지원 소스, 데이터·보안, 개발·기여 중심으로 재구성
- 외부 CDN·폰트·이미지 없이 단독 실행되는 `docs/index.html` 사용자 설명서 신규 작성
- 반응형 고정 목차, 문서 검색, 밝은·어두운 테마, 코드 복사, 키보드 조작 탭, 인쇄 스타일과 접근 가능한 시맨틱 구조 구현
- 실제 CLI 10개 명령·하위 옵션, MCP 도구 9개·프롬프트 3개, 자연어 작업 예시 10개, 랭킹 해석, 소스·설정·보존·복구·문제 해결을 현재 0.1.0 구현 기준으로 문서화
- npm 패키지 파일 목록에 `docs/index.html`을 추가해 설치 패키지에서도 오프라인 설명서를 열 수 있도록 구성

**변경 파일**

- `README.md`
- `docs/index.html`
- `package.json`
- `Decisionlog.md`
- `Troubleshootinglog.md`
- `Worklog.md`

**검증**

- HTML 자동 검사: 중복 ID 0, 깨진 내부 앵커 0, 깨진 상대 링크 0, inline JavaScript 구문 정상, 외부 자산 0
- 인터페이스 정합성: CLI 상위 명령 10개와 MCP 도구 9개가 설명서에 모두 포함됨
- `npx prettier --check package.json README.md docs/index.html`: 통과
- `git diff --check`: 통과
- `npm run typecheck`: 통과
- `npm test`: 30개 파일·199개 테스트 통과
- `npm run lint`: 통과
- `npm run build`: 통과
- `npm pack --pack-destination out`: 성공, 패키지 7개 파일 중 `docs/index.html` 포함 확인
- 빌드 산출물 CLI smoke: 버전 0.1.0, help 10개 명령, doctor DB 무결성 ok, v2 Overview 4개 섹션 조회 성공
- 비밀정보 패턴 검사: 일치 없음

**판단 근거**

- GitHub 첫 방문자는 짧은 README에서 제품 가치와 설치 가능 여부를 판단하고, 실제 사용자는 한 페이지 설명서의 목차·검색·예시로 필요한 기능을 빠르게 찾는 역할 분리가 적합함
- 상세 설명을 HTML 한 파일에 모으고 외부 자산을 제거하면 로컬·npm 패키지·향후 GitHub Pages에서 같은 문서를 사용할 수 있음
- 현재 도움말과 MCP Zod 스키마를 직접 대조해 아직 구현되지 않은 기능을 제공한다고 표현하지 않음

**결과**

- 완료: 요약형 README와 단일 HTML 공식 사용자 설명서 작성·패키징·회귀 검증
- 남은 작업: 공개 웹 주소가 필요할 때 별도 승인 후 GitHub Pages 배포 설정, 실제 브라우저별 시각 QA

### W-020 · `/mcp` 미표시 후속 진단과 전역 CLI 실동작 검증

**요청**

- 실제 호출 가능한 ains MCP가 `/mcp`에 표시되지 않는 문제의 해결 방법 확인
- 전역 설치된 `ains` CLI가 정상적으로 기능하는지 추가 검증

**수행 작업**

- Codex 앱 시작 시각과 프로젝트 `.codex/config.toml` 수정 시각을 비교해 설정 생성 후 앱이 이미 재시작된 상태임을 확인
- 사용자 전역 `~/.codex/config.toml`에는 ains가 없고 신뢰된 프로젝트 설정에만 등록되어 있음을 값 노출 없이 확인
- 공식 Codex 설정 계층과 MCP 등록·재시작·`/mcp` 안내를 재확인
- 전역 `ains`의 버전, 도움말, `doctor`, v2 Overview JSON 조회와 잘못된 channel/sort 조합 오류를 실행

**변경 파일**

- `Worklog.md`
- `Troubleshootinglog.md`

**검증**

- `ains --version`: `0.1.0`
- `ains doctor`: 종료 코드 0, Node 정상, DB 무결성 `ok`, 스키마 `v2/2`, 총 546개 항목
- `ains trends --ranking v2 --channel overview --sort briefing --limit 4 --no-refresh --json`: 4개 항목·4개 섹션 반환
- `repos`+`hot` 잘못된 조합: 명시 오류와 종료 코드 1 반환
- 네트워크 수집·사용자 데이터 변경 명령은 실행하지 않음

**판단 근거**

- 앱이 설정 생성 후 재시작되었고 현재 작업에서 MCP 직접 호출도 성공하므로 서버·PATH·신뢰·설정 로딩 문제가 아니라 `/mcp` 표시 계층의 불일치로 판단
- 표시 자체를 우회하려면 공식 기본 위치인 사용자 전역 설정에 동일 STDIO 서버를 등록하는 방법이 가장 재현 가능하나, 모든 프로젝트에 영향을 주므로 사용자 선택 후 적용해야 함

**결과**

- 완료: CLI 핵심 읽기 경로와 오류 처리가 정상임을 확인하고 `/mcp` 표시 문제의 단계별 해결·우회 절차를 확정

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
