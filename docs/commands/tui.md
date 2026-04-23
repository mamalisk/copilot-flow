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
┌─ ⬡ copilot-flow ─────────────────────────── home  v2.11.0 ─┐
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
| `/plan [spec]` | Plan | ✓ | Generate a phase plan, then review and edit it in the Plan Studio |
| `/swarm` | Swarm | ✓ | Configure and monitor a multi-agent swarm |
| `/agent` | Agent | ✓ | Single agent task runner with streaming |
| `/monitor` | Monitor | ✓ | Live hook event feed with filtering and freeze |
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

### Swarm screen

Two-pane workflow: configure a swarm in the first view, then monitor live execution in the second.

**Configure sub-view** — opened when you navigate to `/swarm`:

```
Swarm — configure

Task      [Build the checkout flow with Stripe integration]
Topology  ❯ hierarchical   mesh   sequential
Agents    ✓ researcher   ✓ coder   ✓ tester   ○ reviewer   ○ architect   ○ analyst   ○ debugger

[tab/enter] next field  [esc] back
```

Navigate fields with `Tab` / `Enter`, then configure:

| Field | Control |
|-------|---------|
| Task | Type the shared prompt all agents will receive |
| Topology | `←` / `→` to cycle between `hierarchical`, `mesh`, `sequential` |
| Agents | `←` / `→` to move cursor, `Space` to toggle on/off |

Press `Enter` on the Agents field (with a task typed and at least one agent selected) to start.

Task graph built per topology:
- **hierarchical** — first agent (wave 1) → middle agents in parallel (wave 2) → last agent (wave 3)
- **mesh** — all agents run concurrently with no dependencies
- **sequential** — each agent depends on the previous, forming a linear chain

**Monitor sub-view** — auto-transitions when the swarm starts:

```
Swarm — hierarchical — Build the checkout flow…            02:11 total

Wave 1   ✓  [researcher]  swift-Darwin       00:38
─────────────────────────────────────────────────────────────────────
Wave 2   ●  [coder]       keen-Ada           01:33  Writing service…
         ●  [tester]      agile-Turing       01:33  Writing tests…
─────────────────────────────────────────────────────────────────────
Wave 3   ○  [reviewer]    —

─── keen-Ada ──────────────────────────────
The PaymentService extends BaseService…
```

Display varies by topology: hierarchical shows wave dividers, sequential shows `↓` between tasks, mesh shows a flat list.

| Icon | Meaning |
|------|---------|
| `○` | Waiting |
| `●` | Running (cyan) |
| `✓` | Done (green) |
| `✗` | Failed (red) |

| Key | Action |
|-----|--------|
| `Escape` | Return to previous screen (only when done or errored) |
| `Ctrl+C` | Abort the TUI |

---

### Plan screen

Two-stage workflow: the analyst agent generates a YAML phase plan from a spec file, then
the **Plan Studio** lets you review and edit phases before launching execution.

**Input sub-view** — opened when you navigate to `/plan` with no argument:

```
Plan — generate

Spec file  [prd.md▌]

[enter] start  [esc] back
```

Navigating to `/plan prd.md` skips directly to generation.

**Generating sub-view** — streams the analyst agent in real time:

```
Plan — generating prd.md                              00:23

●  analyst agent running…

─── streaming ──────────────────────────────
Breaking down requirements into phases…
Identified 5 phases across 3 dependency waves…

[ctrl+c] abort
```

Auto-transitions to the Plan Studio on completion.

**Plan Studio sub-view** — phase list with inline edit panel:

```
Plan Studio — prd.md  [5 phases]

  ❯ research        agent/researcher    Investigate the domain…
    design          swarm/hierarchical  Produce system architecture…
    spec            agent/analyst       Define API contracts…
    implement       agent/coder         Build the feature…
    review          agent/reviewer      Quality review…

── edit: research ──────────────────────────────────────
  Description  [Investigate the domain and gather requirements.▌]
  Type         ❯ agent   swarm
  Agent        …  architect  ❯ researcher  coder  …
  Model        [(default)]

[tab] next field  [←→] cycle  [esc] done editing
```

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate phase list |
| `Enter` | Edit the selected phase |
| `Tab` (in edit) | Cycle through editable fields |
| `←` / `→` (in edit) | Cycle selector values (Type, Agent, Topology) |
| `x` | Write plan to a temp file and open in the Exec screen |
| `s` | Save plan to `.copilot-flow/plans/{spec}-studio/phases.yaml` |
| `Escape` | Exit edit mode / return to previous screen |

