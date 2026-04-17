/**
 * Memory context injection.
 *
 * `buildMemoryContext` retrieves all non-expired facts stored under a namespace
 * and formats them as a "## Remembered context" section that can be prepended to
 * any agent or phase prompt.
 *
 * Returns an empty string when no memories exist, so callers can safely prepend
 * it unconditionally.
 */

import { getMemoryStore } from './store.js';

const MAX_ENTRIES = 50;

/**
 * Build a formatted memory context section for injection into a prompt.
 *
 * @param namespace  The memory namespace to read from.
 * @returns A markdown section string, or empty string if no memories exist.
 */
export function buildMemoryContext(namespace: string): string {
  const store = getMemoryStore();
  const entries = store.list(namespace).slice(0, MAX_ENTRIES);
  if (entries.length === 0) return '';

  const lines = entries.map(e => {
    const tagSuffix = e.tags.length > 0 ? ` [${e.tags.join(', ')}]` : '';
    // Surface importance only for high-priority entries so the model notices them.
    const importanceBadge = e.importance >= 4 ? ` (importance: ${e.importance})` : '';
    return `• ${e.key}: ${e.value}${tagSuffix}${importanceBadge}`;
  });

  return `## Remembered context\n${lines.join('\n')}\n\n`;
}
