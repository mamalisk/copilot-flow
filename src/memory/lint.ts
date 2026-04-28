/**
 * Memory lint — LLM-powered consolidation of a memory namespace.
 *
 * Sends all non-workflow-state entries to an analyst agent and asks it to:
 *   - Delete true duplicates
 *   - Merge related fact pairs into one richer entry
 *   - Adjust importance scores
 *   - Flag cross-agent lessons for promotion to .github/lessons/_global.md
 *
 * Actions are returned as a JSON array and applied to the store.
 * Pass --dry-run to preview changes without writing.
 */

import { runAgentTask } from '../agents/executor.js';
import { getMemoryStore } from './store.js';
import { appendLesson } from './inject.js';
import { extractOutermostArray } from './distill.js';
import { output as log } from '../output.js';
import type { MemoryEntry, MemoryType } from '../types.js';

// ── Lint action types ─────────────────────────────────────────────────────────

interface LintActionKeep   { action: 'keep';    key: string }
interface LintActionDelete { action: 'delete';  key: string; reason: string }
interface LintActionMerge  {
  action: 'merge';
  into: string;
  absorb: string[];
  value: string;
  importance?: number;
  tags?: string[];
}
interface LintActionUpdate {
  action: 'update';
  key: string;
  value: string;
  importance?: number;
}
interface LintActionPromote { action: 'promote'; key: string; reason: string }

type LintAction =
  | LintActionKeep
  | LintActionDelete
  | LintActionMerge
  | LintActionUpdate
  | LintActionPromote;

export interface LintReport {
  kept: number;
  deleted: number;
  merged: number;
  updated: number;
  promoted: number;
  dryRun: boolean;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const LINT_PROMPT = `\
You are a memory curator for an AI agent pipeline. Given a set of stored facts from a \
memory namespace, perform a full tidy pass.

Rules:
- Identify true duplicates (same meaning, different wording) — keep the better-written one, delete the rest
- Merge related facts that naturally belong together into a single richer entry
- Raise importance to 5 for facts that represent critical cross-session lessons worth remembering always
- Flag entries with tags containing "lesson" or "error-recovery", OR entries with importance 4 or 5, with action "promote" — they belong in permanent storage
- Never delete a fact unless you are certain it is redundant
- Output ONLY a JSON array — no surrounding text, no markdown fences

Action types (all keys are the full stored key strings from the input):
[
  {"action":"keep","key":"..."},
  {"action":"delete","key":"...","reason":"duplicate of X"},
  {"action":"merge","into":"target-key","absorb":["key-a","key-b"],"value":"merged text","importance":4,"tags":["decision"]},
  {"action":"update","key":"...","value":"refined text","importance":5},
  {"action":"promote","key":"...","reason":"critical cross-session lesson"}
]

Every key from the input must appear in exactly one action.

Facts to lint:
`;

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Lint and consolidate all entries in a memory namespace using an LLM analyst.
 *
 * @param namespace  The namespace to lint.
 * @param model      Model to use for the lint pass.
 * @param options    dryRun: preview only; cwd: override process.cwd() for lesson files.
 */
export async function lintMemory(
  namespace: string,
  model: string,
  options: { dryRun?: boolean; cwd?: string } = {},
): Promise<LintReport> {
  const store = getMemoryStore();
  const report: LintReport = { kept: 0, deleted: 0, merged: 0, updated: 0, promoted: 0, dryRun: options.dryRun ?? false };

  // Fetch all non-workflow-state entries
  const entries = store.list(namespace).filter((e: MemoryEntry) => e.type !== 'workflow-state');

  if (entries.length === 0) {
    log.dim(`  memory lint: namespace "${namespace}" is empty — nothing to do`);
    return report;
  }

  // Serialise entries to a compact form for the prompt
  const serialised = entries.map((e: MemoryEntry) => ({
    key:        e.key,
    value:      e.value,
    tags:       e.tags,
    importance: e.importance,
    type:       e.type,
  }));

  const prompt = LINT_PROMPT + JSON.stringify(serialised, null, 2);

  log.dim(`  memory lint: analysing ${entries.length} entries in "${namespace}"…`);
  const result = await runAgentTask('analyst', prompt, { model });

  if (!result.success) {
    log.dim(`  memory lint: analyst call failed — ${result.error}`);
    return report;
  }

  const raw = extractOutermostArray(result.output);
  if (!raw) {
    log.dim('  memory lint: no JSON array found in response');
    return report;
  }

  let actions: LintAction[];
  try {
    actions = JSON.parse(raw) as LintAction[];
    if (!Array.isArray(actions)) throw new Error('not an array');
  } catch {
    log.dim('  memory lint: failed to parse response JSON');
    return report;
  }

  if (options.dryRun) {
    log.dim('  memory lint (dry-run): actions that would be applied:');
    for (const a of actions) {
      switch (a.action) {
        case 'keep':    log.dim(`    keep    ${a.key}`); report.kept++;    break;
        case 'delete':  log.dim(`    delete  ${a.key} — ${a.reason}`); report.deleted++; break;
        case 'merge':   log.dim(`    merge   ${a.absorb.join(', ')} → ${a.into}`); report.merged++; break;
        case 'update':  log.dim(`    update  ${a.key}`); report.updated++; break;
        case 'promote': log.dim(`    promote ${a.key} — ${a.reason}`); report.promoted++; break;
      }
    }
    return report;
  }

  // Apply actions
  for (const a of actions) {
    switch (a.action) {
      case 'keep':
        report.kept++;
        break;

      case 'delete':
        store.delete(namespace, a.key);
        report.deleted++;
        break;

      case 'merge': {
        // Write the merged entry, then delete the absorbed keys
        const existing = entries.find((e: MemoryEntry) => e.key === a.into);
        store.store(namespace, a.into, a.value, {
          importance: a.importance ?? existing?.importance,
          tags: a.tags ?? existing?.tags,
          type: existing?.type as MemoryType | undefined,
        });
        for (const absorbKey of a.absorb) {
          if (absorbKey !== a.into) store.delete(namespace, absorbKey);
        }
        report.merged++;
        break;
      }

      case 'update': {
        const existing = entries.find((e: MemoryEntry) => e.key === a.key);
        store.store(namespace, a.key, a.value, {
          importance: a.importance ?? existing?.importance,
          tags: existing?.tags,
          type: existing?.type as MemoryType | undefined,
        });
        report.updated++;
        break;
      }

      case 'promote': {
        const existing = entries.find((e: MemoryEntry) => e.key === a.key);
        if (existing) {
          appendLesson('_global', a.key, existing.value, options.cwd);
        }
        report.promoted++;
        break;
      }
    }
  }

  return report;
}