Editable fields per phase:

| Field | Notes |
|-------|-------|
| Description | Free-text prompt for the phase |
| Type | `agent` (single specialist) or `swarm` (multi-agent) |
| Agent | Cycle through all 14 agent types (only for `agent` phases) |
| Topology | `hierarchical`, `mesh`, or `sequential` (only for `swarm` phases) |
| Model | Optional model override; leave blank to use the configured default |

---

### Agent screen

Single agent task runner with live streaming. Configure the task, agent type, and
optional model override, then watch the agent work in real time.

**Configure sub-view** — opened when you navigate to `/agent`:

```
Agent — configure

Task      [Implement the JWT refresh token service]
Agent     …   architect   ❯ coder   researcher   tester   …
Model     [(default)]

[tab/enter] next field  [esc] back
```

Navigate fields with `Tab` / `Enter`, then configure:

| Field | Control |
|-------|---------|
| Task | Type the prompt the agent will receive |
| Agent | `←` / `→` to cycle through all 14 agent types |
| Model | Type to override (leave blank for the agent registry default) |

Press `Enter` on the Model field (with a task typed) to start.

**Execution sub-view** — auto-transitions when the agent starts:

```
Agent — coder — keen-Ada                                  01:23

●  running…  I'll implement the JWT refresh token service…

─── streaming ──────────────────────────────
Considering the architecture of the refresh token service…
→ write_file: src/auth/token-store.ts

[ctrl+c] abort
```

**Post-completion actions:**

```
Agent — coder — keen-Ada                                  01:47

✓  complete

─── output ─────────────────────────────────
# JWT Refresh Token Service
…

[m] store in memory  [s] save to file  [esc] back
```

`[m]` prompts for a namespace and key, then stores the full output in the memory DB.
`[s]` prompts for a file path and writes the output to disk.

| Key | Action |
|-----|--------|
| `Escape` | Return to previous screen (only when done or errored) |
| `m` | Open memory store prompt (namespace → key) |
| `s` | Open file save prompt |
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

---

### Monitor screen

Append-only live event feed — shows every hook event fired by agents, swarms, and exec runs.
Open `/monitor` at any time; events accumulate as long as the screen is mounted.

```
Monitor — live event feed                           12 events

  09:42:01  swarm-start     ✓  hierarchical · 4 tasks
  09:42:01  agent-spawn        [coder]  keen-Ada
  09:42:01  pre-task           [coder]  keen-Ada
  09:42:01  session-start      [coder]  keen-Ada  (gpt-4o)
  09:42:39  session-end     ✓  [coder]  keen-Ada
  09:42:39  post-task       ✓  [coder]  keen-Ada  00:38
  09:42:39  agent-term      ✓  [coder]  keen-Ada
  09:43:01  swarm-end       ✓  4/4 succeeded

[a] all  [e] errors  [f] freeze  [↑↓] scroll  [esc] back
```

Events emitted by the framework:

| Event | Fired when |
|-------|-----------|
| `swarm-start` | `runSwarm()` begins |
| `swarm-end` | `runSwarm()` completes |
| `agent-spawn` | an agent task starts within a swarm |
| `agent-term` | an agent task finishes within a swarm |
| `pre-task` | `runAgentTask()` begins (any call site) |
| `post-task` | `runAgentTask()` completes — success or failure |
| `session-start` | a Copilot session is created |
| `session-end` | a Copilot session disconnects |

| Key | Action |
|-----|--------|
| `a` | Show all events |
| `e` | Show errors only (failed post-task / session-end) |
| `f` | Toggle freeze — pauses incoming events |
| `↑` / `↓` | Scroll history |
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
