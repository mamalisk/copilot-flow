# Memory System — Future Improvements

← [Back to README](../../README.md)

This document captures planned improvements to the copilot-flow memory system, informed
by a research session across three codebases: copilot-flow's own internal audit, ruflo v3's
hybrid SQLite + HNSW vector backend, and mempalace's 4-layer memory stack with BM25 hybrid
search, temporal knowledge graph, and importance-scored retrieval.

Items are ordered by implementation priority — lowest-effort, highest-impact first.

---

## ✅ 1. Upsert dedup instead of append

> **Implemented** — `store()` in `src/memory/store.ts` uses `ON CONFLICT(namespace, key) DO UPDATE SET`,
> a full SQL upsert. Re-running the same phase updates facts in place; no duplicate rows accumulate.
> Documented in [docs/commands/memory.md](../commands/memory.md#upsert-semantics).

~~Every distillation run appended new facts. Re-running the same phase twice silently
accumulated duplicate or near-duplicate entries under different row IDs.~~

**What was confirmed**: the schema carries a `UNIQUE (namespace, key)` index and every
`store()` call is an upsert — distilled facts from re-runs overwrite the previous values
under the same keys rather than creating new rows.

---

## 2. Importance scoring on stored facts

**Current behaviour**: all facts are treated equally. A trivial config note and a
critical architecture decision are stored, ranked, and injected identically.

**Problem**: `buildMemoryContext` returns the 50 most-recent entries ordered by
`created_at DESC`. Recency is a poor proxy for relevance — the most important decision
from last week beats an incidental observation from this morning.

**Inspiration**: mempalace `layers.py` — every drawer has an `importance` float (1–5).
Layer 1 sorts by importance descending and keeps the top 15 moments.

**Proposal**:
- Add `importance?: number` (1–5, default 3) to `StoreOptions` and the `MemoryEntry` type
- Add an `importance REAL DEFAULT 3` column to the SQLite schema
- Update the built-in distillation prompt to ask the model to produce an importance score
  alongside key/value/tags
- Change `buildMemoryContext`'s sort from `created_at DESC` to `importance DESC, created_at DESC`

---

## 3. Tag filtering in prompt injection

**Current behaviour**: `buildMemoryContext(namespace)` returns all facts in a namespace
regardless of their tags. A `coder` phase gets the same memory block as a `researcher`
phase — decisions, configs, API notes, and architecture facts all injected together.

**Problem**: context pollution. A phase receives many irrelevant facts and may
have fewer tokens left for the facts that actually matter to its job.

**Inspiration**: mempalace wing/room taxonomy — L2 retrieval accepts `wing` and `room`
filters. Only the relevant slice of memory is loaded, not the whole namespace.

**Proposal**:
- Add an optional `tags?: string[]` parameter to `buildMemoryContext`
- When tags are provided, add a `WHERE json_each(tags) IN (...)` filter to the `list()` query
- In `exec.ts`, pass the current phase's `agentType` and any phase-level `contextTags`
  (a new optional YAML field) to `buildMemoryContext` so each phase receives only its
  relevant slice

Tags are already stored in SQLite — this is entirely a read-path change.

---

## ✅ 4. Move TTL pruning off the read path

> **Implemented** — `_pruneExpired()` removed from `retrieve()`, `search()`, and `list()`.
> Replaced with `_pruneExpiredIfDue()` on the `store()` write path, throttled to at most once
> per 60 seconds. Read methods already filter expired rows in SQL (`expires_at IS NULL OR expires_at > ?`)
> so correctness is unaffected. Documented in [docs/commands/memory.md](../commands/memory.md#ttl-and-expiry).

~~`_pruneExpired()` was called inside every `retrieve()`, `search()`, and `list()` call,
executing a `DELETE` statement synchronously before every read. Under load (parallel phases
all reading memory) this serialised against SQLite's write lock.~~

**What changed**: pruning now runs on the write path only, throttled to once per minute.
A burst of 10 distilled facts stores at most one `DELETE` pass total.

---

## 5. BM25 search to replace `LIKE %query%`

**Current behaviour**: `store.search(namespace, query)` executes
`WHERE (key LIKE ? OR value LIKE ?)` with wildcards. Results are ordered by `created_at DESC`.

**Problem**: substring match misses conceptually related facts (`"auth"` won't find
`"JWT"`, `"OpenID"`, or `"session tokens"`). There is no relevance ranking — a fact that
mentions the query once ranks identically to one that mentions it ten times.

**Inspiration**: mempalace `searcher.py` — full Okapi-BM25 (k1=1.5, b=0.75) computed over
the candidate set, combined with vector similarity in a 60/40 convex combination.

**Proposal**: implement BM25 scoring in TypeScript within `store.search()`:
1. Fetch candidates via `LIKE` (broad net, preserves recall)
2. Tokenise query and candidates (lowercase + alphanumeric, length ≥ 2)
3. Compute IDF over the candidate set and TF per document
4. Return ranked by BM25 score descending

Pure TypeScript, no external dependencies, no embeddings required. This makes
`memory search` genuinely useful for recall queries.

---

## 6. Layered injection with token budget

**Current behaviour**: `buildMemoryContext` injects up to 50 facts unconditionally
before every phase/agent/swarm task. No token awareness. Large namespaces can bloat
prompts significantly.

**Problem**: all 50 facts injected regardless of importance or relevance. Older, less
important facts consume context that should be reserved for the task itself.

**Inspiration**: mempalace `layers.py` — a 4-layer stack with a fixed wake-up budget:
- L0 (~100 tokens): always loaded, static identity block
- L1 (~500–800 tokens): auto-generated from top-importance facts, hard-capped
- L2 (~200–500 tokens per call): loaded only when a matching topic comes up
- L3: deep semantic search on explicit demand

**Proposal** (depends on #2 importance scoring being in place):

Split `buildMemoryContext` into two tiers:
- **Wake-up context** (always injected): top-N facts by `importance DESC`, hard-capped
  at 800 tokens (~3,200 chars). Always included.
- **Topic context** (injected when tags match): facts whose tags intersect the current
  phase's `agentType` or `contextTags`. Fetched separately and appended after the
  wake-up block.

The combined result stays within a configurable token cap (default 1,200 tokens).

---

## 7. Memory types

**Current behaviour**: all stored entries are untyped strings. The `contextKey` prefix
(`phase:research:...`, `task:task-2:...`) is a loose naming convention but carries no
semantic meaning — there is no way to query "all decisions" or "all workflow state blobs".

**Inspiration**: ruflo v3 `MemoryType` — `'task' | 'context' | 'event' | 'task-start' |
'task-complete' | 'workflow-state'`. Typed memories enable targeted retrieval, agent
isolation, and workflow state resumption.

**Proposal**:
- Add `type?: 'fact' | 'decision' | 'workflow-state' | 'context'` to `StoreOptions`
  and `MemoryEntry`
- Add a `type TEXT DEFAULT 'fact'` column to the SQLite schema
- Update `memory list` CLI to accept `--type <type>` filter
- In `buildMemoryContext`, skip `workflow-state` entries (they are blobs, not prose facts)
- Reserve `workflow-state` for future swarm resumption: a crashed swarm can serialise its
  partial results under a deterministic key and restore them on re-run

---

## 8. Project identity block

**Current behaviour**: memory injection always starts with distilled facts from the run.
There is no stable, always-present context about what the project is, who works on it, or
what the core constraints are.

**Problem**: agents re-discover basic project context on every run. A researcher phase
may need to understand the tech stack before it can store anything useful — but that
understanding is itself not persisted.

**Inspiration**: mempalace `Layer0` / `identity.txt` (~100 tokens, always loaded).
A small plain-text file the user writes once. Every session starts by reading it.
mempalace calls this the "wake-up anchor".

**Proposal**: if `.github/memory-identity.md` exists, always prepend its content to
every memory-injected prompt — before the dynamic facts block — regardless of namespace.
The file is user-managed, not auto-generated, so it never ages out of TTL.

```bash
# Initialise the identity file
copilot-flow memory identity   # (new subcommand, analogous to `memory prime`)
# Edit .github/memory-identity.md to describe the project
```

---

## Priority summary

| # | Item | Effort | Impact | Depends on | Status |
|---|------|--------|--------|-----------|--------|
| 1 | Upsert dedup | XS | High | — | ✅ Done |
| 2 | Importance scoring | S | High | — | Pending |
| 3 | Tag filtering in injection | S | Medium | — | Pending |
| 4 | Move pruning off read path | XS | Medium | — | ✅ Done |
| 5 | BM25 search | M | Medium | — | Pending |
| 6 | Layered injection | M | High | #2 | Pending |
| 7 | Memory types | S | Medium | — | Pending |
| 8 | Project identity block | S | Medium | — | Pending |
