# `copilot-flow agent`

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
| `--model <model>` | from config | Override the model |
| `--timeout <ms>` | from config | Session timeout (default 120 000) |
| `--max-retries <n>` | `3` | Max retry attempts |
| `--retry-delay <ms>` | `1000` | Initial retry delay |
| `--retry-strategy` | `exponential` | `exponential` \| `linear` \| `constant` \| `fibonacci` |
| `--no-retry` | — | Disable retries |
| `--stream` | — | Stream output token-by-token |
| `--verbose` | — | Print session lifecycle debug info |
| `--instructions <file>` | auto-detected | Inject a repo instructions file |
| `--no-instructions` | — | Disable auto-detection of `copilot-instructions.md` |
| `--skill-dir <path>` | — | Directory to scan for `SKILL.md` (repeatable) |
| `--disable-skill <name>` | — | Disable a specific skill by name (repeatable) |
| `--agent-dir <path>` | — | Directory of `*.md` custom agent definitions (repeatable) |
| `--agent <name>` | — | Name of custom agent to activate |

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

If `--type` is omitted, the task description is analysed for keywords and the best agent type is selected automatically.

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
