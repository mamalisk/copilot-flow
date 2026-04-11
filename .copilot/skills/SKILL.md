# copilot-flow — AI Assistant Skill

You have access to `copilot-flow`, a multi-agent orchestration CLI for GitHub Copilot.
When you need to research, plan, implement, test, review, or document — use `npx copilot-flow`
to delegate to the right specialist agent rather than doing everything yourself.

---

## When to use copilot-flow

Use copilot-flow whenever a task would benefit from:
- A **specialist agent** (e.g. a security auditor, a product analyst, a test engineer)
- **Multiple agents in sequence** (research → design → implement → review)
- **Long-running work** that should run independently with retries
- **Persisting context** across multiple work sessions

---

## Routing — when you're unsure which agent to use

If you are unsure which agent type best fits a task, always run:

```bash
npx copilot-flow route task --task "<your task description>"
```

This analyses the task description and recommends the best agent type.

```bash
# Examples
npx copilot-flow route task --task "Fix the null pointer in the auth middleware"
# → suggests: debugger

npx copilot-flow route task --task "Write user stories for the notifications feature"
# → suggests: analyst

npx copilot-flow route task --task "Check this module for SQL injection risks"
# → suggests: security-auditor
```

---

## Single agent — `npx copilot-flow agent spawn`

Use for focused, single-discipline tasks.

```bash
# Auto-routes to the best agent based on your task
npx copilot-flow agent spawn --task "<task>" --stream

# Specify agent type explicitly
npx copilot-flow agent spawn --type <type> --task "<task>" --stream

# Read task from a file, write result to a file
npx copilot-flow agent spawn --spec input.md --output result.md --type analyst

# Use a custom agent from the .copilot/agents/ directory
npx copilot-flow agent spawn \
  --agent-dir .copilot/agents \
  --skill-dir .copilot/skills \
  --agent product-manager \
  --spec brief.md \
  --output stories.md
```

### Available agent types

| Type | Use for |
|------|---------|
| `coder` | Writing or refactoring code |
| `researcher` | Investigating libraries, patterns, competitors |
| `tester` | Writing unit/integration tests |
| `reviewer` | Code review, quality analysis |
| `architect` | System design, data modelling |
| `analyst` | Requirements, PRDs, user stories |
| `debugger` | Root cause analysis, bug fixing |
| `documenter` | READMEs, API docs, inline comments |
| `optimizer` | Performance, memory, bundle size |
| `security-auditor` | OWASP, vulnerability scanning |
| `performance-engineer` | Benchmarking, load testing |
| `coordinator` | Breaking down complex tasks |

---

## Multi-agent swarm — `npx copilot-flow swarm start`

Use when the task requires multiple disciplines working together.

```bash
# Sequential pipeline: each agent builds on the previous output
npx copilot-flow swarm start \
  --spec feature.md \
  --output result.md \
  --topology sequential \
  --agents researcher,coder,tester,reviewer \
  --stream

# Parallel analysis: run multiple agents simultaneously
npx copilot-flow swarm start \
  --task "Audit this codebase for security, performance, and accessibility" \
  --topology mesh \
  --agents security-auditor,performance-engineer,reviewer
```

---

## Phased pipeline — `npx copilot-flow plan` + `npx copilot-flow exec`

Use for large projects that span multiple phases, where each phase feeds into the next.

```bash
# Step 1: generate a plan from a spec
npx copilot-flow plan spec.md

# Step 2: execute all phases in order
npx copilot-flow exec phases.yaml --stream

# Or execute a single phase
npx copilot-flow exec phases.yaml --phase implement

# Re-run a phase (e.g. after fixing the spec)
npx copilot-flow exec phases.yaml --phase implement --force
```

---

## Persisting context — `npx copilot-flow memory`

Use to store and retrieve project context between runs so agents always have background information.

```bash
npx copilot-flow memory store --namespace project --key stack \
  --value "Next.js 14 App Router, Prisma, PostgreSQL, Tailwind CSS"

npx copilot-flow memory store --namespace project --key conventions \
  --value "TypeScript strict mode, functional components, no default exports"

npx copilot-flow memory retrieve --namespace project --key stack
npx copilot-flow memory search  --namespace project --query "auth"
```

---

## Decision guide

| Situation | Command to run |
|-----------|---------------|
| Not sure which agent to use | `npx copilot-flow route task --task "..."` |
| Single focused task | `npx copilot-flow agent spawn --task "..."` |
| Task needs research + implementation + tests | `npx copilot-flow swarm start --agents researcher,coder,tester` |
| Full feature from spec to code | `npx copilot-flow plan spec.md && npx copilot-flow exec phases.yaml` |
| Something broke and you need a diagnosis | `npx copilot-flow agent spawn --type debugger --task "..."` |
| Need to check if everything is set up | `npx copilot-flow doctor` |
