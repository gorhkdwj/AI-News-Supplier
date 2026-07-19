# ai-news-supplier (`ains`)

**English** | [한국어](README.ko.md)

> A local-first tool that collects AI news from public APIs and RSS/Atom feeds into a local SQLite database, and supplies it to LLM agents via CLI and MCP.

`ains` gathers community signals, official product updates, trending GitHub repositories, models, and papers in one place. It runs entirely on your machine — no server, no LLM calls from the tool itself — and stores data under `~/.ai-news-supplier/` by default.

## Features

| Feature               | Description                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| Typed trends          | Community, Official, Repos, and Research ranked by different signals, combined in an Overview.          |
| Local store & search  | Collects public sources on a TTL basis and provides SQLite FTS full-text search.                        |
| CLI                   | Trends, fetch, search, item detail, diagnostics, config, scheduling, and learning history.              |
| MCP                   | 9 STDIO tools and 3 prompts for agents such as Claude Code and Codex.                                   |
| Learning support      | Finds high-value topics from recent signals and packages context for agent-led study sessions.          |
| Update notice         | Checks npm at most once a day and prints upgrade hints to stderr (`AINS_NO_UPDATE_CHECK=1` to disable). |
| Local & privacy first | Most sources need no API key; tokens and the database never enter the repository.                       |

## Quick start

Requires Node.js 22.12 or later. Install globally from the npm registry:

```bash
npm install -g ai-news-supplier
```

Verify the installation and fetch your first results:

```bash
ains --version
ains doctor
ains fetch
ains trends --limit 12
```

On a fresh install, growth rankings (v2 repos trending) need up to 7 days of local snapshots to warm up. You can skip most of that wait by seeding from the public snapshot mirror (Hacker News / DEV.to / GitHub metadata and numeric snapshots only):

```bash
ains fetch --seed
```

The mirror address can be changed in `~/.ai-news-supplier/config.json` (`mirror.repo`, `mirror.tag`) if you run your own fork of the mirror workflow.

To pick a specific v2 channel and sort:

```bash
ains trends --channel overview --sort briefing --limit 12
ains trends --channel repos --sort trending
ains trends --channel official --sort important
```

> Since 0.3.0, plain `ains trends` without options defaults to the v2 overview briefing (Official · Repos · Community · Research). The previous ranking is still available with `--ranking legacy` and will be removed in 0.4.0.

To build from source instead (for development):

```bash
git clone https://github.com/gorhkdwj/AI-News-Supplier.git
cd AI-News-Supplier
npm install
npm run build
npm link
```

## MCP quick connect

A global install puts `ains-mcp` on your PATH. Register it per agent:

```bash
# Claude Code
claude mcp add ains -- ains-mcp

# Codex CLI (user scope)
codex mcp add ains -- ains-mcp
codex mcp list
```

For a Codex project-scope config file:

```toml
# .codex/config.toml
[mcp_servers.ains]
command = "ains-mcp"
```

To try it without a global install (server startup may be slower):

```bash
claude mcp add ains -- npx -y -p ai-news-supplier ains-mcp
```

### Claude Desktop app (including Cowork)

The Claude Desktop app keeps its **own** MCP registry, separate from Claude Code — registering in one does not register in the other. Open Settings → Developer → Edit Config (`claude_desktop_config.json`) and add:

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

Two gotchas worth knowing:

- **Fully quit the app from the system tray**, then relaunch — closing the window is not enough, and a running app keeps the old config.
- GUI apps may resolve `PATH` differently from your terminal. If `npx` (or a bare `ains-mcp`) fails, use absolute paths instead, e.g. `"command": "C:\\path\\to\\node.exe", "args": ["C:\\path\\to\\global\\node_modules\\ai-news-supplier\\dist\\mcp\\server.js"]`.

Once registered, Cowork sessions can use ains as well. The claude.ai **web** app cannot connect to local STDIO servers.

When upgrading a **global install on Windows** (`npm install -g ai-news-supplier`), quit apps that are running `ains-mcp` first — a running server holds a lock on the native SQLite module and the upgrade may fail with `EPERM`. (`npx` registrations are unaffected: each version lives in its own cache.)

Restart the agent completely after registering. `ains-mcp` is a STDIO MCP server — it talks to the agent over standard input/output, not HTTP.

## Common commands

```bash
# Collect and browse
ains fetch --source "hackernews,github"
ains trends --ranking v2 --channel community --sort hot --hours 48

# Search the local store
ains search "mixture of experts" --days 30
ains show <story-id>

# Learning candidates, session design, history
ains learn candidates --limit 5
ains learn session "RAG" --level beginner --time 30
ains learn session --from-item <story-id>   # design a session from a collected item
ains learn record "RAG" --time 30 --notes "studied the basics"
ains history

# Config and periodic collection
ains config init
ains schedule install --every 60
```

On Windows, `schedule install` registers the task through a hidden-window wrapper so no console flashes, and records what it registered in `~/.ai-news-supplier/schedule.json`. `ains doctor` warns when a registered schedule points to a file that no longer exists (for example after reinstalling or moving the package).

## Sources

| Category  | Default sources                                                              | Auth                       |
| --------- | ---------------------------------------------------------------------------- | -------------------------- |
| Community | Hacker News, DEV.to                                                          | none                       |
| Community | Reddit                                                                       | OAuth credentials required |
| Repos     | GitHub Search & Repository API                                               | optional `GITHUB_TOKEN`    |
| Official  | OpenAI, Google DeepMind, Google AI, Hugging Face, Claude Code, Cursor, Figma | none                       |
| Official  | Gemini CLI Releases                                                          | optional `GITHUB_TOKEN`    |
| Research  | Hugging Face models, arXiv papers                                            | none                       |

A failing source never breaks the rest of a collection run.

### Custom RSS feeds

You can add any RSS/Atom feed via `~/.ai-news-supplier/config.json` (`ains config init` creates an example):

```json
{
  "sources": {
    "rss": {
      "feeds": [{ "id": "myblog", "title": "My AI Blog", "url": "https://example.com/feed.xml" }]
    }
  }
}
```

Note: the `feeds` array **replaces** the default feed list rather than extending it. To keep the defaults, include them in the array alongside your own entries (run `ains config init` and copy from the generated example).

## Full user guide

The complete CLI reference, all 9 MCP tools, natural-language task examples, ranking interpretation, configuration, data retention, and troubleshooting live in the [single-page HTML guide](docs/index.html) (Korean). Clone the repository or download the file and open it in a browser.

## Data & security

- Default database: `~/.ai-news-supplier/data.db`
- Default config: `~/.ai-news-supplier/config.json`
- Override the location with the `AINS_HOME` environment variable
- Story retention default: 90 days; metric snapshots: 14 days; Reddit data: 48 hours max
- API keys, passwords, and session cookies are never stored in code, logs, or fixtures
- `ains` itself never calls an LLM API and never generates translations or summaries

## Status

- Version: `0.3.1`
- Schema: v2 Story/Sighting/Metric Snapshot
- Default ranking: `v2` (since 0.3.0, after passing the approval gate); `--ranking legacy` remains until 0.4.0

## Development

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm pack
```

CI runs the test suite on Linux, macOS, and Windows with Node 22 and 24.

Version history lives in [CHANGELOG.md](CHANGELOG.md) and on the [GitHub Releases](https://github.com/gorhkdwj/AI-News-Supplier/releases) page.

When filing an issue, include your OS, Node.js version, `ains --version`, `ains doctor` output, and reproduction commands. Never attach tokens, raw config files, or your personal database.

## License

MIT
