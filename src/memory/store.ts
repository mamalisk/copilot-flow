/**
 * SQLite-backed namespaced key-value memory store.
 * Used by agents to share state and by the CLI to persist data between runs.
 *
 * Uses Node.js built-in `node:sqlite` (available since Node 22.5) to avoid
 * native addon compilation requirements.
 */

import path from 'path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { MemoryEntry, MemoryType, StoreOptions } from '../types.js';
import { rankByBm25 } from './bm25.js';

// Use require() so Vite does not statically resolve `node:sqlite` during test
// transforms. Vite strips the `node:` prefix from static imports and then fails
// to find an npm package named `sqlite`. require() is also consistent with the
// rest of this file's CJS-compatible style (tsconfig module: commonjs).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id         TEXT    PRIMARY KEY,
  namespace  TEXT    NOT NULL,
  key        TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  tags       TEXT    NOT NULL DEFAULT '[]',
  importance REAL    NOT NULL DEFAULT 3,
  type       TEXT    NOT NULL DEFAULT 'fact',
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ns_key    ON entries (namespace, key);
CREATE INDEX IF NOT EXISTS idx_namespace        ON entries (namespace);
CREATE INDEX IF NOT EXISTS idx_importance       ON entries (importance);
CREATE INDEX IF NOT EXISTS idx_type             ON entries (type);
`;

export class MemoryStore {
  private db: InstanceType<typeof DatabaseSyncType>;
  /** Timestamp of the last expired-row purge. Used to throttle write-time cleanup. */
  private _lastPruneAt = 0;
  /** Minimum milliseconds between automatic prune runs (default: 60 s). */
  private readonly _PRUNE_INTERVAL_MS = 60_000;

  constructor(dbPath = path.join('.copilot-flow', 'memory.db')) {
    const absPath = path.resolve(dbPath);
    // Ensure parent directory exists
    const dir = path.dirname(absPath);
    const { mkdirSync, existsSync } = require('fs') as typeof import('fs');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new DatabaseSync(absPath);
    this.db.exec(SCHEMA);
    // Enable WAL for better concurrent read performance
    this.db.exec('PRAGMA journal_mode = WAL');
    // Migrations: ALTER TABLE ADD COLUMN is idempotent when wrapped in try/catch.
    // Each migration is independent so a fresh DB only skips columns that already exist.
    try {
      this.db.exec('ALTER TABLE entries ADD COLUMN importance REAL NOT NULL DEFAULT 3');
    } catch { /* column already exists */ }
    try {
      this.db.exec(`ALTER TABLE entries ADD COLUMN type TEXT NOT NULL DEFAULT 'fact'`);
    } catch { /* column already exists */ }
  }

  /**
   * Store a value under namespace/key. Upserts if key already exists —
   * re-running distillation on the same phase updates facts in place rather
   * than accumulating duplicate rows.
   *
   * Expired rows are purged here (write path) at most once per minute, so
   * reads are never penalised by a silent DELETE before every query.
   */
  store(namespace: string, key: string, value: string, opts: StoreOptions = {}): void {
    this._pruneExpiredIfDue();
    const id = `${namespace}:${key}`;
    const now = Date.now();
    const expiresAt = opts.ttlMs != null ? now + opts.ttlMs : null;
    const tags = JSON.stringify(opts.tags ?? []);
    // Clamp importance to [1, 5], default 3.
    const importance = Math.min(5, Math.max(1, Math.round(opts.importance ?? 3)));
    const type = opts.type ?? 'fact';

    this.db
      .prepare(
        `INSERT INTO entries (id, namespace, key, value, tags, importance, type, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(namespace, key) DO UPDATE SET
           value      = excluded.value,
           tags       = excluded.tags,
           importance = excluded.importance,
           type       = excluded.type,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`
      )
      .run(id, namespace, key, value, tags, importance, type, now, expiresAt);
  }

  /** Retrieve a value by namespace and key. Returns null if not found or expired. */
  retrieve(namespace: string, key: string): string | null {
    const row = this.db
      .prepare(
        `SELECT value FROM entries WHERE namespace = ? AND key = ?
         AND (expires_at IS NULL OR expires_at > ?)`
      )
      .get(namespace, key, Date.now()) as { value: string } | undefined;

    return row?.value ?? null;
  }

  /**
   * Search entries in a namespace by substring match on key or value,
   * re-ranked by Okapi BM25 relevance score.
   *
   * The LIKE query acts as a broad recall filter; BM25 re-ranks the candidate
   * set by how well each entry's `key + value` text matches the query tokens.
   * Results are sorted BM25 score DESC, then importance DESC for ties.
   *
   * @param limit       Maximum results to return after re-ranking (default 20).
   * @param filterTags  When provided, only tag-matching entries are candidates.
   * @param filterType  When provided, only entries of this type are candidates.
   */
  search(namespace: string, query: string, limit = 20, filterTags?: string[], filterType?: MemoryType): MemoryEntry[] {
    const like    = `%${query}%`;
    const hasTags = filterTags != null && filterTags.length > 0;
    const tagClause = hasTags
      ? `AND EXISTS (SELECT 1 FROM json_each(tags) AS t JOIN json_each(?) AS f ON t.value = f.value)`
      : '';
    const typeClause = filterType != null ? `AND type = ?` : '';
    // Fetch up to CANDIDATE_LIMIT rows — no user LIMIT here so BM25 scores the
    // full candidate set before we slice to `limit`.
    const CANDIDATE_LIMIT = 500;
    const params: (string | number)[] = [namespace, like, like, Date.now()];
    if (hasTags) params.push(JSON.stringify(filterTags));
    if (filterType != null) params.push(filterType);
    params.push(CANDIDATE_LIMIT);

    const rows = this.db
      .prepare(
        `SELECT id, namespace, key, value, tags, importance, type, created_at, expires_at
         FROM entries
         WHERE namespace = ?
           AND (key LIKE ? OR value LIKE ?)
           AND (expires_at IS NULL OR expires_at > ?)
           ${tagClause}
           ${typeClause}
         ORDER BY importance DESC, created_at DESC
         LIMIT ?`
      )
      .all(...params) as Array<{
        id: string;
        namespace: string;
        key: string;
        value: string;
        tags: string;
        importance: number;
        type: string;
        created_at: number;
        expires_at: number | null;
      }>;

    const entries = rows.map(r => ({
      id: r.id,
      namespace: r.namespace,
      key: r.key,
      value: r.value,
      tags: JSON.parse(r.tags) as string[],
      importance: r.importance,
      type: r.type as MemoryType,
      createdAt: r.created_at,
      expiresAt: r.expires_at ?? undefined,
    }));

    return rankByBm25(query, entries).slice(0, limit);
  }

  /**
   * List all non-expired entries in a namespace.
   * Results are ordered by importance DESC, then created_at DESC so that
   * higher-priority facts are injected first when building prompt context.
   *
   * @param filterTags  When provided, only entries whose tags array shares at
   *                    least one element with this list are returned.
   * @param filterType  When provided, only entries of this type are returned.
   */
  list(namespace: string, filterTags?: string[], filterType?: MemoryType): MemoryEntry[] {
    const hasTags = filterTags != null && filterTags.length > 0;
    const tagClause = hasTags
      ? `AND EXISTS (SELECT 1 FROM json_each(tags) AS t JOIN json_each(?) AS f ON t.value = f.value)`
      : '';
    const typeClause = filterType != null ? `AND type = ?` : '';
    const params: (string | number)[] = [namespace, Date.now()];
    if (hasTags) params.push(JSON.stringify(filterTags));
    if (filterType != null) params.push(filterType);

    const rows = this.db
      .prepare(
        `SELECT id, namespace, key, value, tags, importance, type, created_at, expires_at
         FROM entries
         WHERE namespace = ? AND (expires_at IS NULL OR expires_at > ?)
         ${tagClause}
         ${typeClause}
         ORDER BY importance DESC, created_at DESC`
      )
      .all(...params) as Array<{
        id: string;
        namespace: string;
        key: string;
        value: string;
        tags: string;
        importance: number;
        type: string;
        created_at: number;
        expires_at: number | null;
      }>;

    return rows.map(r => ({
      id: r.id,
      namespace: r.namespace,
      key: r.key,
      value: r.value,
      tags: JSON.parse(r.tags) as string[],
      importance: r.importance,
      type: r.type as MemoryType,
      createdAt: r.created_at,
      expiresAt: r.expires_at ?? undefined,
    }));
  }

  /** Delete a specific key from a namespace. */
  delete(namespace: string, key: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM entries WHERE namespace = ? AND key = ?`)
      .run(namespace, key) as { changes: number };
    return result.changes > 0;
  }

  /** List all distinct namespace names that have at least one non-expired entry. */
  listNamespaces(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT namespace FROM entries
         WHERE (expires_at IS NULL OR expires_at > ?)
         ORDER BY namespace`
      )
      .all(Date.now()) as Array<{ namespace: string }>;
    return rows.map(r => r.namespace);
  }

  /** Delete all entries in a namespace. Returns the number of deleted entries. */
  clear(namespace: string): number {
    const result = this.db
      .prepare(`DELETE FROM entries WHERE namespace = ?`)
      .run(namespace) as { changes: number };
    return result.changes;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  /**
   * Delete expired rows. Throttled to at most once per `_PRUNE_INTERVAL_MS` so
   * a burst of store() calls (e.g. distilling 10 facts at once) doesn't hammer
   * SQLite with repeated DELETEs. Read methods skip this entirely — they already
   * filter expired rows in their WHERE clauses, so correctness is unaffected.
   */
  private _pruneExpiredIfDue(): void {
    const now = Date.now();
    if (now - this._lastPruneAt < this._PRUNE_INTERVAL_MS) return;
    this.db
      .prepare(`DELETE FROM entries WHERE expires_at IS NOT NULL AND expires_at <= ?`)
      .run(now);
    this._lastPruneAt = now;
  }
}

/** Process-wide default memory store. Lazily initialised. */
let _defaultStore: MemoryStore | null = null;

export function getMemoryStore(dbPath?: string): MemoryStore {
  if (!_defaultStore) {
    _defaultStore = new MemoryStore(dbPath);
  }
  return _defaultStore;
}
