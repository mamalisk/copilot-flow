# copilot-flow

Multi-agent orchestration framework for **GitHub Copilot CLI** — inspired by [Ruflo (claude-flow)](https://github.com/ruvnet/claude-flow).

copilot-flow brings the same multi-agent swarm patterns as Ruflo to the GitHub Copilot ecosystem, using the official [`@github/copilot-sdk`](https://github.com/github/copilot-sdk) to programmatically control the `copilot` CLI.

---

## Prerequisites

- **Node.js** >= 22.5
- **GitHub Copilot CLI** (`copilot`) installed and authenticated
- A GitHub account with Copilot access

```bash
# Install and authenticate Copilot CLI
# Follow instructions at https://github.com/github/copilot
copilot login
```

---

## Installation

```bash
npm install -g copilot-flow
# or run without installing:
npx copilot-flow <command>
```

---

## Quick Start

```bash
# 1. Initialise in your project
copilot-flow init

# 2. Run a single agent
copilot-flow agent spawn --type coder --task "Write a REST API endpoint for user registration" --stream

# 3. Run a multi-agent swarm
copilot-flow swarm start --task "Build a JWT authentication module" --stream

# 4. Spec-driven: read task from a file, write results to a file
copilot-flow agent spawn --spec requirements.md --output result.md
copilot-flow swarm start --spec requirements.md --output result.md --topology hierarchical

# 4. Check system health
copilot-flow doctor
```

---

## Commands

### `init`
Scaffold a `.copilot-flow/config.json` configuration file.

```bash
copilot-flow init
copilot-flow init --model gpt-4o --topology hierarchical --max-agents 6
```

### `agent`

```bash
# Spawn an agent for a task (auto-routes to best agent type)
copilot-flow agent spawn --task "Fix the authentication bug" --stream

# Specify the agent type explicitly
copilot-flow agent spawn --type security-auditor --task "Audit the auth module"

# Read task from a markdown file (spec-driven)
copilot-flow agent spawn --spec requirements.md --type coder

# Write result to a markdown file
copilot-flow agent spawn --spec requirements.md --output result.md

# With custom retry settings
copilot-flow agent spawn --type coder --task "..." \
  --max-retries 5 \
  --retry-delay 2000 \
  --retry-strategy exponential

# Disable retries entirely
copilot-flow agent spawn --type coder --task "..." --no-retry

# Override session timeout (default: 120 s — increase for large/complex tasks)
copilot-flow agent spawn --task "..." --timeout 300000   # 5 minutes
copilot-flow swarm start --spec big-task.md --timeout 600000  # 10 minutes

# Verbose mode: see session lifecycle, model, prompt size, and retry events
copilot-flow agent spawn --task "..." --verbose

# List agent states
copilot-flow agent list
copilot-flow agent types
```

### `swarm`

```bash
# Run a hierarchical swarm (researcher → coder → reviewer pipeline by default)
copilot-flow swarm start --task "Implement OAuth2 login flow" --stream

# Read task from a markdown file (spec-driven)
copilot-flow swarm start --spec requirements.md --topology hierarchical

# Write all agent results to a markdown file
copilot-flow swarm start --spec requirements.md --output results.md

# Chain phases: output of one run becomes the spec for the next
copilot-flow swarm start --spec spec.md         --output phase1.md --topology mesh
copilot-flow swarm start --spec phase1.md       --output phase2.md --topology sequential
copilot-flow swarm start --spec phase2.md       --output phase3.md --topology hierarchical

# Specify agent pipeline manually
copilot-flow swarm start --task "..." --agents researcher,coder,tester,reviewer

# Choose topology
copilot-flow swarm start --task "..." --topology mesh
copilot-flow swarm start --task "..." --topology sequential

# Configure swarm defaults
copilot-flow swarm init --topology hierarchical --max-agents 8
copilot-flow swarm status
```

### `memory`

```bash
copilot-flow memory store --namespace project --key architecture --value "microservices"
copilot-flow memory retrieve --namespace project --key architecture
copilot-flow memory search --namespace project --query "auth"
copilot-flow memory list --namespace project
copilot-flow memory delete --namespace project --key architecture
copilot-flow memory clear --namespace project

# With TTL (entry expires after 1 hour)
copilot-flow memory store --namespace project --key temp --value "..." --ttl 3600000
```

### `hooks`

```bash
copilot-flow hooks fire pre-task --data '{"task":"implement login"}'
copilot-flow hooks fire post-task --data '{"success":true}'
copilot-flow hooks pre-task
copilot-flow hooks post-task
copilot-flow hooks session-start
copilot-flow hooks session-end
copilot-flow hooks list
```

### `route`

```bash
# Find the best agent type for a task
copilot-flow route task --task "Fix a null pointer exception in authentication"
# → suggests: debugger

copilot-flow route list-agents
```

### `status` / `doctor`

```bash
copilot-flow status
copilot-flow doctor
```

---

## Retry System

Every command that makes Copilot API calls supports configurable retry with multiple backoff strategies:

| Flag | Default | Description |
|------|---------|-------------|
| `--max-retries <n>` | 3 | Maximum retry attempts |
| `--retry-delay <ms>` | 1000 | Initial delay before first retry |
| `--retry-strategy <type>` | `exponential` | `exponential` \| `linear` \| `constant` \| `fibonacci` |
| `--no-retry` | — | Disable retries entirely |

**Backoff strategies:**
- `exponential`: `delay = initialDelay × 2^(attempt-1)` — doubles each time
- `linear`: `delay = initialDelay × attempt` — grows linearly
- `constant`: `delay = initialDelay` — fixed interval
- `fibonacci`: `delay = initialDelay × fib(attempt)` — Fibonacci sequence

All strategies apply ±10% jitter by default to prevent thundering herd.

**Retried automatically:** network errors (`ECONNRESET`, `ETIMEDOUT`), rate limits (429), server errors (5xx), session crashes, timeouts.

**Not retried:** authentication errors (401), authorization errors (403), not found (404), validation errors.

---

## Agent Types

| Agent | Best For |
|-------|---------|
| `coder` | Implementation, refactoring |
| `researcher` | Investigation, information gathering |
| `tester` | Unit/integration tests, TDD |
| `reviewer` | Code review, quality analysis |
| `architect` | System design, architecture decisions |
| `coordinator` | Multi-agent workflow decomposition |
| `analyst` | Requirements, specifications |
| `debugger` | Bug diagnosis, root cause analysis |
| `documenter` | README, API docs, inline comments |
| `optimizer` | Performance, memory efficiency |
| `security-auditor` | Vulnerability scanning, OWASP |
| `performance-engineer` | Benchmarking, scalability |

If you don't specify `--type`, copilot-flow automatically routes based on keywords in your task description.

---

## Swarm Topologies

| Topology | Behaviour |
|----------|-----------|
| `hierarchical` | Independent tasks run in parallel; tasks with dependencies wait. Best for most workloads. |
| `mesh` | All tasks run concurrently with shared memory. Best for independent parallel work. |
| `sequential` | Tasks run one at a time in order. Best for strictly ordered pipelines. |

---

## Skills, Custom Agents & Repo Instructions

### Repo instructions (auto-loaded)

Place a `copilot-instructions.md` file anywhere (default: `.github/copilot-instructions.md`).
It is automatically injected into every session as repo-wide context — stack rules, coding
conventions, security constraints, etc.

```bash
# Auto-detected (no flag needed if file is at .github/copilot-instructions.md)
copilot-flow agent spawn --task "..."

# Explicit path
copilot-flow agent spawn --task "..." --instructions docs/rules.md

# Disable auto-detection
copilot-flow agent spawn --task "..." --no-instructions
```

### Skills (`SKILL.md`)

Skills teach the model domain knowledge scoped to a directory. Any `SKILL.md` file
found in the directories you point to is loaded into the session.

```bash
copilot-flow agent spawn --task "..." --skill-dir .github --skill-dir .copilot/skills
```

### Custom agents (`.md` files)

Define specialist agents as markdown files — **YAML frontmatter** for metadata,
**markdown body** for the system prompt.

```markdown
---
name: nextjs-expert
displayName: Next.js Expert
description: Specialist in Next.js 14 App Router and edge runtimes
tools:
  - read_file
  - write_file
  - run_command
---

You are a Next.js 14 expert specialising in the App Router, React Server Components,
and edge runtimes. You write idiomatic, performant Next.js code and follow the
official Next.js conventions for file-based routing, data fetching, and caching.
```

Place agent files in a directory (e.g. `.copilot/agents/`) and reference them:

```bash
copilot-flow agent spawn \
  --agent-dir .copilot/agents \
  --agent nextjs-expert \
  --task "Migrate pages/index.tsx to the App Router"
```

### Persisting defaults

Set directories once in `.copilot-flow/config.json` so you never need to repeat flags:

```json
{
  "instructions": { "file": ".github/copilot-instructions.md", "autoLoad": true },
  "skills":       { "directories": [".github", ".copilot/skills"], "disabled": [] },
  "agents":       { "directories": [".copilot/agents"] }
}
```

See [docs/custom-agents-example.md](docs/custom-agents-example.md) for a full worked example.

---

## Programmatic API

```typescript
import {
  runAgentTask,
  runSwarm,
  withRetry,
  RetryPredicates,
  getMemoryStore,
  globalHooks,
} from 'copilot-flow';

// Run a single agent
const result = await runAgentTask('coder', 'Write a binary search function', {
  retryConfig: {
    maxAttempts: 3,
    backoffStrategy: 'exponential',
    onRetry: (err, attempt) => console.log(`Retry ${attempt}: ${err.message}`),
  },
  onChunk: chunk => process.stdout.write(chunk),
});

// Run a swarm
const results = await runSwarm([
  { id: 'research', agentType: 'researcher', prompt: 'Research OAuth2 best practices' },
  { id: 'implement', agentType: 'coder', prompt: 'Implement OAuth2 login', dependsOn: ['research'] },
  { id: 'test', agentType: 'tester', prompt: 'Write tests for OAuth2 flow', dependsOn: ['implement'] },
], 'hierarchical');

// Use memory between runs
const mem = getMemoryStore();
mem.store('project', 'context', 'e-commerce platform with React + Node.js');

// Register hooks
globalHooks.on('post-task', async ctx => {
  console.log('Task completed:', ctx.data);
});

// Use retry directly
const result2 = await withRetry(
  () => fetch('https://api.example.com/data').then(r => r.json()),
  { maxAttempts: 5, backoffStrategy: 'fibonacci', retryOn: RetryPredicates.networkErrors }
);
```

---

## Configuration

`.copilot-flow/config.json`:

```json
{
  "version": "1.0.0",
  "defaultModel": "gpt-4o",
  "defaultTimeoutMs": 120000,
  "swarm": {
    "topology": "hierarchical",
    "maxAgents": 8
  },
  "memory": {
    "backend": "sqlite",
    "path": ".copilot-flow/memory.db"
  },
  "retry": {
    "maxAttempts": 3,
    "initialDelayMs": 1000,
    "maxDelayMs": 30000,
    "backoffStrategy": "exponential",
    "multiplier": 2,
    "jitter": true
  },
  "hooks": {
    "enabled": true,
    "timeoutMs": 5000
  }
}
```

Environment variable overrides:
```bash
GITHUB_TOKEN=ghp_...                 # GitHub token (bypasses keychain on managed Macs)
GH_TOKEN=$(gh auth token)           # Alternative: reuse the GitHub CLI token
COPILOT_FLOW_DEFAULT_MODEL=gpt-4o
COPILOT_FLOW_TIMEOUT_MS=300000      # Default session timeout in ms (default: 120000)
COPILOT_FLOW_MAX_RETRIES=3
COPILOT_FLOW_RETRY_DELAY_MS=1000
COPILOT_FLOW_LOG_LEVEL=info   # debug | info | warn | error | silent
```

---

## Attribution

> copilot-flow is inspired by **[Ruflo (claude-flow)](https://github.com/ruvnet/claude-flow)** — the multi-agent orchestration framework for Claude. copilot-flow brings the same swarm coordination patterns, memory system, hooks, and retry engine to the GitHub Copilot ecosystem using the official `@github/copilot-sdk`.

---

## License

MIT
