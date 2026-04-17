import { describe, it, expect } from 'vitest';
import { tokenize, rankByBm25 } from '../../src/memory/bm25.js';
import type { MemoryEntry } from '../../src/types.js';

// Minimal MemoryEntry fixture
function entry(key: string, value: string, importance = 3): MemoryEntry {
  return {
    id: `ns:${key}`,
    namespace: 'ns',
    key,
    value,
    tags: [],
    importance,
    type: 'fact',
    createdAt: Date.now(),
  };
}

// ── tokenize ─────────────────────────────────────────────────────────────────

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric characters', () => {
    expect(tokenize('Hello World!')).toEqual(['hello', 'world']);
  });

  it('drops tokens shorter than 2 characters', () => {
    expect(tokenize('a bc def')).toEqual(['bc', 'def']);
  });

  it('returns empty array for an empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('handles numbers and mixed content', () => {
    expect(tokenize('JWT 15-min Node16')).toEqual(['jwt', '15', 'min', 'node16']);
  });

  it('splits on colons (e.g. node:sqlite)', () => {
    expect(tokenize('node:sqlite WAL')).toEqual(['node', 'sqlite', 'wal']);
  });
});

// ── rankByBm25 ────────────────────────────────────────────────────────────────

describe('rankByBm25', () => {
  it('returns an empty array unchanged', () => {
    expect(rankByBm25('query', [])).toEqual([]);
  });

  it('returns a single-entry array unchanged', () => {
    const e = entry('k', 'some value');
    expect(rankByBm25('value', [e])).toEqual([e]);
  });

  it('ranks the entry with higher term frequency first', () => {
    const frequent = entry('auth',     'JWT JWT JWT JWT authentication strategy');
    const sparse   = entry('db',       'PostgreSQL JWT connection pool');
    const [first]  = rankByBm25('jwt', [sparse, frequent]);
    expect(first.key).toBe('auth');
  });

  it('ranks entry matching in both key and value above entry matching value only', () => {
    const keyAndValue = entry('jwt-auth', 'JWT token strategy');
    const valueOnly   = entry('security', 'JWT token strategy');
    const [first]     = rankByBm25('jwt', [valueOnly, keyAndValue]);
    expect(first.key).toBe('jwt-auth');
  });

  it('uses importance DESC as tiebreaker when BM25 scores are equal', () => {
    const low  = entry('a', 'match value', 1);
    const high = entry('b', 'match value', 5);
    // Identical text → identical BM25 score → importance decides
    const [first] = rankByBm25('match', [low, high]);
    expect(first.key).toBe('b');
  });

  it('falls back to importance sort when query has no scoreable tokens', () => {
    // Single-char query "a" is filtered out by tokenize → queryTokens = []
    const low  = entry('first',  'value', 1);
    const high = entry('second', 'value', 5);
    const [first] = rankByBm25('a', [low, high]);
    expect(first.key).toBe('second');
  });

  it('returns all entries (does not drop non-matching ones)', () => {
    const match   = entry('k1', 'JWT auth');
    const noMatch = entry('k2', 'PostgreSQL database');
    const result  = rankByBm25('jwt', [noMatch, match]);
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('k1');
  });

  it('handles multi-token query — entry matching all tokens ranks above partial match', () => {
    const full    = entry('full',    'JWT authentication token strategy');
    const partial = entry('partial', 'JWT only');
    const [first] = rankByBm25('jwt authentication', [partial, full]);
    expect(first.key).toBe('full');
  });
});
