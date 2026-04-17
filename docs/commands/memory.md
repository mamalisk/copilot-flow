# `copilot-flow memory`

← [Back to README](../../README.md)

Persistent SQLite key-value store, namespaced per project.
Use it to pass context between separate `agent` and `swarm` runs without re-reading files.

---

## Commands

### `memory store`

```bash
copilot-flow memory store --namespace <ns> --key <key> --value <value> [--ttl <ms>]
```

| Flag | Description |
|------|-------------|
| `--namespace <ns>` | Logical group (e.g. `project`, `session`, `user`) |
| `--key <key>` | Entry identifier |
| `--value <value>` | Value to store |
| `--ttl <ms>` | Time-to-live in milliseconds (entry auto-deletes after this) |
| `--importance <n>` | Importance score 1–5 (default 3). Higher-scored facts are injected first into agent prompts. |

**Importance scale**: 5 = critical (architecture/security decisions), 4 = important (key design choices), 3 = notable (standard facts), 2 = minor (supporting details), 1 = trivial.

### `memory retrieve`

```bash
copilot-flow memory retrieve --namespace <ns> --key <key>
```

### `memory search`

Search entries in a namespace. Results are ranked by **Okapi BM25** relevance
(k1=1.5, b=0.75) so entries that mention the query terms more frequently rank
higher — not just earliest-inserted first. Importance is used as a tiebreaker.

```bash
copilot-flow memory search --namespace <ns> --query <text> [--limit <n>]
```

The LIKE filter (`key LIKE %query% OR value LIKE %query%`) acts as a broad recall
net; BM25 re-ranks the candidate set by relevance before the limit is applied.
Tokenisation: lowercase, alphanumeric only, tokens < 2 chars dropped.

### `memory list`

List all keys in a namespace.

```bash
copilot-flow memory list --namespace <ns>
```

### `memory delete`

```bash
copilot-flow memory delete --namespace <ns> --key <key>
```

### `memory clear`

Delete all entries in a namespace.

```bash
copilot-flow memory clear --namespace <ns>
```

### `memory prime`

Create `.github/memory-prompt.md` pre-filled with the default distillation prompt.
Once the file exists, edit it to control exactly what facts agents extract and store
after each run (see [Automatic distillation](#automatic-distillation-memory-namespace) below).

```bash
copilot-flow memory prime           # create .github/memory-prompt.md (skips if exists)
copilot-flow memory prime --force   # overwrite existing file
```

| Flag | Description |
|------|-------------|
| `--force` | Overwrite `.github/memory-prompt.md` if it already exists |

---

## Automatic distillation (`--memory-namespace`)

The `exec`, `agent`, and `swarm` commands accept a `--memory-namespace <ns>` flag that
enables two-way automatic memory:

1. **Inject** — before each phase/task runs, facts previously stored under `<ns>` are
   prepended to the prompt as a `## Remembered context` section.
2. **Distil** — after each successful phase/task, a small follow-up LLM call extracts
   up to 10 key facts from the output and stores them under `<ns>` with a 30-day TTL.

```bash
# First run — seeds memory
copilot-flow exec phases.yaml --memory-namespace my-project

# Second run — agents automatically see facts from the previous run
copilot-flow exec phases.yaml --memory-namespace my-project

# Inspect what was stored
copilot-flow memory list --namespace my-project
```

### Per-phase tag filtering (`contextTags`)

By default every phase sees **all** facts in the namespace. Setting `contextTags` on a
phase restricts injection to facts whose tags share at least one element with the list —
reducing context noise for specialised phases.

```yaml
phases:
  - id: coder
    type: agent
    agentType: coder
    description: Implement the feature
    contextTags: [code, architecture]   # only code and architecture facts injected

  - id: researcher
    type: agent
    agentType: researcher
    description: Research the problem
    contextTags: [requirement, decision] # only requirements and decisions
```

Tag vocabulary: `decision | constraint | requirement | architecture | code | api | config`

Omit `contextTags` (or leave it empty) to receive all facts — the previous default behaviour.

---

### Customising the distillation prompt

By default the built-in prompt asks for facts tagged as `decision | constraint |
requirement | architecture | code | api | config`. To tailor this for your project:

```bash
copilot-flow memory prime           # writes .github/memory-prompt.md
# edit .github/memory-prompt.md to change what gets extracted
copilot-flow exec phases.yaml --memory-namespace my-project
```

The file must end with a line that the agent's output will be appended to (e.g.
`Output to distil:`). The prompt must instruct the model to return **only** a JSON
array of `{key, value, tags}` objects — no surrounding text.

---

## Storage internals

Memory is persisted in `.copilot-flow/memory.db` (SQLite, WAL mode). The path is
configurable in `.copilot-flow/config.json` under `memory.path`. The file is created
automatically on first use.

### Upsert semantics

Every `store` call is an **upsert** — if an entry with the same namespace + key already
exists its value, tags, and TTL are updated in place. No duplicate rows accumulate.

This means re-running a phase or agent with `--memory-namespace` is safe: distilled facts
from the second run overwrite the facts from the first run under the same keys, rather than
creating a growing pile of near-identical entries.

### TTL and expiry

Expired entries are filtered out of all read queries in SQL, so they are invisible
immediately after expiry without any cleanup pass. Physical row deletion (to reclaim disk
space) happens on the **write path** — at most once per minute — so reads are never
penalised by a silent `DELETE` before every query.

### Layered injection

When memory is injected into a prompt, facts are chosen in two passes:

| Tier | What | Cap |
|------|------|-----|
| **Wake-up** | Top facts by `importance DESC`, all tags, always included | 3,200 chars (≈ 800 tokens) |
| **Topic** | Tag-filtered facts (`contextTags`) not already in wake-up | 4,800 chars combined (≈ 1,200 tokens total) |

Facts with importance ≥ 4 receive an `(importance: N)` badge in the prompt so the model
can weigh them appropriately.

If a namespace has fewer facts than the caps, all of them are included — the caps only
kick in when the namespace grows large.

---

## Example: persist context across runs

```bash
# Store project context once
copilot-flow memory store \
  --namespace project \
  --key stack \
  --value "Next.js 14 App Router, Prisma, PostgreSQL, Tailwind CSS"

copilot-flow memory store \
  --namespace project \
  --key coding-standards \
  --value "TypeScript strict mode, no any, functional components only, tests required"

# In subsequent agent runs, the context is already in memory
# (agents read from memory automatically when configured)

# Expire a temporary value after 1 hour
copilot-flow memory store \
  --namespace session \
  --key branch-name \
  --value "feature/user-auth" \
  --ttl 3600000
```
