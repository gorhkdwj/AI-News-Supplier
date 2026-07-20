# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

Each release is also published as a [GitHub Release](https://github.com/gorhkdwj/AI-News-Supplier/releases) with the same notes.

## [0.3.1] - 2026-07-21

### Security

- **`ains config show` no longer prints secrets** (B-017): it used to dump the resolved config verbatim, so `tokens.github` and the Reddit `clientId` / `clientSecret` / `username` appeared in plain text — and the manual was recommending the command as a first diagnostic step, which made pasting a token into an issue or a screen share an easy mistake. Values under `tokens` are now replaced with `"***"`. Unset values stay `null`, so "which of the three is missing, and why is Reddit disabled?" is still answerable from the output. Pass `--reveal` when you genuinely need the raw values; it prints a warning to stderr and keeps stdout valid JSON.

### Added

- **`ains learn session --from-item <story-id>` / MCP `design_learning_session.from_item`** (B-005, D-014): design a learning session directly from a collected item — the natural follow-up to spotting something interesting in `ains trends`. The tool performs no topic extraction (the item title becomes the search topic verbatim; judgment is delegated to the calling agent); the originating item is always included in the evidence, first in its bucket, and the instructions state the session's origin. `topic` and `from_item` are mutually exclusive (exactly one required).

### Changed

- **Session evidence is no longer dominated by a single bucket** (B-004, contract §11.4): broad topics used to fill the 40-item evidence list with whatever type ranks highest ('agent' returned 36/40 repos, 'model' 31/40 papers). The search now over-fetches 3× and allocates `floor(40/4)` per bucket (official/papers/repos/discussion) with round-robin redistribution of leftover slots — the same allocation scheme the v2 overview uses. `search.matched` now reports matches within the 120-item fetch window, which can exceed the number of evidence items actually included (≤40).
- **The bundled manual (`docs/index.html`) is rewritten for 0.3.1** (W-065): it still described v0.1.0 and contradicted itself — one chapter said v2 became the default in 0.3.0 while another still warned not to treat v2 as the default. It now documents cold-start seeding (`fetch --seed`), the empty-section reasons, `--from-item`, the per-bucket quota and the `search.matched` pitfall, `search.mode`, the doctor token warning, per-source TTLs and the mirror config keys; examples drop `--ranking v2` so they match the 0.3.0 default. Two new chapters cover cold start and a per-release summary of what changes for users. Links to `CHANGELOG.md` and the contract are now absolute, since neither file ships inside the npm package.

## [0.3.0] - 2026-07-19

### Breaking

- **The default ranking is now v2** (B-006, D-013): plain `ains trends` / MCP `get_trends` without options returns the v2 overview briefing (Official · Repos · Community · Research sections) instead of the legacy hotness list. The approval gate (contract §13) passed on 2026-07-19: 24h/7d baseline coverage, top-20 full coverage, precision@20 ≥ 90% on both labeled channels, and community score availability all cleared. The previous behavior remains available with `--ranking legacy` / `ranking_version: "legacy"` for one more release and will be removed in 0.4.0.

### Added

- **Cold-start seeding from the snapshot mirror** (`ains fetch --seed`): downloads the public mirror's accumulated observations (Hacker News / DEV.to / GitHub metadata and numeric snapshots only) and merges them idempotently into the local DB, so growth rankings have baselines from day one instead of after a ~7-day warmup. Local data always wins on conflict; corrupt or checksum-failing files are skipped individually; a seeding failure never breaks the regular fetch. The mirror address is configurable (`mirror.repo`, `mirror.tag`) for fork-hosted mirrors.
- **`ains doctor` now warns when no GitHub token is configured**: without one, the GitHub API allows only 60 requests/hour and collection can silently degrade. The warning links to token creation (read-only, no scopes needed) and shows where to put it. The token value itself is never printed.
- **Learning session evidence now carries triage signals**: each source line includes the representative discussion URL (when one exists), score, and comment count, so a consuming agent can route around blocked originals (e.g. HTTP 403) and gauge how much material sits behind a link before fetching it.
- **Session instructions now include fallback rules**: content obtained via a discussion page must be marked as second-hand, and when evidence is too thin the agent is told to shrink the session, search for more material, suggest retrying later, or stop and report — never fabricate.

### Fixed

- The practice step no longer tells the agent to "pick a hot repo/model" when the repos bucket is empty; it switches to reproducing the method from the available evidence instead.
- `config.json` saved with a UTF-8 BOM (Windows Notepad / PowerShell default) no longer fails to parse and silently fall back to defaults.
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

[0.3.1]: https://github.com/gorhkdwj/AI-News-Supplier/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/gorhkdwj/AI-News-Supplier/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/gorhkdwj/AI-News-Supplier/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/gorhkdwj/AI-News-Supplier/releases/tag/v0.1.0
