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
| `--skill-dir <path>` | — | Scan for `SKILL.md` files (repeatable) |
| `--disable-skill <name>` | — | Disable a skill (repeatable) |
| `--agent-dir <path>` | — | Directory of custom agent definitions (repeatable) |
| `--agent <name>` | — | Activate a custom agent for every session in the swarm |

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

### Topologies

| Topology | Behaviour | Best for |
|----------|-----------|---------|
| `hierarchical` | Tasks with `dependsOn` wait for dependencies; independent tasks run in parallel | Most workloads |
| `sequential` | Agents run one at a time in order, each receiving the previous output | Strictly ordered pipelines |
| `mesh` | All agents run concurrently with shared memory | Independent parallel analysis |

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
