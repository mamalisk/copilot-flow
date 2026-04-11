# `copilot-flow agent`

← [Back to README](../../README.md)

Run a single specialist agent against a task.

---

## `agent spawn`

```
copilot-flow agent spawn [options]
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--task <text>` | — | Task description (inline) |
| `--spec <file>` | — | Read task from a file (alternative to `--task`) |
| `--output <file>` | — | Write result to a markdown file |
| `--type <type>` | auto-routed | Agent type (see table below) |
| `--model <model>` | from config | Override the model for this run |
| `--timeout <ms>` | from config | Session timeout (default 120 000) |
| `--max-retries <n>` | `3` | Max retry attempts |
| `--retry-delay <ms>` | `1000` | Initial retry delay |
| `--retry-strategy` | `exponential` | `exponential` \| `linear` \| `constant` \| `fibonacci` |
| `--no-retry` | — | Disable retries |
| `--stream` | — | Stream output token-by-token |
| `--verbose` | — | Print session lifecycle, model, turn-by-turn progress |
| `--instructions <file>` | auto-detected | Inject a repo instructions file |
| `--no-instructions` | — | Disable auto-detection of `copilot-instructions.md` |
| `--skill-dir <path>` | — | Directory to scan for `SKILL.md` (repeatable) |
| `--disable-skill <name>` | — | Disable a specific skill by name (repeatable) |
| `--agent-dir <path>` | — | Directory of `*.md` custom agent definitions (repeatable) |
| `--agent <name>` | — | Name of custom agent to activate |

### Model resolution

The model used for a run is resolved in this order (first match wins):

```
CLI --model  >  config.agents.models[agentType]  >  config.defaultModel  >  SDK default
```

To give a specific agent type its own default model without passing `--model` every time,
set it in `.copilot-flow/config.json`:

```json
{
  "agents": {
    "models": {
      "reviewer":         "o1-mini",
      "security-auditor": "o1"
    }
  }
}
```

### Agent types

| Type | Best for |
|------|---------|
| `coder` | Implementation, refactoring |
| `researcher` | Investigation, information gathering |
| `tester` | Unit/integration tests, TDD |
| `reviewer` | Code review, quality analysis |
| `architect` | System design, architecture decisions |
| `coordinator` | Workflow decomposition |
| `analyst` | Requirements, specifications, PRDs |
| `debugger` | Bug diagnosis, root cause analysis |
| `documenter` | README, API docs, inline comments |
| `optimizer` | Performance, memory efficiency |
| `security-auditor` | Vulnerability scanning, OWASP |
| `performance-engineer` | Benchmarking, scalability |

If `--type` is omitted, the task description is analysed for keywords and the best agent type is selected automatically (`copilot-flow route task --task "..."` does this explicitly).

### Progress output

Even without `--stream`, the agent prints what it is doing in real time:

```
  [reviewer] Turn 1
  [reviewer] Reading the implementation files
  [reviewer] → read_file
  [reviewer] → run_terminal_cmd
  [reviewer] Turn 2
  [reviewer] Compiling review notes
```

Use `--verbose` for full session debug info (model chosen, prompt size, retry details).

### Examples

```bash
# Simple inline task
copilot-flow agent spawn --task "Write a debounce utility in TypeScript" --stream

# Read task from a file, write result to a file
copilot-flow agent spawn --spec prd.md --output epics.md --type analyst

# Use a custom product-manager agent with domain skill
copilot-flow agent spawn \
  --spec brief.md \
  --output stories.md \
  --agent-dir .copilot/agents \
  --skill-dir .copilot/skills \
  --agent product-manager

# Override model for this run
copilot-flow agent spawn --task "Review for security issues" --type security-auditor --model o1

# Debug mode: see session lifecycle and prompt size
copilot-flow agent spawn --task "..." --verbose

# Long-running task — increase timeout to 10 minutes
copilot-flow agent spawn --spec large-codebase-task.md --timeout 600000
```

---

## `agent list`

List persisted agent state files.

```bash
copilot-flow agent list
```

## `agent types`

Print all available agent types and their descriptions.

```bash
copilot-flow agent types
```
