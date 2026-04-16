# `copilot-flow swarm`

← [Back to README](../../README.md)

Orchestrate multiple agents working together on a shared task.

---

## `swarm start`

```
copilot-flow swarm start [options]
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--task <text>` | — | High-level task (inline) |
| `--spec <file>` | — | Read task from a file |
| `--output <file>` | — | Write all results to a markdown file |
| `--topology <type>` | from config | `hierarchical` \| `sequential` \| `mesh` |
| `--agents <list>` | pipeline default | Comma-separated agent types |
| `--model <model>` | from config | Model override for all agents in this swarm |
| `--timeout <ms>` | from config | Session timeout per agent |
| `--max-retries <n>` | `3` | Max retries per agent |
| `--retry-delay <ms>` | `1000` | Initial retry delay |
| `--retry-strategy` | `exponential` | Backoff strategy |
| `--stream` | — | Stream agent output as it arrives |
| `--instructions <file>` | auto-detected | Inject repo instructions |
| `--no-instructions` | — | Disable auto-detection |
| `--skill-dir <path>` | `.github/skills` | Extra directory to scan for `SKILL.md` files (repeatable; adds to default) |
| `--disable-skill <name>` | — | Disable a skill (repeatable) |
| `--agent-dir <path>` | `.github/agents` | Extra directory of `*.md` custom agent definitions (repeatable; adds to default) |
| `--agent <name>` | — | Activate a custom agent for every session in the swarm |
| `--memory-namespace <ns>` | — | Enable cross-run memory: distil each task's output and inject prior context |

### Model resolution

Each agent in the swarm resolves its model independently:

```
CLI --model  >  config.agents.models[agentType]  >  config.defaultModel  >  SDK default
```

This means you can give your reviewer a stronger model than your coder without changing the
CLI invocation — just configure it once in `.copilot-flow/config.json`:

```json
{
  "agents": {
    "models": {
      "reviewer": "o1-mini"
    }
  }
}
```

Use `--model` to force all agents to the same model for a quick test run.

### Cross-run memory

Pass `--memory-namespace <name>` to persist distilled knowledge across swarm runs.
Each task's output is summarised into up to 10 compact facts and stored in the SQLite
memory store (30-day TTL). On subsequent runs, those facts are injected into every task
prompt as a `## Remembered context` section.

```bash
# First run — seeds memory
copilot-flow swarm start --spec spec.md --memory-namespace my-project

# Second run — all agents start with remembered context
copilot-flow swarm start --spec spec.md --memory-namespace my-project
```

See [plan-exec.md — Cross-run memory](plan-exec.md#cross-run-memory) for details on the
distillation prompt and `.github/memory-prompt.md` customisation.

### Topologies

| Topology | Behaviour | Best for |
|----------|-----------|---------|
| `hierarchical` | Tasks with `dependsOn` wait for dependencies; independent tasks run in parallel | Most workloads |
| `sequential` | Agents run one at a time in order, each receiving the previous output | Strictly ordered pipelines |
| `mesh` | All agents run concurrently with shared memory | Independent parallel analysis |

### Automatic coordinator orchestration

When `--agents` contains **duplicate agent types**, running them with the same prompt
causes every agent to attempt the full task independently — colliding on file writes and
duplicating effort. copilot-flow solves this automatically using a `coordinator` agent.

**Explicit coordinator** — place `coordinator` immediately before the duplicate group:

```bash
copilot-flow swarm start \
  --spec spec.md \
  --topology hierarchical \
  --agents researcher,coordinator,coder,coder,coder,reviewer
```

Execution waves:

```
researcher          ← analyses the problem
coordinator         ← decomposes into 3 distinct coder subtasks
coder + coder + coder  ← run in parallel, each on its own subtask
reviewer            ← receives all 3 outputs and reviews the whole
```

The coordinator is prompted to produce a numbered plan (`Subtask 1:`, `Subtask 2:`,
`Subtask 3:`). Each coder receives the coordinator's output as context and executes only
its assigned subtask — no collisions, no duplicated work.

**Implicit coordinator** — omit `coordinator` and copilot-flow injects one automatically:

```bash
copilot-flow swarm start \
  --task "Analyse three design patterns: Factory, Observer, and Strategy" \
  --topology hierarchical \
  --agents researcher,researcher,researcher
```

A coordinator is silently added before the three researchers. It decomposes the task
into three subtasks (one pattern per researcher), then all three run in parallel.

**Downstream agents** — any agent listed after the parallel group (e.g. a `reviewer`)
automatically depends on all parallel agents and receives all of their outputs as context:

```bash
--agents coordinator,coder,coder,coder,reviewer
#  wave 1: coordinator
#  wave 2: coder #1, coder #2, coder #3  (parallel)
#  wave 3: reviewer  (sees all three coder outputs)
```

**Mesh + orchestration** — `mesh` topology ignores `dependsOn`, so the coordinator
cannot run before the agents it coordinates. If your pipeline requires orchestration
(i.e. any `dependsOn` relationship is present), copilot-flow automatically switches to
`hierarchical` and emits a warning:

```
⚠ Coordinator orchestration requires ordered execution — overriding mesh to hierarchical.
```

Use `mesh` only for genuinely independent agents (no coordinator, no shared state).

### Examples

```bash
# Research → implement → test → review pipeline
copilot-flow swarm start \
  --spec feature-brief.md \
  --output implementation.md \
  --topology hierarchical \
  --agents researcher,coder,tester,reviewer \
  --stream

# Parallel analysis: run multiple agents simultaneously
copilot-flow swarm start \
  --task "Audit this codebase for security, performance, and accessibility issues" \
  --topology mesh \
  --agents security-auditor,performance-engineer,reviewer

# Force a specific model for this run
copilot-flow swarm start \
  --spec feature-brief.md \
  --agents researcher,coder,reviewer \
  --model gpt-4o

# Parallel implementation with automatic coordinator orchestration
copilot-flow swarm start \
  --spec feature-brief.md \
  --topology hierarchical \
  --agents researcher,coordinator,coder,coder,coder,reviewer \
  --stream

# Parallel research (coordinator auto-injected for duplicate researchers)
copilot-flow swarm start \
  --task "Analyse three design patterns: Factory, Observer, and Strategy" \
  --topology hierarchical \
  --agents researcher,researcher,researcher

# Chain swarm phases using --spec / --output
copilot-flow swarm start --spec prd.md          --output phase1-epics.md
copilot-flow swarm start --spec phase1-epics.md --output phase2-stories.md
copilot-flow swarm start --spec phase2-stories.md --output phase3-code.md

# With custom agent and domain skill
copilot-flow swarm start \
  --spec brief.md \
  --agents analyst,coder,tester \
  --agent-dir .copilot/agents \
  --skill-dir .copilot/skills \
  --agent product-manager
```

---

## `swarm init`

Configure swarm defaults saved to `.copilot-flow/config.json`.

```bash
copilot-flow swarm init --topology hierarchical --max-agents 8
```

## `swarm status`

Show the current swarm configuration.

```bash
copilot-flow swarm status
```
