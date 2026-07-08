# ai-news-supplier

> AI 소식(커뮤니티·공식 업데이트·핫레포·핫모델·논문)을 수집해 로컬에 축적하고, MCP와 CLI로 LLM 에이전트에 공급하는 로컬 우선 도구

## 개요
- 목적: Hacker News, GitHub, 공식 블로그 RSS, Hugging Face, arXiv, DEV.to(+Reddit 선택)에서 AI 관련 소식을 수집해 로컬 SQLite에 축적하고, MCP(stdio) 도구와 CLI 명령으로 LLM 에이전트(Claude Code 등)에 제공합니다. 학습 가치가 높은 토픽을 발굴해 에이전트가 학습 세션을 설계하도록 돕는 기능을 포함합니다.
- 주요 사용자: LLM 에이전트를 사용하는 개발자
- 최종 산출물: npm 패키지 (CLI `ains` + MCP 서버 `ains-mcp`)

## 실행 방법
(아직 구현된 기능이 없습니다. 구현 완료 시 실제 동작하는 기능만 여기에 기재합니다.)

## 프로젝트 구조
- `src/` 실행 코드 (`core` 수집·저장·랭킹·학습 / `collectors` 소스별 수집기 / `mcp` MCP 서버 / `cli` CLI / `scheduler` OS 스케줄러 연동)
- `tests/` 테스트와 fixture
- `tools/` 개발 보조 스크립트
- `docs/` 기획·계약·구현·검증 문서
- `out/` 실행 결과·임시 산출물 (Git 제외)

## 문서
- 작업 규칙: `CLAUDE.md`
- 확정 구현 계획: `docs/plans/2026-07-09-ai-news-supplier-plan.md`
- 기준 계약: `docs/requirements-contract.md`
- 작업 이력: `Worklog.md`
- 주요 결정: `Decisionlog.md`
- 문제 해결: `Troubleshootinglog.md`
