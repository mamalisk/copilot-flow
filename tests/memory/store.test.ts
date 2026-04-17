import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import { existsSync, unlinkSync } from 'fs';
import { MemoryStore } from '../../src/memory/store.js';

// Generate a unique temp-file path per test so tests never share a database.
// Use Math.random() so the path is unique even when fake timers are active.
function tmpDbPath(): string {
  return path.join(os.tmpdir(), `memstore-test-${Math.random().toString(36).slice(2)}.db`);
}

// Remove a SQLite database file and its WAL/SHM companions.
function removeDb(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = dbPath + suffix;
    if (existsSync(f)) unlinkSync(f);
  }
}

describe('MemoryStore', () => {
  let store: MemoryStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    store = new MemoryStore(dbPath);
    // Activate fake timers after the constructor so the DB file is created with
    // real fs calls, but all Date.now() calls inside store methods use fake time.
    vi.useFakeTimers({ now: Date.now() });
  });

  afterEach(() => {
    vi.useRealTimers();
    store.close();
    removeDb(dbPath);
  });

  // ── Basic store / retrieve ────────────────────────────────────────────────

  it('stores and retrieves a value', () => {
    store.store('ns', 'key', 'hello world');
    expect(store.retrieve('ns', 'key')).toBe('hello world');
  });

  it('returns null for a missing key', () => {
    expect(store.retrieve('ns', 'no-such-key')).toBeNull();
  });

  it('returns null for a key in a different namespace', () => {
    store.store('ns-a', 'key', 'value');
    expect(store.retrieve('ns-b', 'key')).toBeNull();
  });

  // ── Upsert / dedup ────────────────────────────────────────────────────────

  it('upserts — second write to the same key updates the value in place', () => {
    store.store('ns', 'key', 'first');
    store.store('ns', 'key', 'second');
    expect(store.retrieve('ns', 'key')).toBe('second');
  });

  it('upserts — only one row exists after writing the same key twice', () => {
    store.store('ns', 'key', 'first');
    store.store('ns', 'key', 'second');
    expect(store.list('ns')).toHaveLength(1);
  });

  it('upsert refreshes the TTL on overwrite', () => {
    store.store('ns', 'key', 'v1', { ttlMs: 1_000 });
    vi.advanceTimersByTime(800); // 800 ms in — still alive
    store.store('ns', 'key', 'v2', { ttlMs: 1_000 }); // TTL clock resets
    vi.advanceTimersByTime(800); // 800 ms after last write — still alive
    expect(store.retrieve('ns', 'key')).toBe('v2');
  });

  it('upsert also refreshes tags', () => {
    store.store('ns', 'key', 'value', { tags: ['old-tag'] });
    store.store('ns', 'key', 'value', { tags: ['new-tag'] });
    expect(store.list('ns')[0].tags).toEqual(['new-tag']);
  });

  // ── TTL expiry — correctness on reads ─────────────────────────────────────

  it('retrieve returns null after TTL expires', () => {
    store.store('ns', 'key', 'v', { ttlMs: 500 });
    vi.advanceTimersByTime(600);
    expect(store.retrieve('ns', 'key')).toBeNull();
  });

  it('list() omits expired entries', () => {
    store.store('ns', 'permanent', 'stays');
    store.store('ns', 'ephemeral', 'gone', { ttlMs: 100 });
    vi.advanceTimersByTime(200);
    const entries = store.list('ns');
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('permanent');
  });

  it('search() omits expired entries', () => {
    store.store('ns', 'active', 'find me');
    store.store('ns', 'dead', 'find me too', { ttlMs: 50 });
    vi.advanceTimersByTime(100);
    const results = store.search('ns', 'find me');
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('active');
  });

  // ── Key test for the pruning change: reads are correct with no DELETE pass ─

  it('expired entries are invisible on reads even before any store()-triggered prune', () => {
    store.store('ns', 'key', 'v', { ttlMs: 100 });
    vi.advanceTimersByTime(200);
    // No further store() call has been made, so _pruneExpiredIfDue may not have run.
    // The SQL WHERE clause must still filter the expired row on every read.
    expect(store.retrieve('ns', 'key')).toBeNull();
    expect(store.list('ns')).toHaveLength(0);
    expect(store.search('ns', 'v')).toHaveLength(0);
  });

  // ── Pruning throttle ──────────────────────────────────────────────────────

  it('rapid successive store() calls prune at most once per interval', () => {
    // Seed: one entry that will expire shortly.
    store.store('ns', 'seed', 'v', { ttlMs: 10 });
    vi.advanceTimersByTime(20); // seed expires

    // First write after the entry expires — prune runs (_lastPruneAt = now).
    store.store('ns', 'a', '1');
    // Immediate subsequent writes — within throttle window, prune must be skipped.
    store.store('ns', 'b', '2');
    store.store('ns', 'c', '3');

    // All three new entries present; seed entry filtered (expired).
    const keys = store.list('ns').map(e => e.key).sort();
    expect(keys).toEqual(['a', 'b', 'c']);
  });

  it('prune runs again after the throttle interval elapses', () => {
    // Write and expire an entry, triggering a prune on the next store().
    store.store('ns', 'first-entry', 'v', { ttlMs: 10 });
    vi.advanceTimersByTime(20);
    store.store('ns', 'a', '1'); // first prune, _lastPruneAt = T₁

    // Write and expire another entry.
    store.store('ns', 'second-entry', 'v', { ttlMs: 10 });
    vi.advanceTimersByTime(10);  // second-entry expires

    // Advance past the 60-second throttle window.
    vi.advanceTimersByTime(60_001);
    store.store('ns', 'b', '2'); // second prune should run now

    // Only 'a' and 'b' survive — both expired entries cleaned up.
    const keys = store.list('ns').map(e => e.key).sort();
    expect(keys).toEqual(['a', 'b']);
  });

  // ── Tags ─────────────────────────────────────────────────────────────────

  it('stores and returns tags on list()', () => {
    store.store('ns', 'key', 'value', { tags: ['decision', 'architecture'] });
    expect(store.list('ns')[0].tags).toEqual(['decision', 'architecture']);
  });

  it('tags default to empty array when not provided', () => {
    store.store('ns', 'key', 'value');
    expect(store.list('ns')[0].tags).toEqual([]);
  });

  it('search() results include tags', () => {
    store.store('ns', 'auth-key', 'JWT', { tags: ['security'] });
    expect(store.search('ns', 'JWT')[0].tags).toEqual(['security']);
  });

  // ── Namespace isolation ───────────────────────────────────────────────────

  it('entries in different namespaces are isolated', () => {
    store.store('ns-a', 'key', 'alpha');
    store.store('ns-b', 'key', 'beta');
    expect(store.retrieve('ns-a', 'key')).toBe('alpha');
    expect(store.retrieve('ns-b', 'key')).toBe('beta');
  });

  it('list() only returns entries for the requested namespace', () => {
    store.store('ns-a', 'k1', 'v1');
    store.store('ns-b', 'k2', 'v2');
    expect(store.list('ns-a')).toHaveLength(1);
    expect(store.list('ns-b')).toHaveLength(1);
  });

  // ── search() ─────────────────────────────────────────────────────────────

  it('search matches on key substring', () => {
    store.store('ns', 'auth-strategy', 'JWT');
    store.store('ns', 'db-choice', 'PostgreSQL');
    const results = store.search('ns', 'auth');
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('auth-strategy');
  });

  it('search matches on value substring', () => {
    store.store('ns', 'k1', 'JWT with 15-min expiry');
    store.store('ns', 'k2', 'PostgreSQL 16');
    const results = store.search('ns', 'JWT');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('JWT with 15-min expiry');
  });

  it('search respects the limit parameter', () => {
    for (let i = 0; i < 10; i++) store.store('ns', `key-${i}`, `value-${i}`);
    expect(store.search('ns', 'value', 3)).toHaveLength(3);
  });

  it('search returns empty array when nothing matches', () => {
    store.store('ns', 'key', 'value');
    expect(store.search('ns', 'zzz-no-match')).toHaveLength(0);
  });

  // ── delete() ─────────────────────────────────────────────────────────────

  it('delete removes a specific key and returns true', () => {
    store.store('ns', 'key', 'v');
    expect(store.delete('ns', 'key')).toBe(true);
    expect(store.retrieve('ns', 'key')).toBeNull();
  });

  it('delete returns false for a key that does not exist', () => {
    expect(store.delete('ns', 'ghost')).toBe(false);
  });

  it('delete does not affect other keys in the same namespace', () => {
    store.store('ns', 'a', '1');
    store.store('ns', 'b', '2');
    store.delete('ns', 'a');
    expect(store.retrieve('ns', 'b')).toBe('2');
  });

  // ── clear() ───────────────────────────────────────────────────────────────

  it('clear removes all entries in a namespace and returns the count', () => {
    store.store('ns', 'a', '1');
    store.store('ns', 'b', '2');
    expect(store.clear('ns')).toBe(2);
    expect(store.list('ns')).toHaveLength(0);
  });

  it('clear does not affect other namespaces', () => {
    store.store('ns', 'a', '1');
    store.store('other', 'b', '2');
    store.clear('ns');
    expect(store.list('other')).toHaveLength(1);
  });

  it('clear returns 0 when the namespace is already empty', () => {
    expect(store.clear('empty-ns')).toBe(0);
  });

  // ── Importance scoring ────────────────────────────────────────────────────

  it('importance defaults to 3 when not provided', () => {
    store.store('ns', 'key', 'value');
    expect(store.list('ns')[0].importance).toBe(3);
  });

  it('stores and returns the specified importance', () => {
    store.store('ns', 'key', 'value', { importance: 5 });
    expect(store.list('ns')[0].importance).toBe(5);
  });

  it('clamps importance below 1 to 1', () => {
    store.store('ns', 'key', 'value', { importance: 0 });
    expect(store.list('ns')[0].importance).toBe(1);
  });

  it('clamps importance above 5 to 5', () => {
    store.store('ns', 'key', 'value', { importance: 99 });
    expect(store.list('ns')[0].importance).toBe(5);
  });

  it('upsert refreshes importance', () => {
    store.store('ns', 'key', 'value', { importance: 2 });
    store.store('ns', 'key', 'value', { importance: 5 });
    expect(store.list('ns')[0].importance).toBe(5);
  });

  it('list() orders by importance DESC then created_at DESC', () => {
    store.store('ns', 'low',  'v', { importance: 1 });
    store.store('ns', 'high', 'v', { importance: 5 });
    store.store('ns', 'mid',  'v', { importance: 3 });
    const keys = store.list('ns').map(e => e.key);
    expect(keys).toEqual(['high', 'mid', 'low']);
  });

  it('search() orders by importance DESC then created_at DESC', () => {
    store.store('ns', 'b', 'match', { importance: 2 });
    store.store('ns', 'a', 'match', { importance: 4 });
    const keys = store.search('ns', 'match').map(e => e.key);
    expect(keys).toEqual(['a', 'b']);
  });

  it('search() results include importance', () => {
    store.store('ns', 'key', 'value', { importance: 4 });
    expect(store.search('ns', 'value')[0].importance).toBe(4);
  });

  // ── Tag filtering ─────────────────────────────────────────────────────────

  it('list() with filterTags returns only entries with a matching tag', () => {
    store.store('ns', 'arch', 'v', { tags: ['architecture'] });
    store.store('ns', 'cfg',  'v', { tags: ['config'] });
    store.store('ns', 'dec',  'v', { tags: ['decision'] });
    const keys = store.list('ns', ['architecture', 'decision']).map(e => e.key).sort();
    expect(keys).toEqual(['arch', 'dec']);
  });

  it('list() with filterTags excludes entries with no matching tag', () => {
    store.store('ns', 'match',   'v', { tags: ['code'] });
    store.store('ns', 'no-match','v', { tags: ['config'] });
    expect(store.list('ns', ['code'])).toHaveLength(1);
    expect(store.list('ns', ['code'])[0].key).toBe('match');
  });

  it('list() without filterTags returns all entries (backward compat)', () => {
    store.store('ns', 'a', 'v', { tags: ['code'] });
    store.store('ns', 'b', 'v', { tags: ['config'] });
    expect(store.list('ns')).toHaveLength(2);
  });

  it('list() with empty filterTags array returns all entries', () => {
    store.store('ns', 'a', 'v', { tags: ['code'] });
    store.store('ns', 'b', 'v', { tags: ['config'] });
    expect(store.list('ns', [])).toHaveLength(2);
  });

  it('list() filterTags matches entry with multiple tags when any tag matches', () => {
    store.store('ns', 'multi', 'v', { tags: ['decision', 'architecture'] });
    expect(store.list('ns', ['architecture'])).toHaveLength(1);
  });

  it('search() with filterTags returns only entries with a matching tag', () => {
    store.store('ns', 'code-fact', 'val', { tags: ['code'] });
    store.store('ns', 'api-fact',  'val', { tags: ['api'] });
    const results = store.search('ns', 'val', 20, ['code']);
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('code-fact');
  });

  it('search() without filterTags returns all matching entries', () => {
    store.store('ns', 'a', 'val', { tags: ['code'] });
    store.store('ns', 'b', 'val', { tags: ['api'] });
    expect(store.search('ns', 'val')).toHaveLength(2);
  });

  // ── Memory types ─────────────────────────────────────────────────────────

  it('type defaults to "fact" when not provided', () => {
    store.store('ns', 'key', 'value');
    expect(store.list('ns')[0].type).toBe('fact');
  });

  it('stores and returns the specified type', () => {
    store.store('ns', 'key', 'value', { type: 'decision' });
    expect(store.list('ns')[0].type).toBe('decision');
  });

  it('upsert refreshes type', () => {
    store.store('ns', 'key', 'value', { type: 'fact' });
    store.store('ns', 'key', 'value', { type: 'decision' });
    expect(store.list('ns')[0].type).toBe('decision');
  });

  it('list() with filterType returns only entries of that type', () => {
    store.store('ns', 'fact-entry',     'v', { type: 'fact' });
    store.store('ns', 'decision-entry', 'v', { type: 'decision' });
    store.store('ns', 'context-entry',  'v', { type: 'context' });
    const keys = store.list('ns', undefined, 'decision').map(e => e.key);
    expect(keys).toEqual(['decision-entry']);
  });

  it('list() without filterType returns all types', () => {
    store.store('ns', 'a', 'v', { type: 'fact' });
    store.store('ns', 'b', 'v', { type: 'decision' });
    store.store('ns', 'c', 'v', { type: 'workflow-state' });
    expect(store.list('ns')).toHaveLength(3);
  });

  it('search() with filterType returns only entries of that type', () => {
    store.store('ns', 'fact-entry',     'match value', { type: 'fact' });
    store.store('ns', 'decision-entry', 'match value', { type: 'decision' });
    const results = store.search('ns', 'match', 20, undefined, 'fact');
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('fact-entry');
  });

  it('search() without filterType returns entries of all types', () => {
    store.store('ns', 'a', 'match', { type: 'fact' });
    store.store('ns', 'b', 'match', { type: 'decision' });
    expect(store.search('ns', 'match')).toHaveLength(2);
  });

  // ── BM25 re-ranking ───────────────────────────────────────────────────────

  it('search() ranks higher-frequency entry above sparse match', () => {
    store.store('ns', 'frequent', 'JWT JWT JWT JWT authentication strategy');
    store.store('ns', 'sparse',   'PostgreSQL JWT connection');
    const results = store.search('ns', 'jwt');
    expect(results[0].key).toBe('frequent');
  });

  it('search() uses importance as tiebreaker for equal BM25 scores', () => {
    store.store('ns', 'low',  'match value', { importance: 1 });
    store.store('ns', 'high', 'match value', { importance: 5 });
    const results = store.search('ns', 'match');
    expect(results[0].key).toBe('high');
  });

  it('search() applies BM25 then respects the limit', () => {
    for (let i = 0; i < 10; i++) store.store('ns', `k-${i}`, 'keyword value');
    expect(store.search('ns', 'keyword', 3)).toHaveLength(3);
  });

  it('search() BM25 ranking is not broken by filterTags', () => {
    store.store('ns', 'frequent', 'JWT JWT JWT auth', { tags: ['code'] });
    store.store('ns', 'sparse',   'JWT token',        { tags: ['code'] });
    const results = store.search('ns', 'jwt', 20, ['code']);
    expect(results[0].key).toBe('frequent');
  });
});
