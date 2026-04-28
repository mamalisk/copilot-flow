import { Command } from 'commander';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { getMemoryStore } from '../memory/store.js';
import { lintMemory } from '../memory/lint.js';
import { appendLesson } from '../memory/inject.js';
import { output, printTable } from '../output.js';
import { loadConfig } from '../config.js';
import type { MemoryEntry, MemoryType } from '../types.js';

const MEMORY_PROMPT_FILE = '.github/memory-prompt.md';

const DEFAULT_MEMORY_PROMPT = `\
You are a memory extractor for an AI agent pipeline. Given an agent's output, identify \
up to 10 key facts, decisions, or constraints worth retaining for future work on this project.

Rules:
- Each fact must be self-contained (no pronouns or references to "the above" or "this output")
- Values must be 1–2 sentences maximum
- Use tags from this set: decision | constraint | requirement | architecture | code | api | config
- Assign importance 1–5: 5=critical (architecture/security decisions), 4=important (key design choices), 3=notable (standard facts), 2=minor (supporting details), 1=trivial
- Output ONLY a JSON array — no surrounding text, no markdown fences

Example output:
[
  {"key":"auth-strategy","value":"JWT with 15-min expiry, no refresh tokens","tags":["decision","architecture"],"importance":5},
  {"key":"database","value":"PostgreSQL 16, repository pattern, no ORM","tags":["architecture","constraint"],"importance":4}
]

Output to distil:
`;

