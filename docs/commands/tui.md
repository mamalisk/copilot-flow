# copilot-flow tui

Launch an interactive full-screen terminal UI — a persistent slash-command REPL that
wraps every `copilot-flow` command in a rich, keyboard-driven interface.

```bash
copilot-flow tui
copilot-flow tui --screen memory    # open directly on a specific screen
```

## Overview

The TUI presents a split layout: an active **screen viewport** above and a persistent
**shell input bar** at the bottom. Navigate by typing slash commands into the bar.

```
┌─ copilot-flow ──────────────────────────── home  v2.11.0 ─┐
│                                                             │
│  [active screen renders here]                              │
│                                                             │
│  ─────────────────────────────────────────────────────   │
│  > /plan prd.md_                                           │
│  [tab] complete  [↑↓] history  [esc] back  [ctrl+c] quit  │
└────────────────────────────────────────────────────────────┘
```

## Navigation

| Input | Action |
|-------|--------|
| `/command [args]` | Navigate to a screen, passing optional args |
| `Tab` | Autocomplete screen name from partial input |
| `↑` / `↓` | Browse command history (last 50 commands) |
| `Escape` | Clear input; if empty, go back to previous screen |
| `/back` | Explicitly go back one screen |
| `/quit` or `/q` | Exit the TUI |
| `Ctrl+C` | Exit immediately |

## Screens

| Command | Screen | Status | Description |
|---------|--------|--------|-------------|
| `/home` | Home | ✓ | Dashboard: quick-start commands |
| `/doctor` | Doctor | ✓ | Health check and interactive model picker |
| `/memory [namespace]` | Memory | ✓ | Browse, search, and delete stored facts |
| `/exec [plan.yaml]` | Exec | ✓ | Live execution dashboard with streaming |
| `/plan [spec]` | Plan | placeholder | Generate a phase plan and review it |
| `/swarm` | Swarm | placeholder | Configure and monitor a multi-agent swarm |
| `/agent` | Agent | placeholder | Single agent task runner with streaming |
| `/monitor` | Monitor | placeholder | Live agent activity feed |
| `/init` | Init | placeholder | Guided setup wizard |
| `/help` | Help | placeholder | Full keybinding reference |

### Exec screen

Live execution dashboard for phased plans. Navigate to it with a plan file path:

```
/exec path/to/plan.yaml
```

Or type `/exec` with no argument — the screen will prompt for the file path interactively.

```
Exec — plan.yaml                                          01:47 total

research → [design + spec] → implement → review

✓  research     analyst      00:42    phase-research.md
●  design       architect    01:05    Designing layered arch…
●  spec         analyst      01:05    Defining API contracts…
○  implement    coder        —
○  review       reviewer     —

─── design ─────────────────────────────
The system should adopt a layered architecture…

[↑↓] scroll  [ctrl+c] abort
```

Phase status icons:

| Icon | Meaning |
|------|---------|
| `○` | Waiting (dependency not yet satisfied) |
| `●` | Running (cyan) |
| `✓` | Done (green) |
| `✗` | Failed (red) |
| `⊘` | Skipped (output file already exists) |

Phases whose output files already exist are automatically skipped. The dependency graph
line (`research → [design + spec] → implement`) shows which phases run in parallel.

The streaming pane below the phase list shows the last 6 lines from whichever phase is
currently writing output.

| Key | Action |
|-----|--------|
| `↑` / `↓` | Scroll the phase list |
| `Escape` | Return to previous screen (only when done or errored — not mid-run) |
| `Ctrl+C` | Abort the TUI |

---

### Memory screen

Two-pane browser for the knowledge base stored in `.copilot-flow/memory.db`.

```
Namespaces: [project-x]  ·  session   42 entries

❯ auth-strategy         ★★★★★   Key        auth-strategy
  db-pool-size          ★★      Value      JWT 15-min expiry…
  api-rate-limit        ★★★     Type       decision
  cors-policy           ★★★     Importance ★★★★★
  token-store-impl      ★★★★    Tags       decision · architecture
                                Created    2026-04-18

[↑↓] navigate  [n/N] namespace  [/] search  [d] delete  [esc] back
```

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate entry list |
| `n` / `N` | Cycle namespace forward / backward |
| `/` | Enter search mode (BM25 ranked, 200 ms debounce) |
| `Enter` (in search) | Apply filter, return to navigation |
| `Escape` (in search) | Clear query, return to navigation |
| `d` | Delete selected entry (prompts for confirmation) |
| `y` (in delete prompt) | Confirm deletion |
| Any other key (in delete prompt) | Cancel deletion |
| `Escape` | Return to previous screen |

## Options

```
--screen <screen>    Open a specific screen on launch (default: home)
                     Valid values: home, init, plan, exec, swarm, agent,
                                   memory, monitor, doctor, help
```

## Requirements

- An interactive terminal (TTY). The TUI exits with an error if `stdin` or `stdout`
  is not a TTY (e.g., piped input/output). Use the individual CLI commands for
  non-interactive use.

## Running from the repo (without installing)

After building (`npm run build`), run directly from the dist output:

```bash
node dist/commands/index.js tui
```

Or, in development using `ts-node`:

```bash
npx ts-node --project tsconfig.json src/commands/index.ts tui
```

## See also

- [docs/future-improvements/tui.md](../future-improvements/tui.md) — full TUI design
  document: screen mockups, component architecture, implementation phasing
