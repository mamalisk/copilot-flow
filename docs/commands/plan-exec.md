# `copilot-flow plan` & `copilot-flow exec`

← [Back to README](../../README.md)

Multi-phase pipelines where each phase feeds its output into the next.
Use this when a project is too large or complex for a single swarm.

---

## `plan`

Analyse a spec file and generate a phased execution plan (YAML).

```
copilot-flow plan <spec> [options]
```

An `analyst` agent reads the spec and produces a YAML file that breaks the work into
sequential phases — each either a single agent or a multi-agent swarm.

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-f, --file <path>` | `.copilot-flow/plans/{spec}-{timestamp}/phases.yaml` | Output file for the generated plan |
| `--model <model>` | from config | Model override for the planner agent |

### Output location

By default the plan is written to a timestamped folder inside `.copilot-flow/plans/` so that
multiple plans for the same spec don't overwrite each other:

```
.copilot-flow/plans/prd-2026-04-11T14-30-00/phases.yaml
```

When you run `exec` against this file, all phase output files are written to the same folder:

```
.copilot-flow/plans/prd-2026-04-11T14-30-00/phase-research.md
.copilot-flow/plans/prd-2026-04-11T14-30-00/phase-epics.md
.copilot-flow/plans/prd-2026-04-11T14-30-00/phase-implement.md
```

Use `-f` to control the location when you want to keep things tidy or re-use a specific plan file.

### Example

```bash
# Auto-named plan
copilot-flow plan prd.md

# Explicit path
copilot-flow plan prd.md -f .copilot-flow/plans/my-project/phases.yaml
```

### `phases.yaml` format

The example below has a parallel wave: `backend` and `frontend` both depend on `design`
but not on each other, so they run concurrently in the same wave.

```yaml
version: "1"
spec: prd.md
phases:
  - id: research
    description: Investigate the domain, competitors, and technical constraints.
    type: agent
    agentType: researcher
    # no dependsOn — runs first

  - id: design
    description: Produce system design and API contracts.
    type: agent
    agentType: architect
    dependsOn: [research]

  - id: backend
    description: Implement backend services from the design.
    type: swarm
    topology: hierarchical
    agents: [coder, tester]
    model: gpt-4o-mini    # optional: cheaper model for bulk code generation
    dependsOn: [design]

  - id: frontend
    description: Implement the frontend from the design.
    type: agent
    agentType: coder
    dependsOn: [design]   # depends on design, NOT on backend → runs in parallel with backend

  - id: review
    description: Review the full implementation for correctness and quality.
    type: agent
    agentType: reviewer
    model: o1             # optional: stronger model for validation
    dependsOn: [backend, frontend]
    acceptanceCriteria: >
      The backend and frontend must be consistent with the API contracts
      defined in the design phase.
    maxAcceptanceRetries: 2
```

### Phase fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✓ | Unique kebab-case identifier, used as default output filename |
| `description` | ✓ | What this phase should produce |
| `type` | ✓ | `agent` (single specialist) or `swarm` (multi-agent pipeline) |
| `agentType` | agent phases | One of the 12 built-in agent types |
| `topology` | swarm phases | `hierarchical` \| `sequential` \| `mesh` |
| `agents` | swarm phases | List of agent types forming the pipeline |
| `model` | — | Per-phase model override (see model resolution below) |
| `output` | — | Output filename (default: `phase-{id}.md`, in the plan folder) |
| `dependsOn` | — | List of phase IDs that must complete first |
| `acceptanceCriteria` | — | Natural-language pass/fail criteria evaluated by a reviewer agent |
| `maxAcceptanceRetries` | — | Max re-runs on acceptance failure (default: 2, so 3 total attempts) |

---

## `exec`

Execute a phased plan — all phases in order, or a specific phase.

```
copilot-flow exec <plan> [options]
```

### How context flows

Each phase's prompt automatically includes:
1. The **original spec file** (`spec:` in the YAML)
2. The **output of every dependency phase** (read from disk)

So context accumulates through the pipeline without manual copy-paste.

### Parallel execution

When multiple phases share a common dependency but not each other, copilot-flow runs
them in the same "wave" using `Promise.all()` — the same model used inside the
`hierarchical` swarm topology.

```
Phase: research
Phase: design
Parallel phases: backend + frontend   ← both depend on design, not on each other
  Running 2 phases concurrently
Phase: review
```

With `--stream` and parallel phases, each chunk is prefixed with `[phase-id]` so
outputs from concurrent phases remain distinguishable in the terminal:

```
[backend] Implementing the user service…
[frontend] Creating the login component…
[backend] Adding authentication middleware…
```

To force two phases to run serially, add an explicit `dependsOn` between them in the YAML.

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--phase <id>` | — | Run only this phase (deps must have output files on disk) |
| `--force` | — | Re-run a phase even if its output file already exists |
| `--model <model>` | from config | Global model override for all agents in this run |
| `--timeout <ms>` | from config | Session timeout per agent |
| `--max-acceptance-retries <n>` | `2` | Max re-runs on acceptance failure (3 total attempts) |
| `--stream` | — | Stream output as it arrives |

### Model resolution

Each agent in each phase resolves its model with this precedence (first match wins):

```
CLI --model  >  phase.model  >  config.agents.models[agentType]  >  config.defaultModel
```

This lets you pin your reviewer to a stronger model in `config.json` without touching
the YAML, or set a one-off override in the YAML itself for a specific phase.

### Examples

```bash
# Run all phases in order
copilot-flow exec .copilot-flow/plans/prd-2026-04-11T14-30-00/phases.yaml

# Stream output live
copilot-flow exec phases.yaml --stream

# Run only a specific phase
copilot-flow exec phases.yaml --phase implement

# Re-run a failed phase
copilot-flow exec phases.yaml --phase implement --force

# Force a specific model for the whole run (overrides per-phase model)
copilot-flow exec phases.yaml --model gpt-4o-mini

# Increase retries for acceptance checks
copilot-flow exec phases.yaml --max-acceptance-retries 3
```

### Resuming after failure

If a phase fails or you stop mid-run, simply run `exec` again.
Phases whose output files already exist are skipped automatically.
Only the failed (and subsequent) phases will re-run.

```bash
# Phase "implement" failed. Fix the spec and re-run from there:
copilot-flow exec phases.yaml --phase implement --force
```

### Acceptance criteria

Add `acceptanceCriteria` to any phase in the YAML. After the phase runs, a reviewer
agent evaluates the output and returns PASS or FAIL. On FAIL, the phase is retried.

The reviewer uses its own model — either `phase.model`, `config.agents.models.reviewer`,
or `config.defaultModel`, in that priority order.

```yaml
- id: stories
  description: Write user stories for the authentication epic.
  type: agent
  agentType: analyst
  acceptanceCriteria: >
    Each story must follow As a / I want / So that format and include
    at least 2 Given/When/Then acceptance criteria.
  maxAcceptanceRetries: 2
  dependsOn: [research]
```