export function registerMemory(program: Command): void {
  const memory = program.command('memory').description('Manage the namespaced memory store');

  // ── memory store ───────────────────────────────────────────────────────────
  memory
    .command('store')
    .description('Store a value in memory')
    .requiredOption('--namespace <ns>', 'Memory namespace')
    .requiredOption('--key <key>', 'Entry key')
    .requiredOption('--value <value>', 'Value to store')
    .option('--ttl <ms>', 'Time-to-live in milliseconds (optional)')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--importance <n>', 'Importance score 1–5 (default 3; 5=critical, 1=trivial)')
    .option('--type <type>', 'Memory type: fact | decision | workflow-state | context (default: fact)')
    .action((opts: { namespace: string; key: string; value: string; ttl?: string; tags?: string; importance?: string; type?: string }) => {
      const store = getMemoryStore();
      store.store(opts.namespace, opts.key, opts.value, {
        ttlMs: opts.ttl != null ? parseInt(opts.ttl, 10) : undefined,
        tags: opts.tags?.split(',').map(t => t.trim()),
        importance: opts.importance != null ? parseInt(opts.importance, 10) : undefined,
        type: opts.type as MemoryType | undefined,
      });
      output.success(`Stored: ${opts.namespace}/${opts.key}`);
    });

  // ── memory retrieve ────────────────────────────────────────────────────────
  memory
    .command('retrieve')
    .description('Retrieve a value from memory')
    .requiredOption('--namespace <ns>', 'Memory namespace')
    .requiredOption('--key <key>', 'Entry key')
    .action((opts: { namespace: string; key: string }) => {
      const store = getMemoryStore();
      const value = store.retrieve(opts.namespace, opts.key);
      if (value == null) {
        output.warn(`Not found: ${opts.namespace}/${opts.key}`);
        process.exit(1);
      }
      output.print(value);
    });

  // ── memory search ──────────────────────────────────────────────────────────
  memory
    .command('search')
    .description('Search entries in a namespace')
    .requiredOption('--namespace <ns>', 'Memory namespace')
    .requiredOption('--query <query>', 'Search query (substring match on key and value)')
    .option('--limit <n>', 'Max results', '20')
    .option('--type <type>', 'Filter by type: fact | decision | workflow-state | context')
    .action((opts: { namespace: string; query: string; limit: string; type?: string }) => {
      const store = getMemoryStore();
      const results = store.search(opts.namespace, opts.query, parseInt(opts.limit, 10), undefined, opts.type as MemoryType | undefined);

      if (results.length === 0) {
        output.dim('No results found.');
        return;
      }

      output.header(`Search results (${results.length})`);
      for (const entry of results) {
        printTable([
          ['Key', entry.key],
          ['Value', entry.value.slice(0, 100) + (entry.value.length > 100 ? '…' : '')],
          ['Tags', entry.tags.join(', ') || '—'],
          ['Type', entry.type],
          ['Importance', String(entry.importance)],
          ['Created', new Date(entry.createdAt).toISOString()],
        ]);
        output.blank();
      }
    });

  // ── memory list ────────────────────────────────────────────────────────────
  memory
    .command('list')
    .description('List all entries in a namespace')
    .requiredOption('--namespace <ns>', 'Memory namespace')
    .option('--type <type>', 'Filter by type: fact | decision | workflow-state | context')
    .action((opts: { namespace: string; type?: string }) => {
      const store = getMemoryStore();
      const entries = store.list(opts.namespace, undefined, opts.type as MemoryType | undefined);

      if (entries.length === 0) {
        output.dim(`No entries in namespace: ${opts.namespace}`);
        return;
      }

      output.header(`Memory: ${opts.namespace} (${entries.length} entries)`);
      for (const entry of entries) {
        const importanceBadge = entry.importance !== 3 ? ` [${entry.importance}]` : '';
        const typeBadge = entry.type !== 'fact' ? ` (${entry.type})` : '';
        output.print(`  ${entry.key}${importanceBadge}${typeBadge}: ${entry.value.slice(0, 60)}${entry.value.length > 60 ? '…' : ''}`);
      }
    });

  // ── memory delete ──────────────────────────────────────────────────────────
  memory
    .command('delete')
    .description('Delete an entry from memory')
    .requiredOption('--namespace <ns>', 'Memory namespace')
    .requiredOption('--key <key>', 'Entry key')
    .action((opts: { namespace: string; key: string }) => {
      const store = getMemoryStore();
      const deleted = store.delete(opts.namespace, opts.key);
      if (deleted) {
        output.success(`Deleted: ${opts.namespace}/${opts.key}`);
      } else {
        output.warn(`Not found: ${opts.namespace}/${opts.key}`);
      }
    });

  // ── memory clear ───────────────────────────────────────────────────────────
  memory
    .command('clear')
    .description('Delete all entries in a namespace')
    .requiredOption('--namespace <ns>', 'Memory namespace')
    .action((opts: { namespace: string }) => {
      const store = getMemoryStore();
      const count = store.clear(opts.namespace);
      output.success(`Cleared ${count} entries from: ${opts.namespace}`);
    });

  // ── memory lint ───────────────────────────────────────────────────────────
  memory
    .command('lint')
    .description('LLM-powered consolidation: deduplicate, merge, and promote facts in a namespace')
    .requiredOption('--namespace <ns>', 'Memory namespace to lint')
    .option('--dry-run', 'Preview changes without writing anything')
    .option('--model <model>', 'Model to use for the lint pass')
    .action(async (opts: { namespace: string; dryRun?: boolean; model?: string }) => {
      const config = loadConfig();
      const model = opts.model ?? config.defaultModel ?? '';
      const report = await lintMemory(opts.namespace, model, { dryRun: opts.dryRun });
      if (opts.dryRun) {
        output.info('Dry-run complete — no changes written');
      } else {
        output.success(
          `Lint complete: ${report.kept} kept, ${report.deleted} deleted, ` +
          `${report.merged} merged, ${report.updated} updated, ${report.promoted} promoted`,
        );
      }
    });

  // ── memory promote ────────────────────────────────────────────────────────
  memory
    .command('promote')
    .description('Promote stored entries to a permanent lesson file')
    .requiredOption('--namespace <ns>', 'Memory namespace')
    .option('--key <key>', 'Specific entry key to promote')
    .option('--min-importance <n>', 'Promote all entries with importance ≥ n (1–5)', '4')
    .option('--agent-type <type>', 'Target lesson file — agent type or "_global"', '_global')
    .action((opts: { namespace: string; key?: string; minImportance: string; agentType: string }) => {
      const store   = getMemoryStore();
      const minImp  = parseInt(opts.minImportance, 10);
      const entries = store.list(opts.namespace);

      let targets: MemoryEntry[];
      if (opts.key) {
        const match = entries.find(e => e.key === opts.key);
        if (!match) { output.warn(`Not found: ${opts.namespace}/${opts.key}`); process.exit(1); }
        targets = [match];
      } else {
        targets = entries.filter(e => e.importance >= minImp && e.type !== 'workflow-state');
      }

      if (targets.length === 0) { output.warn('No entries matched.'); return; }

      for (const e of targets) {
        appendLesson(opts.agentType, e.key, e.value);
        output.success(`Promoted → .github/lessons/${opts.agentType}.md: ${e.key}`);
      }
    });

  // ── memory prime (deprecated) ──────────────────────────────────────────────
  memory
    .command('prime')
    .description('[DEPRECATED] Use "copilot-flow init" instead, which creates this file automatically')
    .option('--force', 'Overwrite if the file already exists')
    .action((opts: { force?: boolean }) => {
      output.warn('memory prime is deprecated — run "copilot-flow init" instead.');
      output.dim('  copilot-flow init creates .github/memory-prompt.md, .github/memory-identity.md,');
      output.dim('  and agent prompt files in .github/agents/ automatically.');
      if (existsSync(MEMORY_PROMPT_FILE) && !opts.force) {
        output.warn(`${MEMORY_PROMPT_FILE} already exists. Use --force to overwrite.`);
        return;
      }
      mkdirSync('.github', { recursive: true });
      writeFileSync(MEMORY_PROMPT_FILE, DEFAULT_MEMORY_PROMPT, 'utf-8');
      output.success(`Created ${MEMORY_PROMPT_FILE}`);
      output.dim('  Edit this file to customise what facts are extracted from agent outputs.');
    });
}
