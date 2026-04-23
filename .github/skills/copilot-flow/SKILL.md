---
name: copilot-flow
description: >
  How to use the copilot-flow multi-agent orchestration framework —
  commands, memory system, phase YAML format, and adaptive learning.
---

# copilot-flow skill

## Core commands

### Plan & execute a phased pipeline
```bash
# 1. Generate a phase plan from a spec file
copilot-flow plan prd.md

# 2. Execute the plan (phases run in dependency order; independent phases run in parallel)
copilot-flow exec .copilot-flow/plans/prd-<timestamp>/phases.yaml \
  --memory-namespace my-project
```

### Run a single agent task
```bash
copilot-flow agent spawn --type coder --task "Implement user auth with JWT"
copilot-flow agent spawn --type researcher --task "Survey competing auth libraries"
```

### Run a swarm (multi-agent, single task)
```bash
copilot-flow swarm run --task "Build the checkout flow" \
  --topology hierarchical --agents coder,tester,reviewer
```

---

## phases.yaml format

```yaml
version: "1"
spec: prd.md
phases:
  - id: research
    type: agent
    agentType: researcher
    description: Investigate domain and constraints.

  - id: design
    type: agent
    agentType: architect
    description: Produce system design and API contracts.
    dependsOn: [research]

  - id: implement
    type: swarm
    topology: hierarchical
    agents: [coder, tester]
    description: Implement and test the feature.
    dependsOn: [design]
    acceptanceCriteria: >
      All public functions have tests; no TypeScript errors.
    maxAcceptanceRetries: 2
    contextTags: [code, architecture]   # only these memory tags injected

  - id: review
    type: agent
    agentType: reviewer
    description: Final quality and security review.
    dependsOn: [implement]
    model: gpt-4o                       # per-phase model override
```

### Key phase fields
| Field | Description |
|-------|-------------|
| `type` | `agent` (single specialist) or `swarm` (multi-agent) |
| `agentType` | Built-in type: coder, researcher, tester, reviewer, architect, coordinator, analyst, debugger, documenter, optimizer, security-auditor, performance-engineer, orchestrator, product-manager |
| `topology` | `hierarchical` \| `sequential` \| `mesh` (swarm phases only) |
| `dependsOn` | Phase IDs that must complete first; omit to run in the first wave |
| `acceptanceCriteria` | Natural-language pass/fail criteria; triggers re-runs on failure |
| `maxAcceptanceRetries` | Extra attempts on acceptance failure (default 2) |
| `contextTags` | Filter memory injection to specific tags (reduces context noise) |
| `model` | Per-phase model override |

---

## Memory system

### Store a fact or decision
```bash
copilot-flow memory store \
  --namespace my-project \
  --key auth-strategy \
  --value "JWT 15-min expiry, no refresh tokens" \
  --type decision \
  --importance 5 \
  --ttl 2592000000    # 30 days in ms (omit for permanent)
```

**Memory types**: `fact` (default) | `decision` | `context` | `workflow-state` (never injected into prompts)

**Importance scale**: 5 = critical · 4 = important · 3 = notable · 2 = minor · 1 = trivial

**Tags** (for contextTags filtering): `decision` | `constraint` | `requirement` | `architecture` | `code` | `api` | `config`

### Retrieve / search
```bash
copilot-flow memory retrieve --namespace my-project --key auth-strategy
copilot-flow memory search  --namespace my-project --query "authentication"
copilot-flow memory list    --namespace my-project --type decision
```

### Consolidate with lint
```bash
copilot-flow memory lint --namespace my-project --dry-run   # preview
copilot-flow memory lint --namespace my-project             # apply
```
Lint deduplicates facts, merges related entries, and promotes critical lessons to `.github/lessons/_global.md`.

---

## Adaptive learning — two-track persistence

| Store | Lifetime | Contents |
|-------|----------|----------|
| `.copilot-flow/memory.db` (SQLite) | 30-day TTL (default) | Distilled facts, decisions, context |
| `.github/lessons/<agentType>.md` | Permanent (git-tracked) | Patterns, pitfalls, recovery lessons |

Facts distilled from successful runs are stored in SQLite. When the distillation model flags a fact as a lesson (importance 4–5, `"lesson": true`), it is also appended permanently to the agent's lesson file.

Acceptance failures and exhausted retries are also written to lesson files automatically.

### Prompt injection order (when --memory-namespace is active)
```
## Project identity      ← .github/memory-identity.md (static brief)
## Lessons learned       ← .github/lessons/<agentType>.md + _global.md
## Remembered context    ← SQLite facts (importance-ranked, tag-filtered)
```

---

## Initialise a new project
```bash
copilot-flow init
```
Creates: `.copilot-flow/config.json`, `.github/memory-identity.md`, `.github/agents/<type>.md` (14 agent prompts), `.github/lessons/<type>.md` (14 lesson files + `_global.md`), `.github/skills/copilot-flow/SKILL.md`.

Edit `.github/memory-identity.md` to describe your project — it is injected into every agent prompt.
Edit any `.github/agents/<type>.md` to customise a specific agent's system prompt without rebuilding.
