# copilot-flow TUI — Ideation & Design

A unified terminal application that wraps every copilot-flow command in a rich interactive
UI, modelled on the Claude Code experience. Users navigate between screens using slash
commands typed into a persistent shell bar at the bottom of the screen.

---

## Overview

`copilot-flow tui` launches a full-screen terminal application. The main viewport renders
the active screen; a persistent input bar at the bottom accepts slash commands.

```
┌─ copilot-flow ──────────────────────────────────────────────── v2.11.0 ─┐
│                                                                           │
│  [active screen renders here]                                             │
│                                                                           │
│                                                                           │
│                                                                           │
│                                                                           │
│                                                                           │
│                                                                           │
│                                                                           │
│  ─────────────────────────────────────────────────────────────────────  │
│  > /plan prd.md_                                                          │
│  [tab] autocomplete  [↑] history  [ctrl+c] quit  [?] help                │
└───────────────────────────────────────────────────────────────────────────┘
```

### Navigation model

| Input | Action |
|-------|--------|
| `/command [args]` | Navigate to that screen |
| `Escape` or `/back` | Return to previous screen (breadcrumb stack) |
| `Tab` | Autocomplete screen names and file paths |
| `↑ ↓` in input | Command history (persisted to `.copilot-flow/tui-history`) |
| `Ctrl+C` | Exit (with confirmation if an agent is running) |
| `?` | Toggle help overlay |

### Available screens

`/home` · `/init` · `/plan` · `/exec` · `/swarm` · `/agent` · `/memory` · `/monitor` · `/doctor` · `/help`

---

## Technology stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| TUI framework | `ink` v7 | Published npm; no custom reconciler needed |
| React | `react` v19 | Concurrent features; matches Ink v7 peer |
| Ready-made widgets | `@inkjs/ui` v2 | Select, TextInput, ConfirmInput, Spinner, ProgressBar |
| CLI integration | existing `commander` | Screens delegate to the same underlying functions |
| TTY detection | `process.stdin.isTTY && process.stdout.isTTY` | Falls back to current plain-text CLI |

New dependencies:
```json
{
  "ink": "^7.0.0",
  "react": "^19.2.0",
  "@inkjs/ui": "^2.0.0",
  "@types/react": "^19.0.0"
}
```

---

## Application shell — `src/tui/`

```
src/tui/
├── app.tsx                     — Root <App>: screen router + shell bar
├── router.tsx                  — useReducer navigation stack + screen registry
├── shell.tsx                   — Bottom input bar: autocomplete + history
├── theme.ts                    — Colors, status icons, agent type → color map
├── hooks/
│   ├── useEventBridge.ts       — Subscribe to Node EventEmitter inside React
│   └── useWindowSize.ts        — Terminal dimensions (re-export from ink)
├── components/
│   ├── Panel.tsx               — Box with borderStyle="round" + title
│   ├── Badge.tsx               — Coloured agent type chip  [coder]
│   ├── HBar.tsx                — Unicode gradient bar (▓▒░) with label + pct
│   ├── StatusBar.tsx           — Bottom keybinding strip
│   ├── StreamPane.tsx          — Append-only sticky-scroll text pane
│   ├── PhaseGraph.tsx          — ASCII phase dependency line
│   ├── ImportanceStars.tsx     — ★★★☆☆ importance widget
│   └── Timer.tsx               — Live elapsed mm:ss counter
└── screens/
    ├── home.tsx
    ├── init.tsx
    ├── plan.tsx
    ├── exec.tsx
    ├── swarm.tsx
    ├── agent.tsx
    ├── memory.tsx
    ├── monitor.tsx
    ├── doctor.tsx
    └── help.tsx
```

### Router

```typescript
type Screen = 'home' | 'init' | 'plan' | 'exec' | 'swarm' | 'agent'
             | 'memory' | 'monitor' | 'doctor' | 'help'

type NavAction =
  | { type: 'push'; screen: Screen; args?: Record<string, unknown> }
  | { type: 'pop' }

// Navigation stack: push on navigate, pop on Escape / /back
```

### Shell input bar

- `TextInput` from `@inkjs/ui` in raw mode
- `/` prefix → parse as screen command, route via `dispatch({ type: 'push', screen })`
- `Tab` → complete screen names and common flags
- `↑ ↓` → cycle through in-memory history array (max 50 entries, persisted to `.copilot-flow/tui-history`)

