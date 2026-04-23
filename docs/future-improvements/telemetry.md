# Telemetry — Future Improvements

← [Back to README](../../README.md)

This document captures the telemetry feature research and implementation history.

---

## ✅ 1. Run-level telemetry (SQLite + CLI + TUI)

> **Implemented** — Every `runAgentTask()` call now persists one row to `.copilot-flow/telemetry.db`
> via a `post-task` hook handler (`src/telemetry/collector.ts`). The `copilot-flow telemetry`
> subcommand surfaces aggregate stats and recent-run lists; the `/telemetry` TUI screen provides
> a live dashboard. See [docs/commands/telemetry.md](../commands/telemetry.md).

**Background**: The GitHub Copilot SDK exposes no native usage tracking (no token counts, no
billing data). For an agent orchestrator, behavioral metrics are more valuable than raw token
counts anyway — latency, success rate, retry frequency, and tool invocation patterns tell you
whether agents are working efficiently.

**What was implemented**:

### Data collection (`src/agents/executor.ts` → `post-task` hook)

The existing `post-task` hook was enriched with three new fields:

| Field | Source | Notes |
|-------|--------|-------|
| `promptChars` | `task.length` | Proxy for prompt cost |
| `responseChars` | `output_text.length` | Proxy for output size |
| `model` | local `model` variable | Which model was used |
| `toolsInvoked` | `tool.execution_start` SDK events | Array of tool names called |

### Storage (`src/telemetry/store.ts`)

SQLite table `runs` in `.copilot-flow/telemetry.db` (separate from `memory.db`):

```
id · agent_type · label · session_id · model · success · duration_ms
attempts · prompt_chars · response_chars · tools_invoked (JSON) · error · created_at
```

- `record(run)` — INSERT per run (no upsert; each run is a distinct event)
- `list(opts?)` — recent runs filtered by agent type and limited by count
- `summary()` — aggregate query: totals, success rate, avg latency, per-agent breakdown, top tools
- `clear()` — wipe all rows

### CLI (`copilot-flow telemetry`)

| Subcommand | Description |
|-----------|-------------|
| `telemetry summary` | Aggregate stats: total runs, success rate, avg latency, agent breakdown, top tools |
| `telemetry list [--type <agent>] [--limit <n>]` | Recent run log |
| `telemetry clear [--yes]` | Delete all records |

### TUI (`/telemetry`)

Dashboard screen in the interactive TUI:
- Summary stats row: total runs · success% · avg latency · avg prompt/response size
- Two-pane breakdown: per-agent-type table (left) + top tools list (right)
- Scrollable recent-runs list (`[↑↓]`)
- Keys: `[r]` refresh · `[c]` clear (with confirmation) · `[esc]` back

### Wiring

- `src/telemetry/collector.ts` — registers the `post-task` hook handler
- `src/commands/index.ts` — calls `registerTelemetryCollector()` at startup so all commands record runs automatically
- `src/tui/router.tsx` / `app.tsx` / `screens/home.tsx` / `commands/tui.ts` — `/telemetry` screen registered throughout

---

## Not implemented: token-level tracking

The Copilot SDK does not expose token usage metadata. Two paths exist if this is needed later:

1. **Switch model layer** — use OpenAI API or Azure OpenAI directly (both return `usage.prompt_tokens` / `completion_tokens`). Not viable while the project targets the Copilot CLI.
2. **Local tokenizer estimate** — use `tiktoken` or `gpt-tokenizer` for an approximate char→token mapping. Adds a dependency for approximate-only data; char length is a sufficient proxy for our use case.

Neither is recommended until a concrete need arises.
