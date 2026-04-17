/**
 * SQLite-backed namespaced key-value memory store.
 * Used by agents to share state and by the CLI to persist data between runs.
 *
 * Uses Node.js built-in `node:sqlite` (available since Node 22.5) to avoid
 * native addon compilation requirements.
 */

import path from 'path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { MemoryEntry, StoreOptions } from '../types.js';

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
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ns_key    ON entries (namespace, key);
CREATE INDEX IF NOT EXISTS idx_namespace        ON entries (namespace);
CREATE INDEX IF NOT EXISTS idx_importance       ON entries (importance);
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
    // Migration: add importance column to databases created before this feature.
    // ALTER TABLE ADD COLUMN is idempotent when wrapped in try/catch.
    try {
      this.db.exec('ALTER TABLE entries ADD COLUMN importance REAL NOT NULL DEFAULT 3');
    } catch {
      // Column already exists — no action needed.
    }
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

    this.db
      .prepare(
        `INSERT INTO entries (id, namespace, key, value, tags, importance, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(namespace, key) DO UPDATE SET
           value      = excluded.value,
           tags       = excluded.tags,
           importance = excluded.importance,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`
      )
      .run(id, namespace, key, value, tags, importance, now, expiresAt);
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
   * Search entries in a namespace by substring match on key or value.
   * Results are ordered by importance DESC, then created_at DESC.
   * Returns up to `limit` results (default 20).
   */
  search(namespace: string, query: string, limit = 20): MemoryEntry[] {
    const like = `%${query}%`;
    const rows = this.db
      .prepare(
        `SELECT id, namespace, key, value, tags, importance, created_at, expires_at
         FROM entries
         WHERE namespace = ?
           AND (key LIKE ? OR value LIKE ?)
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY importance DESC, created_at DESC
         LIMIT ?`
      )
      .all(namespace, like, like, Date.now(), limit) as Array<{
        id: string;
        namespace: string;
        key: string;
        value: string;
        tags: string;
        importance: number;
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
      createdAt: r.created_at,
      expiresAt: r.expires_at ?? undefined,
    }));
  }

  /**
   * List all non-expired entries in a namespace.
   * Results are ordered by importance DESC, then created_at DESC so that
   * higher-priority facts are injected first when building prompt context.
   */
  list(namespace: string): MemoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, namespace, key, value, tags, importance, created_at, expires_at
         FROM entries
         WHERE namespace = ? AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY importance DESC, created_at DESC`
      )
      .all(namespace, Date.now()) as Array<{
        id: string;
        namespace: string;
        key: string;
        value: string;
        tags: string;
        importance: number;
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