### Selected shared components

#### `theme.ts`
```typescript
export const AGENT_COLORS: Record<AgentType, string> = {
  coder: 'blue',        researcher: 'cyan',    tester: 'green',
  reviewer: 'yellow',   architect: 'magenta',  coordinator: 'white',
  analyst: 'cyan',      debugger: 'red',       documenter: 'white',
  optimizer: 'green',   'security-auditor': 'red',
  'performance-engineer': 'yellow',
  orchestrator: 'magenta', 'product-manager': 'white',
}

export const STATUS_ICONS = {
  waiting: '○', running: '●', done: '✓', failed: '✗', skipped: '⊘',
}

export const IMPORTANCE_STARS = (n: number) =>
  '★'.repeat(n) + '☆'.repeat(5 - n)
```

#### `StreamPane.tsx`
Append-only sticky-scroll text pane. Chunks pushed via `useEffect` listening to an
`EventEmitter`. Ink v7's `overflow: 'scroll'` on `Box` handles viewport clipping.
Max 500 lines buffered; oldest lines dropped as new ones arrive.

#### `PhaseGraph.tsx`
Renders a single summary line from the phase dependency graph:
```
research → [design + spec] → implement → review
```
Brackets denote parallel waves. Computed via the same topological sort used in `exec.ts`.

#### `useEventBridge.ts`
```typescript
export function useEventBridge(
  emitter: EventEmitter,
  event: string,
  handler: (data: unknown) => void,
) {
  useEffect(() => {
    emitter.on(event, handler)
    return () => { emitter.off(event, handler) }
  }, [emitter, event, handler])
}
```

#### `Timer.tsx`
```typescript
export function Timer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 1_000)
    return () => clearInterval(id)
  }, [startedAt])
  const mm = String(Math.floor(elapsed / 60_000)).padStart(2, '0')
  const ss = String(Math.floor((elapsed % 60_000) / 1_000)).padStart(2, '0')
  return <Text dimColor>{mm}:{ss}</Text>
}
```

---

## Screen catalogue

---

### `/home` — Home dashboard

Default screen on launch. Merges `status` and `doctor` into a single at-a-glance view.

```
┌ copilot-flow — home ─────────────────────────────────────────── v2.11.0 ─┐
│                                                                            │
│  System                          Memory                                    │
│  ✓ copilot CLI        installed  project-x    42 entries                  │
│  ✓ authenticated      OK         session       7 entries                  │
│  ✓ initialised        yes                                                  │
│  Model: gpt-4o  ·  Topology: hierarchical  ·  Max agents: 8               │
│                                                                            │
│  Recent lessons                                                            │
│  - coder.md       3 lessons   last: 2026-04-18                            │
│  - _global.md     1 lesson    last: 2026-04-17                            │
│                                                                            │
│  Quick start                                                               │
│  /plan prd.md       Generate a phase plan from a spec                     │
│  /exec plan.yaml    Execute an existing plan                               │
│  /memory            Browse stored facts                                    │
│  /doctor            Full system health check                               │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
```

**Data sources**: `isInitialised()`, `loadConfig()`, `getMemoryStore().list()` per
namespace, lessons file mtimes, async doctor checks.

---

### `/init` — Init wizard

Step-by-step guided replacement for `copilot-flow init`. Uses `@inkjs/ui` Select.

```
┌ Init wizard ──────────────────────────────────────────────────────────────┐
│  Step 2 of 4 — Default model                                               │
│                                                                            │
│  Which model should agents use by default?                                 │
│                                                                            │
│  ❯ gpt-4o           (recommended — balanced speed and quality)            │
│    gpt-4o-mini      (fast and cheap, good for bulk phases)                │
│    o3-mini          (stronger reasoning, slower)                           │
│    claude-sonnet    (Claude via Copilot proxy)                             │
│                                                                            │
│  [↑↓] navigate  [enter] select  [esc] back                               │
└───────────────────────────────────────────────────────────────────────────┘
```

**Steps**:
1. Welcome + directory confirmation
2. Model select (populated from `doctor --verbose` model list)
3. Topology select (`hierarchical` | `sequential` | `mesh`)
4. Summary of files to be created → `ConfirmInput` → execute init logic
5. Created file list with ✓ ticks and edit hints

