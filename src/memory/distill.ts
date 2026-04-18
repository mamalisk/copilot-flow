/**
 * Post-output memory distillation.
 *
 * After an agent or phase completes, `distillToMemory` fires a small follow-up
 * LLM call that extracts up to 10 key facts from the output and stores them in
 * the memory store under the given namespace and context key.
 *
 * The distillation prompt is loaded from `.github/memory-prompt.md` if it exists,
 * otherwise the built-in prompt is used. This lets teams customise what gets extracted.
 *
 * Facts flagged with `"lesson": true` (importance 4-5 patterns/pitfalls/constraints)
 * are additionally written to .github/lessons/<agentType>.md with no TTL — they survive
 * namespace clears and TTL expiry, and are injected into all future runs for that agent.
 *
 * Failures are always swallowed — distillation is best-effort and must never block
 * the main pipeline.
 */

import { existsSync, readFileSync } from 'fs';
import { runAgentTask } from '../agents/executor.js';
import { getMemoryStore } from './store.js';
import { appendLesson } from './inject.js';
import { output as log } from '../output.js';

const DISTILL_PROMPT_FILE = '.github/memory-prompt.md';

const BUILT_IN_DISTILL_PROMPT = `\
You are a memory extractor for an AI agent pipeline. Given an agent's output, identify \
up to 10 key facts, decisions, or constraints worth retaining for future work on this project.

Rules:
- Each fact must be self-contained (no pronouns or references to "the above" or "this output")
- Values must be 1–2 sentences maximum
- Use tags from this set: decision | constraint | requirement | architecture | code | api | config
- Assign importance 1–5: 5=critical (architecture/security decisions), 4=important (key design choices), 3=notable (standard facts), 2=minor (supporting details), 1=trivial
- If a fact is a cross-session lesson (a pattern, pitfall, or key constraint worth remembering in ALL future runs), add "lesson": true — reserve this for importance 4–5 facts only. Omit the field otherwise.
- Output ONLY a JSON array — no surrounding text, no markdown fences

Example output:
[
  {"key":"auth-strategy","value":"JWT with 15-min expiry, no refresh tokens","tags":["decision","architecture"],"importance":5,"lesson":true},
  {"key":"database","value":"PostgreSQL 16, repository pattern, no ORM","tags":["architecture","constraint"],"importance":4},
  {"key":"db-pool-size","value":"Connection pool set to 20","tags":["config"],"importance":2}
]

Output to distil:
`;

function loadDistillPrompt(): string {
  if (existsSync(DISTILL_PROMPT_FILE)) {
    return readFileSync(DISTILL_PROMPT_FILE, 'utf-8').trim() + '\n\n';
  }
  return BUILT_IN_DISTILL_PROMPT;
}

interface DistilledFact {
  key: string;
  value: string;
  tags?: string[];
  importance?: number;
  lesson?: boolean;
}

/**
 * Find the outermost JSON array in a string using bracket counting.
 * A non-greedy regex like /\[[\s\S]*?\]/ would match the first *inner*
 * array (e.g. a tags array ["code"]) rather than the outer facts array.
 */
export function extractOutermostArray(text: string): string | null {
  const start = text.indexOf('[');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Extract key facts from `output` and store them under `namespace`.
 *
 * @param output      The full text output from an agent/phase.
 * @param namespace   Memory namespace (e.g. the value of --memory-namespace).
 * @param contextKey  Prefix for each stored key (e.g. "phase:research", "task:task-2").
 * @param model       Model to use for the distillation call.
 * @param ttlMs       Time-to-live for stored facts (default: 30 days).
 * @param agentType   Agent type that produced the output — used to scope lesson files.
 *                    Defaults to '_global' (cross-agent lessons file).
 */
export async function distillToMemory(
  output: string,
  namespace: string,
  contextKey: string,
  model: string,
  ttlMs = 30 * 24 * 60 * 60 * 1000,
  agentType = '_global',
): Promise<void> {
  try {
    const prompt = loadDistillPrompt() + output;
    const result = await runAgentTask('analyst', prompt, { model });
    if (!result.success) return;

    // Extract the outermost JSON array from the response.
    // Bracket-counting avoids the bug where a non-greedy regex would match
    // an inner tag array (e.g. ["code"]) before the outer facts array.
    const raw = extractOutermostArray(result.output);
    if (!raw) return;

    const facts = JSON.parse(raw) as DistilledFact[];
    if (!Array.isArray(facts)) return;

    const store = getMemoryStore();
    for (const fact of facts) {
      if (typeof fact.key !== 'string' || typeof fact.value !== 'string') continue;

      const isLesson = fact.lesson === true;
      const importance = typeof fact.importance === 'number' ? fact.importance : undefined;

      store.store(
        namespace,
        `${contextKey}:${fact.key}`,
        fact.value,
        {
          // Lessons are stored permanently (no TTL) so they survive namespace clears
          ttlMs: isLesson ? undefined : ttlMs,
          tags: [
            ...(Array.isArray(fact.tags) ? fact.tags : []),
            ...(isLesson ? ['lesson'] : []),
          ],
          importance,
          type: isLesson ? 'decision' : undefined,
        },
      );

      // Promote to permanent lesson file — survives TTL and memory clear
      if (isLesson) {
        appendLesson(agentType, `${contextKey}:${fact.key}`, fact.value);
      }
    }
  } catch (err) {
    // Best-effort: distillation failures must never interrupt the main pipeline
    log.dim(`  Memory distillation failed (${namespace}): ${(err as Error).message ?? err}`);
  }
}
