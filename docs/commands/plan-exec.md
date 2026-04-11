# `copilot-flow plan` & `copilot-flow exec`

Multi-phase pipelines where each phase feeds its output into the next.
Use this when a project is too large or complex for a single swarm.

---

## `plan`

Analyse a spec file and generate a `phases.yaml` execution plan.

```
copilot-flow plan <spec> [options]
```

An `analyst` agent reads the spec and produces a YAML file that breaks the work into
sequential phases — each either a single agent or a multi-agent swarm.

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-f, --file <path>` | `phases.yaml` | Output file for the generated plan |
| `--model <model>` | from config | Model override |

### Example

```bash
copilot-flow plan prd.md
copilot-flow plan prd.md -f my-project-plan.yaml
```

### Generated `phases.yaml` format

```yaml
version: "1"
spec: prd.md
phases:
  - id: research
    description: Investigate the domain, competitors, and technical constraints.
    type: agent
    agentType: researcher
    dependsOn: []

  - id: epics
    description: Break the PRD into epics and high-level user stories.
    type: agent
    agentType: analyst
    acceptanceCriteria: >
      Must produce at least 3 epics, each with a goal statement and
      at least 2 user stories in As a / I want / So that format.
    dependsOn: [research]

  - id: implement
    description: Implement the core features from the epics.
    type: swarm
    topology: hierarchical
    agents: [coder, coder, tester]
    dependsOn: [epics]

  - id: review
    description: Review the implementation for correctness and quality.
    type: agent
    agentType: reviewer
    dependsOn: [implement]
```

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

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--phase <id>` | — | Run only this phase (deps must have output files on disk) |
| `--force` | — | Re-run a phase even if its output file already exists |
| `--timeout <ms>` | from config | Session timeout per agent |
| `--max-acceptance-retries <n>` | `2` | Max re-runs on acceptance failure (3 total attempts) |
| `--stream` | — | Stream output as it arrives |

### Examples

```bash
# Run all phases in order
copilot-flow exec phases.yaml

# Stream output live
copilot-flow exec phases.yaml --stream

# Run only a specific phase
copilot-flow exec phases.yaml --phase implement

# Re-run a failed phase
copilot-flow exec phases.yaml --phase implement --force

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
