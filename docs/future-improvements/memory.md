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

## ✅ 2. Importance scoring on stored facts

> **Implemented** — `StoreOptions` and `MemoryEntry` both carry `importance: number` (1–5,
> default 3). The SQLite schema has an `importance REAL NOT NULL DEFAULT 3` column with an
> index. `list()` and `search()` sort by `importance DESC, created_at DESC` so higher-priority
> facts are always first. `buildMemoryContext` surfaces importance badges for entries scoring
> 4–5. The built-in distillation prompts ask for an `importance` field per fact and pass it
> through to `store()`. The `memory store` CLI accepts `--importance <n>`. Existing databases
> are migrated automatically via `ALTER TABLE ADD COLUMN`.

~~**Current behaviour**: all facts are treated equally. A trivial config note and a~~
~~critical architecture decision are stored, ranked, and injected identically.~~

**What changed**:
- `importance?: number` (1–5, default 3) added to `StoreOptions`; `importance: number`
  added to `MemoryEntry`
- SQLite schema: `importance REAL NOT NULL DEFAULT 3` column + index; automatic `ALTER TABLE`
  migration for existing databases
- `list()` and `search()` sort by `importance DESC, created_at DESC`
- `buildMemoryContext` appends `(importance: N)` badge for entries ≥ 4
- Built-in distillation prompt asks the model for an `importance` score per fact
- `memory store` CLI accepts `--importance <n>` (clamped to 1–5)
- 8 new tests cover defaults, clamping, upsert refresh, and sort order

---

## ✅ 3. Tag filtering in prompt injection

> **Implemented** — `buildMemoryContext(namespace, filterTags?)` accepts an optional tag
> filter. `list()` and `search()` gained a matching `filterTags?` parameter backed by a
> `json_each()` SQL intersection check. `PlanPhase` gained `contextTags?: string[]`; when
> set, `exec.ts` passes it to `buildMemoryContext` so each phase receives only its relevant
> memory slice. Omitting `contextTags` preserves the existing all-facts behaviour.

~~**Current behaviour**: `buildMemoryContext(namespace)` returns all facts in a namespace~~
~~regardless of their tags.~~

**What changed**:
- `list(namespace, filterTags?)` and `search(namespace, query, limit, filterTags?)` — SQL
  intersection via `json_each()`: entries are included only when their tags array shares at
  least one element with `filterTags`
- `buildMemoryContext(namespace, filterTags?)` — passes the filter down to `store.list()`
- `PlanPhase.contextTags?: string[]` — new optional YAML field; when present, used as the
  `filterTags` argument in `exec.ts`
- 7 new tests cover filtering, backward compat (no filter = all entries), empty filter,
  multi-tag entries, and `search()` tag filtering

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

## ✅ 5. BM25 search to replace `LIKE %query%`

> **Implemented** — `store.search()` now fetches LIKE candidates (broad recall net) then
> re-ranks them with Okapi BM25 (k1=1.5, b=0.75) in `src/memory/bm25.ts`. Tokenisation:
> lowercase, split on non-alphanumeric, drop tokens < 2 chars. IDF is computed over the
> candidate set; TF is normalized by document length against the average. Results are
> sorted BM25 score DESC, importance DESC for ties. Pure TypeScript, no dependencies.
> 13 unit tests in `tests/memory/bm25.test.ts` + 4 integration tests in `store.test.ts`.

~~**Current behaviour**: `store.search(namespace, query)` executes~~
~~`WHERE (key LIKE ? OR value LIKE ?)` with results ordered by `created_at DESC`.~~

**What changed**:
- New `src/memory/bm25.ts` — exports `tokenize(text)` and `rankByBm25(queryText, entries)`
- `store.search()` fetches up to 500 LIKE-matched candidates (internal `CANDIDATE_LIMIT`),
  passes them to `rankByBm25`, then slices to the user's `limit`
- Tiebreaking falls back to `importance DESC` when BM25 scores are equal
- When query tokenises to zero terms (e.g. single-char query), falls back to `importance DESC`