---

### `/plan [spec]` — Plan generation + Plan Studio

Two-phase screen. Phase A streams plan generation; auto-transitions to Phase B (Plan Studio)
when the analyst agent completes.

**Phase A — Generating**:
```
┌ Plan — prd.md ────────────────────────────────────────────────────────────┐
│  Analyst agent generating plan…  ●  00:23                                  │
│                                                                            │
│  Breaking down requirements into phases…                                   │
│  Identified 5 phases across 4 dependency waves                             │
│  Writing phases.yaml…                                                      │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
```

**Phase B — Plan Studio** (auto-transition on completion):
```
┌ Plan Studio — prd.md  [5 phases · 2 parallel waves] ─────────────────────┐
│                                                                            │
│  Wave 1   ○ research       researcher   Investigate domain…               │
│  Wave 2   ○ design         architect    Produce system design…            │
│           ○ spec           analyst      Define API contracts…  ← parallel │
│  Wave 3   ○ implement      coder        Build the feature…                │
│  Wave 4   ○ review         reviewer     Final quality review…             │
│                                                                            │
│ ┌ Edit: research ────────────────────────────────────────────────────────│
│ │ Description  [Investigate domain and constraints.          ]            │
│ │ Agent        researcher  ▼                                              │
│ │ Model        (default)   ▼       Retries  [2]                           │
│ │ Context tags (none — all memory facts injected)                         │
│ └────────────────────────────────────────────────────────────────────────┘│
│  [↑↓] select  [enter] edit  [tab] next field  [x] exec  [s] save  [esc]  │
└───────────────────────────────────────────────────────────────────────────┘
```

`[x]` transitions directly to `/exec` with the (possibly edited) `PlanPhase[]` passed
via router state — no file write needed unless `[s]` is pressed first.

**State**:
```typescript
const [stage, setStage] = useState<'generating' | 'studio'>('generating')
const [phases, setPhases] = useState<PlanPhase[]>([])
const [selected, setSelected] = useState(0)
const [editField, setEditField] = useState<keyof PlanPhase | null>(null)
const [dirty, setDirty] = useState(false)
```

---

### `/exec [plan.yaml]` — Live Execution Dashboard

Replaces scrolling text output with a structured live view of phase execution — the
highest-impact TUI surface given exec is the core command.

```
┌ Exec — my-project ────────────────────────────────────────── 01:47 total ─┐
│  research → [design + spec] → implement → review                           │
│                                                                            │
│  ✓ research      analyst       00:42   phase-research.md                  │
│  ● design        architect     01:05   Designing layered architecture…    │
│  ● spec          analyst       01:05   Defining auth API contracts…       │
│  ○ implement     coder         —       waiting for design + spec          │
│  ○ review        reviewer      —       waiting                             │
│                                                                            │
│ ┌ design — streaming ──────────────────────────────────────────────────── │
│ │ → read_file: prd.md                                                     │
│ │ The system should adopt a layered architecture with a clear separation  │
│ │ of concerns. The API gateway handles routing and rate limiting…         │
│ │ ▌                                                                       │
│ └─────────────────────────────────────────────────────────────────────── │
│  Acceptance: —    Memory: my-project (injecting facts)                    │
│  [↑↓] phase  [enter] expand  [m] memory  [f] force-rerun  [esc] back     │
└───────────────────────────────────────────────────────────────────────────┘
```

**Status icons**: `○` waiting · `●` running (animated) · `✓` done · `✗` failed · `⊘` skipped

**Acceptance criteria inline indicator** (appears when a check is running):
```
  [a] Checking acceptance (attempt 2/3)… — reviewer agent evaluating output
```

**`[m]`** opens a memory overlay showing facts injected for the selected phase's `contextTags`.

**`[f]`** marks the selected complete/skipped phase as pending and re-runs it (equivalent
to `exec --phase <id> --force`).

**Integration**: `exec.ts` is refactored to emit structured events on a shared
`EventEmitter` in addition to the existing `output.*` calls. The Exec screen subscribes
via `useEventBridge` hooks. Plain-text output path unchanged for non-TUI invocations.

