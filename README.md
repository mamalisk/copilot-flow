# copilot-flow

<p align="center">
  <img src="https://github.com/mamalisk/copilot-flow/raw/main/copilot-flow.png" alt="copilot-flow logo" width="480" />
</p>

<p align="center">
  <strong>Multi-agent orchestration for GitHub Copilot CLI</strong><br/>
  From idea to production — one command at a time.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/copilot-flow"><img src="https://img.shields.io/npm/v/copilot-flow" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/copilot-flow"><img src="https://img.shields.io/npm/dm/copilot-flow" alt="npm downloads" /></a>
  <img src="https://img.shields.io/node/v/copilot-flow" alt="node version" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license" />
</p>

---

copilot-flow lets you orchestrate **fleets of GitHub Copilot agents** that work together — researching, designing, coding, testing, and reviewing — so you can go from a product idea to working software faster than ever before.

Inspired by [Ruflo (claude-flow)](https://github.com/ruvnet/claude-flow), built on the official [`@github/copilot-sdk`](https://github.com/github/copilot-sdk).

---

## What can you build?

### From a napkin idea to a shipped product

Imagine you have an idea for **TripMind** — an AI travel planning SaaS. Here's how copilot-flow takes it from concept to code:

```bash
# Write your idea in a file
cat > tripmind-prd.md << 'EOF'
# TripMind
An AI-powered travel planning SaaS. Users describe their dream trip
in plain English and get a personalised itinerary, flight options,
hotel recommendations, and a packing list — all in one place.
Target: frequent travellers, aged 28–45, who hate spending hours
researching trips on multiple sites.
EOF

# Let an agent break it into epics and user stories
copilot-flow agent spawn \
  --spec tripmind-prd.md \
  --output tripmind-stories.md \
  --agent-dir .copilot/agents \
  --skill-dir .copilot/skills \
  --agent product-manager

# Then let a swarm research, design, and implement the first epic
copilot-flow swarm start \
  --spec tripmind-stories.md \
  --output tripmind-implementation.md \
  --topology hierarchical \
  --agents researcher,architect,coder,coder,tester,reviewer
```

Or run the whole journey as a phased pipeline:

```bash
copilot-flow plan tripmind-prd.md          # AI generates phases.yaml
copilot-flow exec phases.yaml --stream     # runs research → stories → implement → review
```

---

## More ideas you can build

### SaaS & B2B

**BuilderStack** — a no-code internal tool builder for ops teams
```bash
copilot-flow plan builderstack-prd.md
# generates: research → data-model → api → ui → tests phases
copilot-flow exec phases.yaml --phase research
copilot-flow exec phases.yaml --phase data-model
```

**CareSync** — patient coordination platform for private clinics
```bash
# Break down the appointment booking epic into stories
copilot-flow agent spawn \
  --agent product-manager \
  --agent-dir .copilot/agents \
  --skill-dir .copilot/skills \
  --task "Write user stories for the appointment booking epic in CareSync.
          Patients should be able to book, reschedule, and cancel appointments.
          Clinics should receive notifications and manage their calendar."

# Then implement
copilot-flow swarm start --spec booking-stories.md --agents coder,tester
```

**FleetOps** — vehicle fleet management for logistics companies
```bash
# Audit existing codebase for compliance and security
copilot-flow swarm start \
  --task "Audit the fleet tracking module for GDPR compliance and security vulnerabilities" \
  --topology mesh \
  --agents security-auditor,reviewer,documenter
```

---

## Granular everyday use

copilot-flow is just as useful for day-to-day tasks as it is for full product builds.

### Story → Code → Tests in one command
```bash
copilot-flow swarm start \
  --task "Implement user story: As a user, I want to reset my password via email,
          so that I can regain access to my account if I forget it.
          Stack: Next.js, Prisma, PostgreSQL, Resend for email." \
  --agents coder,tester \
  --topology sequential \
  --stream
```

### Write a PRD for a single feature
```bash
copilot-flow agent spawn \
  --agent product-manager \
  --agent-dir .copilot/agents \
  --skill-dir .copilot/skills \
  --task "Write a PRD for a CSV bulk-import feature for our user management screen.
          Admin users should be able to upload a CSV of up to 10 000 rows." \
  --output csv-import-prd.md
```

### Debug a production issue
```bash
copilot-flow agent spawn \
  --type debugger \
  --spec error-report.md \
  --output root-cause.md
```

### Refactor a module with tests
```bash
copilot-flow swarm start \
  --task "Refactor src/billing/ to use the new Stripe SDK v5. Keep all existing tests passing and add tests for the new retry logic." \
  --agents coder,tester,reviewer \
  --topology sequential
```

### Generate API documentation
```bash
copilot-flow agent spawn \
  --type documenter \
  --task "Generate OpenAPI 3.1 documentation for all routes in src/routes/" \
  --output openapi.yaml
```

### Greenfield project kickstart
```bash
echo "Build a REST API for a todo app: users, todos, tags, auth with JWT" > spec.md
copilot-flow plan spec.md
copilot-flow exec phases.yaml --stream
# Phase outputs: phase-research.md, phase-design.md, phase-implement.md, phase-review.md
```

---

## Prerequisites

- **Node.js** >= 22.5
- **GitHub Copilot CLI** (`copilot`) installed and authenticated
- A GitHub account with Copilot access

```bash
copilot-flow doctor   # checks everything for you
```

---

## Two ways to use copilot-flow

### 1. CLI — run commands directly

Install globally and orchestrate agents from your terminal:

```bash
npm install -g copilot-flow
# or without installing:
npx copilot-flow <command>
```

### 2. AI-first — let your AI assistant do the orchestrating

Copy `.copilot/agents/` and `.copilot/skills/` into your project (they're included in this repo).
Any AI assistant — **GitHub Copilot, Claude, Codex** — that loads the skill will use
`npx copilot-flow` to orchestrate tasks on your behalf. You describe the goal in plain English;
the AI picks the right strategy and runs the commands.

```bash
# The orchestrator agent receives any goal and figures out the right approach
copilot-flow agent spawn \
  --agent orchestrator \
  --agent-dir .copilot/agents \
  --skill-dir .copilot/skills \
  --task "Build the user authentication feature described in AUTH.md"
```

No need to know which agent type to use, which topology, or how many retries —
the orchestrator uses `copilot-flow route task` internally to make those decisions.

---

## Quick Start

```bash
# 1. Check your setup
copilot-flow doctor

# 2. Initialise in your project
copilot-flow init

# 3. Spawn a single agent
copilot-flow agent spawn --task "Explain the architecture of this codebase" --stream

# 4. Run a multi-agent swarm
copilot-flow swarm start --task "Implement a JWT auth middleware" --stream

# 5. Generate a phased plan and execute it
copilot-flow plan spec.md
copilot-flow exec phases.yaml --stream
```

---

## The Product Manager agent & skill

copilot-flow ships with a ready-to-use **product-manager agent** and a **copilot-flow skill**
in `.copilot/agents/` and `.copilot/skills/`.

Two agents and a skill are included in `.copilot/`:

**`orchestrator`** — the entry point for AI-first usage. Receives any goal, uses
`copilot-flow route task` to decide the right strategy (single agent / swarm / phased plan),
delegates entirely to specialist agents, and never does implementation work itself.

**`product-manager`** — turns a rough idea or PRD into structured epics, user stories, and
Given/When/Then acceptance criteria. Delegates research sub-tasks to a `researcher` agent
via `npx copilot-flow` automatically.

**The skill** (`SKILL.md`) teaches any AI assistant — GitHub Copilot, Claude, Codex — how to
use copilot-flow commands to orchestrate work. Load it via `--skill-dir` and the model knows
when to call `agent spawn`, `swarm start`, or `plan`/`exec`, and will always use
`copilot-flow route task` when uncertain which agent fits.

```bash
# Let the orchestrator figure out the best strategy for any goal
copilot-flow agent spawn \
  --agent orchestrator \
  --agent-dir .copilot/agents \
  --skill-dir .copilot/skills \
  --task "Build the notifications feature described in NOTIFICATIONS.md"

# Or use the product-manager directly for product planning
copilot-flow agent spawn \
  --agent product-manager \
  --agent-dir .copilot/agents \
  --skill-dir .copilot/skills \
  --spec your-idea.md \
  --output stories.md
```

---

## Command Reference

| Command | Description | Docs |
|---------|-------------|------|
| `agent spawn` | Run a single specialist agent | [→ docs/commands/agent.md](docs/commands/agent.md) |
| `swarm start` | Orchestrate multiple agents | [→ docs/commands/swarm.md](docs/commands/swarm.md) |
| `plan` / `exec` | Phased multi-swarm pipelines | [→ docs/commands/plan-exec.md](docs/commands/plan-exec.md) |
| `memory` | Persist context between runs | [→ docs/commands/memory.md](docs/commands/memory.md) |
| `doctor` / `init` / `status` | Setup and diagnostics | [→ docs/commands/doctor.md](docs/commands/doctor.md) |

---

## Skills, Custom Agents & Repo Instructions

### Repo instructions (auto-loaded)

Place a `copilot-instructions.md` file at `.github/copilot-instructions.md`.
It is automatically injected into every session — stack rules, coding conventions, constraints.

```bash
copilot-flow agent spawn --task "..."                     # auto-detected
copilot-flow agent spawn --task "..." --no-instructions   # disable
copilot-flow agent spawn --task "..." --instructions docs/rules.md  # explicit path
```

### Custom agent format

Agents are `.md` files — YAML frontmatter for metadata, markdown body for the system prompt:

```markdown
---
name: my-agent
displayName: My Agent
description: What this agent does
tools:
  - read_file
  - write_file
---

Your agent's system prompt goes here.
```

### Persisting defaults in config

```json
{
  "instructions": { "file": ".github/copilot-instructions.md", "autoLoad": true },
  "skills":       { "directories": [".copilot/skills", ".github"], "disabled": [] },
  "agents":       { "directories": [".copilot/agents"] }
}
```

See [docs/custom-agents-example.md](docs/custom-agents-example.md) for a full worked example.

---

## Model selection

By default copilot-flow lets the Copilot CLI choose the model, so you don't need to configure anything. If you want to pin a specific model, or you see a **"model X is not available"** error:

```bash
# Per-run override
copilot-flow agent spawn --task "..." --model claude-sonnet-4-5

# Permanent default via environment variable
export COPILOT_FLOW_DEFAULT_MODEL=claude-sonnet-4-5

# Permanent default via config file (.copilot-flow/config.json)
{ "defaultModel": "claude-sonnet-4-5" }
```

Which models are available depends on your GitHub Copilot plan. Common options include `claude-sonnet-4-5`, `gpt-4o`, `gpt-4o-mini`, and `o3-mini`. If a model name is rejected, try another or omit `--model` entirely to use your plan's default.

---

## Enterprise & managed Macs

If authentication fails with a macOS keychain prompt timing out:

```bash
export GH_TOKEN=$(gh auth token)        # reuse your GitHub CLI token
# or
export GITHUB_TOKEN=ghp_your_pat_here   # personal access token
```

Add to your shell profile to make it permanent. See [docs/commands/doctor.md](docs/commands/doctor.md).

---

## Retry System

Every agent call retries automatically on transient failures with configurable backoff:

| Flag | Default | Description |
|------|---------|-------------|
| `--max-retries <n>` | `3` | Maximum attempts |
| `--retry-delay <ms>` | `1000` | Initial delay |
| `--retry-strategy` | `exponential` | `exponential` \| `linear` \| `constant` \| `fibonacci` |
| `--no-retry` | — | Disable retries |

**Retried automatically:** network errors, rate limits (429), session crashes, timeouts.
**Never retried:** authentication errors, authorization errors, validation errors.

---

## Programmatic API

```typescript
import { runAgentTask, runSwarm, withRetry, getMemoryStore, globalHooks } from 'copilot-flow';

// Single agent
const result = await runAgentTask('coder', 'Write a binary search in TypeScript', {
  retryConfig: { maxAttempts: 3, backoffStrategy: 'exponential' },
  onChunk: chunk => process.stdout.write(chunk),
});

// Multi-agent swarm
const results = await runSwarm([
  { id: 'research', agentType: 'researcher', prompt: 'Research OAuth2 best practices' },
  { id: 'implement', agentType: 'coder', prompt: 'Implement OAuth2 login', dependsOn: ['research'] },
  { id: 'test', agentType: 'tester', prompt: 'Write tests for OAuth2', dependsOn: ['implement'] },
], 'hierarchical');

// Shared memory
const mem = getMemoryStore();
mem.store('project', 'stack', 'Next.js + Prisma + PostgreSQL');

// Hooks
globalHooks.on('post-task', async ctx => console.log('Task done:', ctx.data));
```

---

## Attribution

> copilot-flow is inspired by **[Ruflo (claude-flow)](https://github.com/ruvnet/claude-flow)** — the multi-agent orchestration framework for Claude. copilot-flow brings the same swarm coordination patterns to the GitHub Copilot ecosystem.

---

## License

MIT
