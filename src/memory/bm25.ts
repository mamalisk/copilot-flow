/**
 * Okapi BM25 relevance scorer for memory search re-ranking.
 *
 * Used by store.search() to rank LIKE-matched candidates by term-frequency
 * relevance rather than insertion order.  Pure TypeScript, no dependencies.
 *
 * Algorithm: Okapi BM25 with standard defaults k1 = 1.5, b = 0.75.
 *   score(d, q) = Σ_t  IDF(t) · TF_norm(t, d)
 *   IDF(t)      = log((N − df(t) + 0.5) / (df(t) + 0.5) + 1)
 *   TF_norm(t)  = tf(t,d) · (k1+1) / (tf(t,d) + k1·(1 − b + b·|d|/avgdl))
 *
 * The corpus text for each MemoryEntry is `key + ' ' + value`.
 */

import type { MemoryEntry } from '../types.js';

const K1 = 1.5;
const B  = 0.75;

/**
 * Tokenise text: lowercase, split on non-alphanumeric characters, drop
 * tokens shorter than 2 characters.
 *
 * Examples:
 *   "JWT 15-min expiry"  → ["jwt", "15", "min", "expiry"]
 *   "node:sqlite WAL"    → ["node", "sqlite", "wal"]
 */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g)?.filter(t => t.length >= 2) ?? [];
}

/**
 * Re-rank `entries` by Okapi BM25 relevance to `queryText`.
 *
 * IDF is computed over the candidate set (the LIKE-filtered rows passed in),
 * not the whole namespace, so common-to-candidates terms are down-weighted.
 *
 * Falls back to `importance DESC` ordering when no query tokens survive
 * tokenisation (e.g. a single-character query).
 *
 * @returns A new array sorted by BM25 score DESC then importance DESC.
 */
export function rankByBm25(queryText: string, entries: MemoryEntry[]): MemoryEntry[] {
  if (entries.length === 0) return entries;

  const queryTokens = [...new Set(tokenize(queryText))]; // deduplicated query terms
  if (queryTokens.length === 0) {
    // No scoreable tokens — fall back to importance order
    return [...entries].sort((a, b) => b.importance - a.importance);
  }

  // ── Build per-document token frequency maps ───────────────────────────────
  type Doc = { entry: MemoryEntry; len: number; freq: Map<string, number> };

  const docs: Doc[] = entries.map(e => {
    const tokens = tokenize(`${e.key} ${e.value}`);
    const freq   = new Map<string, number>();
    for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
    return { entry: e, len: tokens.length, freq };
  });

  const N      = docs.length;
  const avgdl  = docs.reduce((s, d) => s + d.len, 0) / N || 1; // guard /0

  // ── Document frequency per query token ────────────────────────────────────
  const df = new Map<string, number>();
  for (const qt of queryTokens) {
    let count = 0;
    for (const d of docs) if (d.freq.has(qt)) count++;
    df.set(qt, count);
  }

  // ── Score each document ───────────────────────────────────────────────────
  const scored = docs.map(d => {
    const dl = d.len || 1; // guard /0 for empty documents
    let score = 0;

    for (const qt of queryTokens) {
      const tf = d.freq.get(qt) ?? 0;
      if (tf === 0) continue;

      const docFreq = df.get(qt) ?? 0;
      const idf     = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
      const tfNorm  = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (dl / avgdl)));
      score += idf * tfNorm;
    }

    return { entry: d.entry, score };
  });

  // BM25 DESC, importance DESC for ties
  scored.sort((a, b) =>
    b.score !== a.score
      ? b.score - a.score
      : b.entry.importance - a.entry.importance,
  );

  return scored.map(s => s.entry);
}