**State**:
```typescript
type PhaseStatus = 'waiting' | 'running' | 'done' | 'failed' | 'skipped'

interface PhaseState {
  id: string
  agentType: string
  status: PhaseStatus
  startedAt?: number
  durationMs?: number
  outputFile?: string
  chunks: string[]
  acceptanceAttempt?: number
}

const [phases, setPhases] = useState<PhaseState[]>([])
const [selected, setSelected] = useState(0)
const [memVisible, setMemVisible] = useState(false)
```

---

### `/swarm` — Swarm config + Monitor

Two sub-views: configure topology and agents, then watch execution live.

**Sub-view A — Configure**:
```
┌ Swarm ────────────────────────────────────────────────────────────────────┐
│                                                                            │
│  Task     [Build the checkout flow with Stripe integration    ]           │
│  Topology  ❯ hierarchical   mesh   sequential                             │
│  Agents    ✓ coder   ✓ tester   ✓ reviewer   ○ researcher                │
│  Model     (default)    Timeout  120s                                     │
│                                                                            │
│  [enter] start  [esc] back                                                │
│                                                                            │
└───────────────────────────────────────────────────────────────────────────┘
```

**Sub-view B — Monitor** (auto-transition on start):
```
┌ Swarm — hierarchical — Build checkout flow ──────────────── 02:11 total ─┐
│                                                                            │
│  Wave 1   ✓  [researcher]  swift-Darwin       00:38                       │
│  ─────────────────────────────────────────────────────────────────────   │
│  Wave 2   ●  [coder]       keen-Ada           01:33  Writing service…    │
│           ●  [tester]      agile-Turing       01:33  Writing tests…      │
│  ─────────────────────────────────────────────────────────────────────   │
│  Wave 3   ○  [reviewer]    —                  waiting                     │
│                                                                            │
│ ┌ keen-Ada — coder ──────────────────────────────────────────────────────│
│ │ → write_file: src/payment/service.ts                                    │
│ │ The PaymentService extends BaseService and implements IPaymentGateway…  │
│ └─────────────────────────────────────────────────────────────────────── │
│                                                                            │
│  [↑↓] task  [enter] expand  [esc] back                                   │
└───────────────────────────────────────────────────────────────────────────┘
```

**Topology rendering differences**:
- **hierarchical** — horizontal wave dividers between dependency groups
- **mesh** — equal-width columns for all concurrent tasks; no dividers
- **sequential** — linear list with `→` connector between rows

**Integration**: `swarm start --tui` wires the `onProgress` callback in `runSwarm()`
to dispatch chunk events; tool-level events forwarded from `executor.ts` via `EventEmitter`.

---

### `/agent` — Single agent task runner

Streaming view for a single `agent spawn` invocation. Simpler than Swarm — one task,
one agent, one output.

```
┌ Agent — coder ─────────────────────────────────────────────── keen-Ada ─┐
│  Task: Implement the JWT refresh token service                            │
│  Model: gpt-4o  ·  Timeout: 120s  ·  Attempt 1/3                        │
│                                                                           │
│  ─── Thinking ────────────────────────────────────────────────────────  │
│  Considering the architecture of the refresh token service…               │
│                                                                           │
│  ─── Response ────────────────────────────────────────────────────────  │
│  I'll implement the JWT refresh token service with the following          │
│  approach:                                                                │
│                                                                           │
│  1. `TokenStore` — SQLite-backed store for refresh tokens with TTL        │
│  2. `RefreshService` — validates + rotates tokens                        │
│  → write_file: src/auth/token-store.ts                                   │
│  → write_file: src/auth/refresh-service.ts                               │
│  ▌                                                                        │
│                                                                           │
│  [esc] cancel  [s] save output  [m] store in memory                      │
└───────────────────────────────────────────────────────────────────────────┘
```

**`[m]`** after completion → quick form: namespace + key + auto-filled value (summary of
agent output) → calls `memory store` directly.

**`[s]`** prompts for a filename and writes `AgentResult.output` to disk.

---

### `/memory [namespace]` — Interactive Memory Browser

Two-pane explorer replacing the linear `memory list` / `memory search` output.

