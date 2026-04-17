import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import { existsSync, unlinkSync } from 'fs';
import { MemoryStore } from '../../src/memory/store.js';
import { buildMemoryContext, WAKE_UP_CHAR_CAP, TOTAL_CHAR_CAP } from '../../src/memory/inject.js';

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `inject-test-${Math.random().toString(36).slice(2)}.db`);
}

function removeDb(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = dbPath + suffix;
    if (existsSync(f)) unlinkSync(f);
  }
}

describe('buildMemoryContext — layered injection', () => {
  let store: MemoryStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    store = new MemoryStore(dbPath);
  });

  afterEach(() => {
    store.close();
    removeDb(dbPath);
  });

  // ── Basic behaviour ───────────────────────────────────────────────────────

  it('returns empty string when namespace is empty', () => {
    expect(buildMemoryContext('ns', undefined, store)).toBe('');
  });

  it('returns a ## Remembered context section when entries exist', () => {
    store.store('ns', 'key', 'value');
    expect(buildMemoryContext('ns', undefined, store)).toContain('## Remembered context');
    expect(buildMemoryContext('ns', undefined, store)).toContain('• key: value');
  });

  it('ends with a double newline so callers can prepend unconditionally', () => {
    store.store('ns', 'k', 'v');
    expect(buildMemoryContext('ns', undefined, store)).toMatch(/\n\n$/);
  });

  // ── Importance badge ──────────────────────────────────────────────────────

  it('shows importance badge for entries scoring 4 or 5', () => {
    store.store('ns', 'critical', 'v', { importance: 5 });
    store.store('ns', 'notable',  'v', { importance: 3 });
    const ctx = buildMemoryContext('ns', undefined, store);
    expect(ctx).toContain('(importance: 5)');
    expect(ctx).not.toContain('(importance: 3)');
  });

  // ── Wake-up tier — char cap ───────────────────────────────────────────────

  it('wake-up tier stays within WAKE_UP_CHAR_CAP chars', () => {
    // Each entry: "• key-NN: " + 60 x's = ~72 chars + newline = ~73 chars per entry.
    // 50 entries × 73 = 3,650 chars — exceeds the 3,200-char wake-up cap.
    for (let i = 0; i < 50; i++) {
      store.store('ns', `key-${String(i).padStart(2, '0')}`, 'x'.repeat(60));
    }
    const ctx = buildMemoryContext('ns', undefined, store);
    // Strip the header to measure only the facts section
    const factsOnly = ctx.replace('## Remembered context\n', '').trimEnd();
    expect(factsOnly.length).toBeLessThanOrEqual(WAKE_UP_CHAR_CAP);
  });

  it('wake-up tier orders by importance DESC', () => {
    store.store('ns', 'low',  'v', { importance: 1 });
    store.store('ns', 'high', 'v', { importance: 5 });
    store.store('ns', 'mid',  'v', { importance: 3 });
    const ctx = buildMemoryContext('ns', undefined, store);
    expect(ctx.indexOf('high')).toBeLessThan(ctx.indexOf('mid'));
    expect(ctx.indexOf('mid')).toBeLessThan(ctx.indexOf('low'));
  });

  // ── Topic tier ────────────────────────────────────────────────────────────

  it('topic tier appends tag-filtered entries not in wake-up', () => {
    store.store('ns', 'wake-entry',  'v', { importance: 5 });
    store.store('ns', 'topic-entry', 'v', { importance: 1, tags: ['code'] });
    const ctx = buildMemoryContext('ns', ['code'], store);
    expect(ctx).toContain('wake-entry');
    expect(ctx).toContain('topic-entry');
  });

  it('topic tier does not duplicate entries already in wake-up', () => {
    store.store('ns', 'shared', 'v', { importance: 5, tags: ['code'] });
    const ctx = buildMemoryContext('ns', ['code'], store);
    const occurrences = (ctx.match(/shared/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('without filterTags no topic tier is appended', () => {
    store.store('ns', 'a', 'v', { tags: ['code'] });
    store.store('ns', 'b', 'v', { tags: ['api'] });
    const ctx = buildMemoryContext('ns', undefined, store);
    // Both entries fall into wake-up (small dataset, well within cap)
    expect(ctx).toContain('a');
    expect(ctx).toContain('b');
  });

  it('combined output stays within TOTAL_CHAR_CAP chars', () => {
    // Fill wake-up: 40 entries × ~73 chars ≈ 2,920 chars (under 3,200 cap)
    for (let i = 0; i < 40; i++) {
      store.store('ns', `wake-${String(i).padStart(2, '0')}`, 'x'.repeat(60));
    }
    // Add tag-filtered entries that would push past TOTAL_CHAR_CAP if uncapped
    for (let i = 0; i < 40; i++) {
      store.store('ns', `topic-${String(i).padStart(2, '0')}`, 'x'.repeat(60), { tags: ['code'] });
    }
    const ctx = buildMemoryContext('ns', ['code'], store);
    const factsOnly = ctx.replace('## Remembered context\n', '').trimEnd();
    expect(factsOnly.length).toBeLessThanOrEqual(TOTAL_CHAR_CAP);
  });

  it('namespace isolation — different namespaces do not bleed into each other', () => {
    store.store('ns-a', 'only-a', 'v');
    store.store('ns-b', 'only-b', 'v');
    expect(buildMemoryContext('ns-a', undefined, store)).not.toContain('only-b');
    expect(buildMemoryContext('ns-b', undefined, store)).not.toContain('only-a');
  });
});
