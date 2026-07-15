# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

Each release is also published as a [GitHub Release](https://github.com/gorhkdwj/AI-News-Supplier/releases) with the same notes.

## [Unreleased]

### Added

- **Learning session evidence now carries triage signals**: each source line includes the representative discussion URL (when one exists), score, and comment count, so a consuming agent can route around blocked originals (e.g. HTTP 403) and gauge how much material sits behind a link before fetching it.
- **Session instructions now include fallback rules**: content obtained via a discussion page must be marked as second-hand, and when evidence is too thin the agent is told to shrink the session, search for more material, suggest retrying later, or stop and report — never fabricate.

### Fixed

- The practice step no longer tells the agent to "pick a hot repo/model" when the repos bucket is empty; it switches to reproducing the method from the available evidence instead.
- **Empty v2 repos·trending results now explain themselves**: when no repository qualifies, the section carries a `notice` telling you whether nothing was collected yet, growth baselines are still warming up (the first ~7 days after install), or candidates simply failed the eligibility bar. The CLI prints it as `(사유: …)` and the MCP response adds a `notice` field to `sections[]` (additive, backward-compatible).

- **Learning session no longer returns an empty skeleton for natural-language topics** (T-012): evidence search now relaxes from full-match (AND) to per-word match (OR) when nothing matches, and when even that finds nothing the instructions explicitly say so and suggest retrying with 1–2 English keywords. The MCP response gains a `search { mode: exact|relaxed|none, matched }` field, and the tool description now recommends English keyword topics.
- Time-dependent test fixtures (`tests/cli/trends.test.ts`, `tests/core/learning.test.ts`) used hardcoded dates and were guaranteed to fail once the calendar passed them (T-013); they now use timestamps relative to the run time.

## [0.2.0] - 2026-07-12

### Breaking

- **Node.js >= 22.12 is now required** (was >= 20). Node 20 reached EOL in April 2026, `commander@15` already requires >= 22.12, and `better-sqlite3` ships no prebuilt binary for Windows + Node 20.

### Added

- **Update notice**: the CLI checks npm at most once a day and prints upgrade hints to stderr. Opt out with `AINS_NO_UPDATE_CHECK=1`; silent in CI and MCP processes.
- **Snapshot mirror publishing pipeline**: a GitHub Actions cron collects Hacker News / DEV.to / GitHub observations hourly and publishes them as static assets to the `mirror-data` release (metadata and numeric snapshots only — no article bodies, no Reddit; see contract §14). Client-side seeding lands in a later release.
- `ains mirror export` maintenance command backing the pipeline.
- **Bilingual README**: English `README.md` + Korean `README.ko.md`.
- Custom RSS feed configuration documented (the `sources.rss.feeds` array — note it replaces the default list).
- Claude Desktop app (including Cowork) MCP setup guide, with PATH and tray-restart gotchas.

### Changed

- **Windows scheduler no longer flashes a console window**: `ains schedule install` registers through a hidden `wscript` wrapper and records a manifest (`~/.ai-news-supplier/schedule.json`).
- `ains doctor` now detects broken or legacy schedule registrations and suggests re-installing.

### Infrastructure

- MIT `LICENSE` file added.
- Cross-platform CI: Ubuntu / macOS / Windows × Node 22 / 24, plus a tarball global-install smoke test.

## [0.1.0] - 2026-07-12

Initial public release.

- Collectors for 14 sources: Hacker News, DEV.to, Reddit (OAuth, disabled by default), GitHub repositories, Gemini CLI releases, Hugging Face models, arXiv, and 7 official RSS/Atom feeds (OpenAI, Google DeepMind, Google AI, Hugging Face blog, Claude Code, Cursor, Figma). A failing source never breaks the rest of a run.
- Local SQLite store (schema v2: Story / Sighting / Metric Snapshot) with FTS full-text search.
- `ains trends` with legacy ranking by default and typed ranking v2 (`--ranking v2`) as opt-in: community / official / repos / research channels plus a combined overview.
- Rule-based learning support: candidates, session design, and history.
- MCP STDIO server (`ains-mcp`) with 9 tools and 3 prompts.
- OS scheduler integration (`ains schedule`, Windows schtasks / Unix crontab) and `ains doctor` diagnostics.
- Data retention: stories 90 days (configurable), metric snapshots 14 days, Reddit content 48 hours max.

[0.2.0]: https://github.com/gorhkdwj/AI-News-Supplier/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/gorhkdwj/AI-News-Supplier/releases/tag/v0.1.0