```
┌ Memory Browser ──────────────────────────────────────────────────────────┐
│  Namespaces:  project-x  ·  session  ·  research                         │
│                                                                           │
│  [/] search: auth_____________   Type: all ▼   42 entries                │
│                                                                           │
│ ┌ Entries ──────────────────────┐  ┌ Detail ──────────────────────────── │
│ │ > auth-strategy       ★★★★★  │  │ Key        auth-strategy             │
│ │   db-pool-size        ★★     │  │ Value      JWT 15-min expiry, no     │
│ │   api-rate-limit      ★★★    │  │            refresh tokens            │
│ │   cors-policy         ★★★    │  │ Type       decision                  │
│ │   cache-ttl           ★★     │  │ Importance ★★★★★                     │
│ │   token-store-impl    ★★★★   │  │ Tags       decision · architecture   │
│ │   refresh-rotation    ★★★    │  │ Created    2026-04-18                │
│ │                              │  │ Expires    never (permanent)         │
│ └──────────────────────────────┘  └──────────────────────────────────────│
│                                                                           │
│  [↑↓] navigate  [/] search  [n] namespace  [d] delete  [l] lint  [esc]   │
└───────────────────────────────────────────────────────────────────────────┘
```

**Search mode** (`[/]`): live `TextInput`; re-queries `store.search()` on each keystroke
with 200 ms debounce. Results ranked by BM25 score with importance tiebreaker.

**`[l]` lint flow**:
1. Spinner: "Analysing namespace…"
2. Diff view: deletions (red), merges (yellow), promotions (magenta)
3. `ConfirmInput` ("Apply changes? y/n")
4. Calls `lintMemory()` → refreshes entry list

**`[n]`** cycles through discovered namespaces (all SQLite namespaces with at least one
non-expired entry).

---

### `/monitor` — Agent Activity Feed

A live "tail -f" style event timeline aggregating hook events, agent lifecycle, tool
calls, and memory distillation across all concurrent operations.

```
┌ Monitor — live event feed ────────────────────────────────────────────────┐
│                                                                            │
│  09:42:01  swarm-start     hierarchical · 4 tasks                         │
│  09:42:01  agent-spawn     [coder]  keen-Ada                              │
│  09:42:01  pre-task        [coder]  keen-Ada — Build checkout flow        │
│  09:42:04  tool-start      [coder]  → read_file  src/payment/service.ts   │
│  09:42:04  tool-done    ✓  [coder]  ← read_file  (12ms)                  │
│  09:42:11  tool-start      [coder]  → write_file  src/payment/service.ts  │
│  09:42:38  post-task    ✓  [coder]  keen-Ada  00:37 · distilling…        │
│  09:42:40  memory       +  lesson appended → coder.md                     │
│  09:43:01  agent-spawn     [tester] agile-Turing                          │
│  09:43:01  pre-task        [tester] agile-Turing — Write integration tests│
│                                                                            │
│  Filters: [a]ll  [e]rrors only  [m]emory  [t]ools  [f] freeze/resume     │
└───────────────────────────────────────────────────────────────────────────┘
```

**Event colour map**:

| Event kind | Colour |
|------------|--------|
| `swarm-start` / `swarm-end` | cyan |
| `agent-spawn` / `agent-terminate` | blue |
| `pre-task` | green |
| `post-task ✓` | dim green |
| `tool-start` | yellow |
| `tool-done ✓` | dim yellow |
| `tool-done ✗` / any error | red |
| `memory` | magenta |

**Implementation notes**:
- Uses Ink's `Static` component for already-rendered rows (immutable; never re-renders)
  plus one live `Text` row at the bottom for the in-progress event.
- Max 500 rows buffered in state; oldest rows dropped as new ones arrive.
- `[f]` freezes the state snapshot — new events queue in a ref until resumed.
- Subscribes to `globalHooks.on(event, handler)` for the 8 hook events.
- Tool-level events (`tool-start`, `tool-done`) require a lightweight `EventEmitter`
  bridge added to `executor.ts` (emitting alongside the existing `output.dim()` calls).

---

### `/doctor` — System health + model picker

Enhanced health check with live model selection.

