# ai-news-supplier (`ains`)

[English](README.md) | **한국어**

> 공개 API와 RSS/Atom에서 AI 소식을 모아 로컬 SQLite에 축적하고, CLI와 MCP로 LLM 에이전트에 공급하는 로컬 우선 도구입니다.

`ains`는 커뮤니티 반응, 공식 업데이트, GitHub 저장소, 모델과 논문을 한곳에 모읍니다. 별도 서버나 자체 LLM 호출 없이 사용자의 컴퓨터에서 동작하며, 수집한 데이터는 기본적으로 `~/.ai-news-supplier/`에 저장합니다.

## 주요 기능

| 기능               | 설명                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------- |
| 유형별 트렌드      | Community, Official, Repos, Research를 서로 다른 신호로 정렬하고 Overview로 조합합니다.      |
| 로컬 축적·검색     | 공개 소스를 TTL 기준으로 수집하고 SQLite FTS 전문 검색을 제공합니다.                         |
| CLI                | 트렌드 조회, 수집, 검색, 상세 조회, 진단, 설정, 스케줄과 학습 이력을 지원합니다.             |
| MCP                | Codex·Claude Code 같은 에이전트가 사용할 수 있는 STDIO 도구 9개와 프롬프트 3개를 제공합니다. |
| 학습 보조          | 여러 출처의 최근 신호로 학습 후보를 찾고 세션 지시문과 학습 이력을 관리합니다.               |
| 업데이트 안내      | 하루 최대 1회 npm에서 새 버전을 확인해 stderr로 안내합니다(`AINS_NO_UPDATE_CHECK=1`로 끔).   |
| 로컬·개인정보 우선 | API 키 없이 대부분의 소스를 사용할 수 있으며 토큰과 DB를 저장소에 넣지 않습니다.             |

## 5분 빠른 시작

Node.js 22.12 이상이 필요합니다. npm 레지스트리에서 전역 설치합니다.

```bash
npm install -g ai-news-supplier
```

설치와 로컬 DB 상태를 확인하고 첫 결과를 조회합니다.

```bash
ains --version
ains doctor
ains fetch
ains trends --limit 12
```

유형별 랭킹 v2를 명시적으로 사용하려면 다음과 같이 실행합니다.

```bash
ains trends --ranking v2 --channel overview --sort briefing --limit 12
ains trends --ranking v2 --channel repos --sort trending
ains trends --ranking v2 --channel official --sort important
```

> 옵션 없는 `ains trends`는 아직 `legacy` 랭킹이 기본입니다. v2는 기준점 수집과 shadow 비교 단계입니다.

소스에서 직접 빌드하려면(개발·기여용) 다음을 사용합니다.

```bash
git clone https://github.com/gorhkdwj/AI-News-Supplier.git
cd AI-News-Supplier
npm install
npm run build
npm link
```

## MCP 빠른 연결

전역 설치(`npm install -g ai-news-supplier`)를 마치면 `ains-mcp`가 PATH에 등록됩니다. 에이전트별 등록 명령은 다음과 같습니다.

```bash
# Claude Code
claude mcp add ains -- ains-mcp

# Codex CLI (사용자 전역)
codex mcp add ains -- ains-mcp
codex mcp list
```

Codex 프로젝트 범위 설정 파일을 직접 쓰는 경우는 다음과 같습니다.

```toml
# .codex/config.toml
[mcp_servers.ains]
command = "ains-mcp"
```

전역 설치 없이 시험하려면 `npx`로 등록할 수도 있습니다(서버 시작이 다소 느려질 수 있습니다).

```bash
claude mcp add ains -- npx -y -p ai-news-supplier ains-mcp
```

### Claude 데스크톱 앱 (Cowork 포함)

Claude 데스크톱 앱은 Claude Code와 **별개의** MCP 등록 장부를 씁니다 — 한쪽에 등록해도 다른 쪽에는 나타나지 않습니다. 설정 → 개발자 → Edit Config(`claude_desktop_config.json`)에 다음을 추가하십시오.

```json
{
  "mcpServers": {
    "ains": {
      "command": "npx",
      "args": ["-y", "-p", "ai-news-supplier", "ains-mcp"]
    }
  }
}
```

주의할 점 두 가지:

- 저장 후 **시스템 트레이에서 앱을 완전히 종료**하고 다시 실행하십시오 — 창만 닫으면 이전 설정의 프로세스가 계속 살아 있습니다.
- GUI 앱은 터미널과 `PATH`가 다를 수 있습니다. `npx`(또는 `ains-mcp` 단독)가 실패하면 절대 경로를 사용하십시오. 예: `"command": "C:\\경로\\node.exe", "args": ["C:\\경로\\node_modules\\ai-news-supplier\\dist\\mcp\\server.js"]`

등록되면 Cowork 세션에서도 ains를 사용할 수 있습니다. claude.ai **웹**은 로컬 STDIO 서버에 연결할 수 없습니다.

