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

### `memory retrieve`

```bash
copilot-flow memory retrieve --namespace <ns> --key <key>
```

### `memory search`

Full-text search across all values in a namespace.

```bash
copilot-flow memory search --namespace <ns> --query <text>
```

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

---

## Storage location

Memory is persisted in `.copilot-flow/memory.db` (SQLite). The path is configurable in
`.copilot-flow/config.json` under `memory.path`. The file is created automatically on first use.

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