---

## ✅ 6. Layered injection with token budget

> **Implemented** — `buildMemoryContext` now uses a two-tier char-budgeted algorithm.
> Tier 1 (wake-up): top facts by `importance DESC`, hard-capped at `WAKE_UP_CHAR_CAP`
> (3,200 chars ≈ 800 tokens), always injected. Tier 2 (topic): tag-filtered entries
> not already in the wake-up block, appended until `TOTAL_CHAR_CAP` (4,800 chars ≈
> 1,200 tokens). Both constants are exported for tests. The flat `MAX_ENTRIES = 50`
> limit is removed. 11 new tests in `tests/memory/inject.test.ts`.

~~**Current behaviour**: `buildMemoryContext` injects up to 50 facts unconditionally~~
~~before every phase/agent/swarm task. No token awareness.~~

**What changed**:
- Removed flat `MAX_ENTRIES = 50` limit
- Tier 1 (wake-up): iterates `store.list(namespace)` (importance DESC) and accumulates
  entries until `WAKE_UP_CHAR_CAP = 3_200` chars is reached — always injected
- Tier 2 (topic): only when `filterTags` is set; iterates tag-filtered results, skips
  entries already in the wake-up set, accumulates until `TOTAL_CHAR_CAP = 4_800` chars
- `buildMemoryContext` gains an optional `store?` parameter for test dependency injection
- `WAKE_UP_CHAR_CAP` and `TOTAL_CHAR_CAP` exported from `inject.ts`

---

## ✅ 7. Memory types

> **Implemented** — `MemoryType = 'fact' | 'decision' | 'workflow-state' | 'context'` added
> to `src/types.ts`. `MemoryEntry.type: MemoryType` (required) and `StoreOptions.type?: MemoryType`
> (default `'fact'`). SQLite schema: `type TEXT NOT NULL DEFAULT 'fact'` column + `idx_type`
> index; automatic `ALTER TABLE` migration for existing databases. `list()` and `search()` both
> accept an optional `filterType?: MemoryType` parameter backed by `AND type = ?` in SQL.
> `buildMemoryContext` skips `workflow-state` entries in both tiers (wake-up and topic).
> CLI: `memory store --type`, `memory list --type`, `memory search --type`. 7 new tests in
> `tests/memory/store.test.ts`; 2 new tests in `tests/memory/inject.test.ts`.

~~**Current behaviour**: all stored entries are untyped strings. The `contextKey` prefix
(`phase:research:...`, `task:task-2:...`) is a loose naming convention but carries no
semantic meaning — there is no way to query "all decisions" or "all workflow state blobs".~~

**What changed**:
- `MemoryType` type alias added to `src/types.ts`
- `MemoryEntry.type: MemoryType` (non-optional, always present)
- `StoreOptions.type?: MemoryType` (default `'fact'`); upsert refreshes the type column
- SQLite: `type TEXT NOT NULL DEFAULT 'fact'` column + `CREATE INDEX idx_type`; `ALTER TABLE`
  migration with try/catch for existing databases
- `list(namespace, filterTags?, filterType?)` — `AND type = ?` clause appended when `filterType` is set
- `search(namespace, query, limit, filterTags?, filterType?)` — same
- `buildMemoryContext` skips `type === 'workflow-state'` in both tiers; these are serialised
  blobs intended for swarm resumption, not prose facts for agents
- CLI `memory store --type <type>`, `memory list --type <type>`, `memory search --type <type>`
- `memory list` shows a `(type)` badge when type is non-default (i.e. not `'fact'`)

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
| 2 | Importance scoring | S | High | — | ✅ Done |
| 3 | Tag filtering in injection | S | Medium | — | ✅ Done |
| 4 | Move pruning off read path | XS | Medium | — | ✅ Done |
| 5 | BM25 search | M | Medium | — | ✅ Done |
| 6 | Layered injection | M | High | #2 | ✅ Done |
| 7 | Memory types | S | Medium | — | ✅ Done |
| 8 | Project identity block | S | Medium | — | Pending |
