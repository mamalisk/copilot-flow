/**
 * SQLite-backed namespaced key-value memory store.
 * Used by agents to share state and by the CLI to persist data between runs.
 */

import path from 'path';
import type { MemoryEntry, StoreOptions } from '../types.js';

// We use a lazy getter so the module can be imported without better-sqlite3
// being available (e.g. in tests that mock it).
let _Database: typeof import('better-sqlite3').default | null = null;

function getDatabase() {
  if (!_Database) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _Database = require('better-sqlite3') as typeof import('better-sqlite3').default;
  }
  return _Database;
}

type Db = InstanceType<typeof import('better-sqlite3').default>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id         TEXT    PRIMARY KEY,
  namespace  TEXT    NOT NULL,
  key        TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  tags       TEXT    NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ns_key ON entries (namespace, key);
CREATE INDEX IF NOT EXISTS idx_namespace   ON entries (namespace);
CREATE INDEX IF NOT EXISTS idx_tags        ON entries (tags);
`;

export class MemoryStore {
  private db: Db;

  constructor(dbPath = path.join('.copilot-flow', 'memory.db')) {
    const Database = getDatabase();
    const absPath = path.resolve(dbPath);
    // Ensure parent directory exists
    const dir = path.dirname(absPath);
    const { mkdirSync, existsSync } = require('fs') as typeof import('fs');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new Database(absPath);
    this.db.exec(SCHEMA);
    // Enable WAL for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
  }

  /** Store a value under namespace/key. Upserts if key already exists. */
  store(namespace: string, key: string, value: string, opts: StoreOptions = {}): void {
    this._pruneExpired();
    const id = `${namespace}:${key}`;
    const now = Date.now();
    const expiresAt = opts.ttlMs != null ? now + opts.ttlMs : null;
    const tags = JSON.stringify(opts.tags ?? []);

    this.db
      .prepare(
        `INSERT INTO entries (id, namespace, key, value, tags, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(namespace, key) DO UPDATE SET
           value = excluded.value,
           tags = excluded.tags,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`
      )
      .run(id, namespace, key, value, tags, now, expiresAt);
  }

  /** Retrieve a value by namespace and key. Returns null if not found or expired. */
  retrieve(namespace: string, key: string): string | null {
    this._pruneExpired();
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
   * Returns up to `limit` results (default 20).
   */
  search(namespace: string, query: string, limit = 20): MemoryEntry[] {
    this._pruneExpired();
    const like = `%${query}%`;
    const rows = this.db
      .prepare(
        `SELECT id, namespace, key, value, tags, created_at, expires_at
         FROM entries
         WHERE namespace = ?
           AND (key LIKE ? OR value LIKE ?)
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(namespace, like, like, Date.now(), limit) as Array<{
        id: string;
        namespace: string;
        key: string;
        value: string;
        tags: string;
        created_at: number;
        expires_at: number | null;
      }>;

    return rows.map(r => ({
      id: r.id,
      namespace: r.namespace,
      key: r.key,
      value: r.value,
      tags: JSON.parse(r.tags) as string[],
      createdAt: r.created_at,
      expiresAt: r.expires_at ?? undefined,
    }));
  }

  /** List all non-expired entries in a namespace. */
  list(namespace: string): MemoryEntry[] {
    this._pruneExpired();
    const rows = this.db
      .prepare(
        `SELECT id, namespace, key, value, tags, created_at, expires_at
         FROM entries
         WHERE namespace = ? AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC`
      )
      .all(namespace, Date.now()) as Array<{
        id: string;
        namespace: string;
        key: string;
        value: string;
        tags: string;
        created_at: number;
        expires_at: number | null;
      }>;

    return rows.map(r => ({
      id: r.id,
      namespace: r.namespace,
      key: r.key,
      value: r.value,
      tags: JSON.parse(r.tags) as string[],
      createdAt: r.created_at,
      expiresAt: r.expires_at ?? undefined,
    }));
  }

  /** Delete a specific key from a namespace. */
  delete(namespace: string, key: string): boolean {
    const info = this.db
      .prepare(`DELETE FROM entries WHERE namespace = ? AND key = ?`)
      .run(namespace, key);
    return info.changes > 0;
  }

  /** Delete all entries in a namespace. Returns the number of deleted entries. */
  clear(namespace: string): number {
    const info = this.db
      .prepare(`DELETE FROM entries WHERE namespace = ?`)
      .run(namespace);
    return info.changes;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  private _pruneExpired(): void {
    this.db
      .prepare(`DELETE FROM entries WHERE expires_at IS NOT NULL AND expires_at <= ?`)
      .run(Date.now());
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
