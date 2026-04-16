import { Command } from 'commander';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { getMemoryStore } from '../memory/store.js';
import { output, printTable } from '../output.js';

const MEMORY_PROMPT_FILE = '.github/memory-prompt.md';

const DEFAULT_MEMORY_PROMPT = `\
You are a memory extractor for an AI agent pipeline. Given an agent's output, identify \
up to 10 key facts, decisions, or constraints worth retaining for future work on this project.

Rules:
- Each fact must be self-contained (no pronouns or references to "the above" or "this output")
- Values must be 1–2 sentences maximum
- Use tags from this set: decision | constraint | requirement | architecture | code | api | config
- Output ONLY a JSON array — no surrounding text, no markdown fences

Example output:
[
  {"key":"auth-strategy","value":"JWT with 15-min expiry, no refresh tokens","tags":["decision","architecture"]},
  {"key":"database","value":"PostgreSQL 16, repository pattern, no ORM","tags":["architecture","constraint"]}
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
    .action((opts: { namespace: string; key: string; value: string; ttl?: string; tags?: string }) => {
      const store = getMemoryStore();
      store.store(opts.namespace, opts.key, opts.value, {
        ttlMs: opts.ttl != null ? parseInt(opts.ttl, 10) : undefined,
        tags: opts.tags?.split(',').map(t => t.trim()),
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
    .action((opts: { namespace: string; query: string; limit: string }) => {
      const store = getMemoryStore();
      const results = store.search(opts.namespace, opts.query, parseInt(opts.limit, 10));

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
    .action((opts: { namespace: string }) => {
      const store = getMemoryStore();
      const entries = store.list(opts.namespace);

      if (entries.length === 0) {
        output.dim(`No entries in namespace: ${opts.namespace}`);
        return;
      }

      output.header(`Memory: ${opts.namespace} (${entries.length} entries)`);
      for (const entry of entries) {
        output.print(`  ${entry.key}: ${entry.value.slice(0, 60)}${entry.value.length > 60 ? '…' : ''}`);
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

  // ── memory prime ───────────────────────────────────────────────────────────
  memory
    .command('prime')
    .description('Create .github/memory-prompt.md with the default distillation prompt')
    .option('--force', 'Overwrite if the file already exists')
    .action((opts: { force?: boolean }) => {
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