```
┌ Doctor ───────────────────────────────────────────────────────────────────┐
│                                                                            │
│  Health checks                                                             │
│  ✓  Node.js >= 22.5        v22.5.0                                       │
│  ✓  copilot CLI            v0.4.1                                         │
│  ✓  authenticated          OK                                             │
│  ✓  copilot-flow init      .copilot-flow/config.json found               │
│  ✓  node:sqlite            OK                                             │
│                                                                            │
│  All checks passed!                                                        │
│                                                                            │
│  Available models                                                          │
│  ❯ gpt-4o               GPT-4o              ← configured default         │
│    gpt-4o-mini          GPT-4o Mini                                       │
│    o3-mini              O3 Mini                                           │
│    claude-sonnet-4-5    Claude Sonnet 4.5                                 │
│                                                                            │
│  [enter] set as default  [esc] back                                       │
└───────────────────────────────────────────────────────────────────────────┘
```

Selecting a model and pressing `[enter]` calls `saveConfig({ defaultModel: selected })`
immediately — no CLI flags or file edits required.

---

## Commander.js integration

The existing CLI commands remain unchanged for non-TTY / pipe use. The TUI is purely
additive.

```typescript
// src/commands/tui.ts
program
  .command('tui')
  .description('Launch the interactive terminal UI')
  .option('--screen <screen>', 'Open a specific screen on launch', 'home')
  .option('--namespace <ns>', 'Pre-select a memory namespace')
  .action(async (opts) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      output.error('TUI requires an interactive terminal. Use individual commands for piped output.')
      process.exit(1)
    }
    const { waitUntilExit } = render(<App initialScreen={opts.screen} />)
    await waitUntilExit()
  })
```

Individual commands also gain a `--tui` shortcut flag:
- `copilot-flow exec plan.yaml --tui` → opens `/exec` screen with that plan pre-loaded
- `copilot-flow memory browse --namespace ns` → opens `/memory` screen for that namespace
- `copilot-flow swarm start --tui` → opens `/swarm` monitor directly

---

## Suggested file structure

| File | Purpose |
|------|---------|
| `src/tui/app.tsx` | Root component — screen router + shell bar |
| `src/tui/router.tsx` | `useReducer` navigation stack, screen registry |
| `src/tui/shell.tsx` | Bottom input bar with autocomplete + history |
| `src/tui/theme.ts` | Colors, icons, importance stars |
| `src/tui/hooks/useEventBridge.ts` | EventEmitter → React bridge |
| `src/tui/components/Panel.tsx` | Bordered panel with title |
| `src/tui/components/Badge.tsx` | Agent type coloured chip |
| `src/tui/components/HBar.tsx` | Gradient Unicode progress bar |
| `src/tui/components/StatusBar.tsx` | Bottom key hint strip |
| `src/tui/components/StreamPane.tsx` | Sticky-scroll text pane |
| `src/tui/components/PhaseGraph.tsx` | Phase dependency summary line |
| `src/tui/components/ImportanceStars.tsx` | ★★★☆☆ widget |
| `src/tui/components/Timer.tsx` | Live elapsed mm:ss |
| `src/tui/screens/home.tsx` | Home dashboard |
| `src/tui/screens/init.tsx` | Init wizard |
| `src/tui/screens/plan.tsx` | Plan generation + Plan Studio |
| `src/tui/screens/exec.tsx` | Live Execution Dashboard |
| `src/tui/screens/swarm.tsx` | Swarm config + Monitor |
| `src/tui/screens/agent.tsx` | Single agent runner |
| `src/tui/screens/memory.tsx` | Memory Browser |
| `src/tui/screens/monitor.tsx` | Activity Feed |
| `src/tui/screens/doctor.tsx` | Health check + model picker |
| `src/tui/screens/help.tsx` | Keybindings reference |
| `src/commands/tui.ts` | Commander entry point |

---

## Suggested implementation order

| Phase | Screens / components | Notes |
|-------|---------------------|-------|
| 1 | Foundation: `app`, `router`, `shell`, `theme`, shared components | No screens yet; just the shell renders |
| 2 | `/home`, `/doctor` | Static data; no async streams |
| 3 | `/memory` | Read-only first (list, search, detail); add delete + lint second |
| 4 | `/exec` | Wire EventEmitter bridge to `exec.ts`; phase state machine |
| 5 | `/swarm` | Extend bridge to `coordinator.ts`; add topology dividers |
| 6 | `/agent` | Simplest streaming screen |
| 7 | `/plan` | Generation → Plan Studio transition; edit forms |
| 8 | `/monitor` | Global hook listener; filter system |
| 9 | `/init` | Multi-step wizard; widest widget set — save until patterns are established |