**Windows에서 전역 설치를 업데이트**(`npm install -g ai-news-supplier`)할 때는 `ains-mcp`를 실행 중인 앱을 먼저 종료하십시오 — 실행 중인 서버가 네이티브 SQLite 모듈 파일을 잠그고 있어 업데이트가 `EPERM`으로 실패할 수 있습니다. (`npx` 등록은 버전별 캐시가 분리되어 영향이 없습니다.)

등록 후 에이전트를 완전히 종료했다가 다시 열고 새 작업에서 확인하십시오. `ains-mcp`는 HTTP 서버가 아니라 표준 입출력으로 에이전트와 통신하는 STDIO MCP 서버입니다.

## 대표 명령

```bash
# 최신 데이터 수집과 조회
ains fetch --source "hackernews,github"
ains trends --ranking v2 --channel community --sort hot --hours 48

# 축적된 데이터 검색과 상세 조회
ains search "mixture of experts" --days 30
ains show <story-id>

# 학습 후보, 세션 설계, 이력
ains learn candidates --limit 5
ains learn session "RAG" --level beginner --time 30
ains learn record "RAG" --time 30 --notes "기초 개념 학습"
ains history

# 설정과 정기 수집
ains config init
ains schedule install --every 60
```

Windows에서 `schedule install`은 콘솔 창이 깜빡이지 않도록 숨김 래퍼로 등록하고, 등록 내용을 `~/.ai-news-supplier/schedule.json`에 기록합니다. 패키지 재설치·이동 등으로 실행 대상이 사라지면 `ains doctor`가 경고합니다.

## 수집 소스

| 범주      | 기본 소스                                                                    | 인증                       |
| --------- | ---------------------------------------------------------------------------- | -------------------------- |
| Community | Hacker News, DEV.to                                                          | 불필요                     |
| Community | Reddit                                                                       | OAuth 정보와 username 필요 |
| Repos     | GitHub Search·Repository API                                                 | 선택적 `GITHUB_TOKEN`      |
| Official  | OpenAI, Google DeepMind, Google AI, Hugging Face, Claude Code, Cursor, Figma | 불필요                     |
| Official  | Gemini CLI Releases                                                          | 선택적 `GITHUB_TOKEN`      |
| Research  | Hugging Face 모델, arXiv 논문                                                | 불필요                     |

한 소스가 실패해도 나머지 수집 결과는 유지합니다.

### 커스텀 RSS 피드 추가

`~/.ai-news-supplier/config.json`으로 원하는 RSS/Atom 피드를 추가할 수 있습니다(`ains config init`이 예제 파일을 만들어 줍니다).

```json
{
  "sources": {
    "rss": {
      "feeds": [{ "id": "myblog", "title": "My AI Blog", "url": "https://example.com/feed.xml" }]
    }
  }
}
```

주의: `feeds` 배열은 기본 피드 목록에 **추가되는 것이 아니라 전체를 대체**합니다. 기본 피드를 유지하려면 원하는 기본 항목도 배열에 함께 나열하십시오(`ains config init`으로 생성된 예제에서 복사할 수 있습니다).

## 상세 사용 설명서

CLI의 전체 옵션, MCP 도구 9개, 자연어 작업 예시, 랭킹 해석, 설정, 데이터 보존, 주의사항과 문제 해결은 [단일 HTML 사용 설명서](docs/index.html)에 정리되어 있습니다.

저장소를 복제하거나 HTML 파일을 내려받은 뒤 `docs/index.html`을 브라우저로 열면 검색·코드 복사·테마·인쇄 기능을 사용할 수 있습니다.

## 데이터와 보안

- 기본 데이터 위치: `~/.ai-news-supplier/data.db`
- 기본 설정 위치: `~/.ai-news-supplier/config.json`
- 경로 변경: `AINS_HOME`
- 일반 Story 보존 기본값: 90일 / metric snapshot 14일 / Reddit 데이터 최대 48시간
- API 키, 비밀번호, 세션 쿠키는 코드·로그·fixture에 저장하지 않습니다.
- `ains` 자체는 LLM API를 호출하거나 번역·요약을 생성하지 않습니다.

## 현재 상태

- 버전: `0.2.0`
- 스키마: v2 Story/Sighting/Metric Snapshot
- 기본 랭킹: `legacy` / 선택 랭킹: `--ranking v2`
- v2 전환 전 실제 24시간·7일 기준점과 14일 shadow 검증이 필요합니다.

## 개발과 기여

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm pack
```

CI가 Linux·macOS·Windows × Node 22·24에서 테스트를 실행합니다.

버전별 변경 내역은 [CHANGELOG.md](CHANGELOG.md)와 [GitHub Releases](https://github.com/gorhkdwj/AI-News-Supplier/releases)에서 확인할 수 있습니다.

이슈를 등록할 때는 운영체제, Node.js 버전, `ains --version`, `ains doctor` 결과와 재현 명령을 포함하십시오. 토큰, 설정 파일 원문, 개인 데이터베이스는 첨부하지 마십시오.

개발 기준은 [요구사항 계약](docs/requirements-contract.md)과 [구현 계획](docs/plans/implementation-plan.md)을 따릅니다.

## 라이선스

MIT
