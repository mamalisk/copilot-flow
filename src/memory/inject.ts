/**
 * Memory context injection — two-tier layered approach.
 *
 * Tier 1 — Wake-up (always injected):
 *   Top facts sorted by importance DESC, hard-capped at WAKE_UP_CHAR_CAP chars
 *   (~800 tokens). Every phase receives these regardless of contextTags.
 *
 * Tier 2 — Topic (injected when filterTags are set):
 *   Tag-filtered facts appended after the wake-up block, deduped against it,
 *   until the combined output reaches TOTAL_CHAR_CAP chars (~1,200 tokens).
 *
 * Both caps use character counts as a token proxy (1 token ≈ 4 chars).
 * Returns an empty string when no memories exist so callers can prepend
 * the result unconditionally.
 */

import type { MemoryEntry } from '../types.js';
import { getMemoryStore, MemoryStore } from './store.js';

/** Wake-up tier hard cap in characters (~800 tokens). */
export const WAKE_UP_CHAR_CAP = 3_200;
/** Combined tier cap in characters (~1,200 tokens). */
export const TOTAL_CHAR_CAP   = 4_800;

function formatEntry(e: MemoryEntry): string {
  const tagSuffix      = e.tags.length > 0   ? ` [${e.tags.join(', ')}]`     : '';
  const importanceBadge = e.importance >= 4  ? ` (importance: ${e.importance})` : '';
  return `• ${e.key}: ${e.value}${tagSuffix}${importanceBadge}`;
}

/**
 * Build a formatted memory context section for injection into a prompt.
 *
 * @param namespace   The memory namespace to read from.
 * @param filterTags  When provided, a second tag-filtered tier is appended after
 *                    the wake-up block, deduped, within the combined char cap.
 * @param store       Memory store instance (defaults to the process-wide singleton).
 *                    Pass an explicit instance in tests to avoid the singleton.
 * @returns A markdown section string, or empty string if no memories exist.
 */
export function buildMemoryContext(
  namespace: string,
  filterTags?: string[],
  store?: MemoryStore,
): string {
  const s = store ?? getMemoryStore();

  // ── Tier 1: wake-up ────────────────────────────────────────────────────────
  // Always-injected facts, sorted importance DESC then created_at DESC.
  // Fill up to WAKE_UP_CHAR_CAP chars.
  const wakeUpLines: string[] = [];
  const wakeUpIds   = new Set<string>();
  let usedChars     = 0;

  for (const e of s.list(namespace)) {
    const line = formatEntry(e);
    const cost = line.length + 1; // +1 for the trailing newline
    if (usedChars + cost > WAKE_UP_CHAR_CAP) break;
    wakeUpLines.push(line);
    wakeUpIds.add(e.id);
    usedChars += cost;
  }

  // ── Tier 2: topic ──────────────────────────────────────────────────────────
  // Tag-filtered facts not already in the wake-up block, appended up to
  // TOTAL_CHAR_CAP chars total.
  const topicLines: string[] = [];

  if (filterTags != null && filterTags.length > 0) {
    for (const e of s.list(namespace, filterTags)) {
      if (wakeUpIds.has(e.id)) continue; // already in wake-up tier — skip
      const line = formatEntry(e);
      const cost = line.length + 1;
      if (usedChars + cost > TOTAL_CHAR_CAP) break;
      topicLines.push(line);
      usedChars += cost;
    }
  }

  const allLines = [...wakeUpLines, ...topicLines];
  if (allLines.length === 0) return '';

  return `## Remembered context\n${allLines.join('\n')}\n\n`;
}
