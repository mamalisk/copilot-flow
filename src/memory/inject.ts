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
 *
 * Project identity block:
 *   If .github/memory-identity.md exists in cwd, its content is prepended as
 *   a stable "## Project identity" section before the dynamic facts block.
 *   Use loadIdentityContent() and pass the result as identityContent to
 *   buildMemoryContext — this keeps the function pure and testable.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { MemoryEntry } from '../types.js';
import { getMemoryStore, MemoryStore } from './store.js';

/** Path to the project identity file, relative to cwd. */
export const IDENTITY_FILE = '.github/memory-identity.md';

/**
 * Read the project identity file (.github/memory-identity.md) from cwd.
 * Returns trimmed content, or an empty string if the file does not exist.
 * Pass the result as `identityContent` to buildMemoryContext.
 */
export function loadIdentityContent(cwd = process.cwd()): string {
  const filePath = path.join(cwd, IDENTITY_FILE);
  if (!existsSync(filePath)) return '';
  return readFileSync(filePath, 'utf-8').trim();
}

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
 * @param namespace       The memory namespace to read from.
 * @param filterTags      When provided, a second tag-filtered tier is appended after
 *                        the wake-up block, deduped, within the combined char cap.
 * @param store           Memory store instance (defaults to the process-wide singleton).
 *                        Pass an explicit instance in tests to avoid the singleton.
 * @param identityContent Content of .github/memory-identity.md (call loadIdentityContent()).
 *                        When non-empty, prepended as "## Project identity" before facts.
 * @returns A markdown section string, or empty string if no content exists.
 */
export function buildMemoryContext(
  namespace: string,
  filterTags?: string[],
  store?: MemoryStore,
  identityContent?: string,
): string {
  const s = store ?? getMemoryStore();

  // ── Tier 1: wake-up ────────────────────────────────────────────────────────
  // Always-injected facts, sorted importance DESC then created_at DESC.
  // Fill up to WAKE_UP_CHAR_CAP chars. workflow-state entries are blobs and
  // are excluded from prompt injection.
  const wakeUpLines: string[] = [];
  const wakeUpIds   = new Set<string>();
  let usedChars     = 0;

  for (const e of s.list(namespace)) {
    if (e.type === 'workflow-state') continue; // blobs, not prose facts
    const line = formatEntry(e);
    const cost = line.length + 1; // +1 for the trailing newline
    if (usedChars + cost > WAKE_UP_CHAR_CAP) break;
    wakeUpLines.push(line);
    wakeUpIds.add(e.id);
    usedChars += cost;
  }

  // ── Tier 2: topic ──────────────────────────────────────────────────────────
  // Tag-filtered facts not already in the wake-up block, appended up to
  // TOTAL_CHAR_CAP chars total. workflow-state entries are excluded here too.
  const topicLines: string[] = [];

  if (filterTags != null && filterTags.length > 0) {
    for (const e of s.list(namespace, filterTags)) {
      if (wakeUpIds.has(e.id)) continue; // already in wake-up tier — skip
      if (e.type === 'workflow-state') continue; // blobs, not prose facts
      const line = formatEntry(e);
      const cost = line.length + 1;
      if (usedChars + cost > TOTAL_CHAR_CAP) break;
      topicLines.push(line);
      usedChars += cost;
    }
  }

  const allLines = [...wakeUpLines, ...topicLines];

  const sections: string[] = [];
  if (identityContent) {
    sections.push(`## Project identity\n${identityContent}`);
  }
  if (allLines.length > 0) {
    sections.push(`## Remembered context\n${allLines.join('\n')}`);
  }

  if (sections.length === 0) return '';
  return sections.join('\n\n') + '\n\n';
}
