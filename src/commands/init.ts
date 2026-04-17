import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { saveConfig, DEFAULT_CONFIG, isInitialised, ensureRuntimeDirs } from '../config.js';
import { output } from '../output.js';
import { AGENT_REGISTRY } from '../agents/registry.js';
import type { AgentType } from '../types.js';

const GITHUB_DIR       = '.github';
const AGENTS_DIR       = '.github/agents';
const IDENTITY_FILE    = '.github/memory-identity.md';
const MEMORY_PROMPT    = '.github/memory-prompt.md';

const DEFAULT_IDENTITY = `\
# Project Identity

<!--
  This file is prepended to every memory-injected prompt, regardless of namespace.
  Keep it under 200 words so it does not crowd out dynamic memory facts.
  Agents read this on every run — it has no TTL and is never distilled.
-->

## Project name
<!-- e.g. TripMind -->

## Purpose
<!-- One sentence: what does this project do and for whom? -->

## Tech stack
<!-- e.g. Next.js 14, Prisma, PostgreSQL, Tailwind CSS -->

## Key constraints
<!-- e.g. TypeScript strict mode, tests required for all changes -->

## Team conventions
<!-- e.g. feature branches, PRs require approval, conventional commits -->
`;

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

/** Write a file only if it does not already exist. Returns true when written. */
function writeIfAbsent(filePath: string, content: string): boolean {
  if (fs.existsSync(filePath)) return false;
  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Initialise copilot-flow in the current directory')
    .option('--model <model>', 'Default model to use', DEFAULT_CONFIG.defaultModel)
    .option('--max-agents <n>', 'Maximum concurrent agents', String(DEFAULT_CONFIG.swarm.maxAgents))
    .option('--topology <type>', 'Swarm topology (hierarchical|mesh|sequential)', DEFAULT_CONFIG.swarm.topology)
    .action((opts: { model: string; maxAgents: string; topology: string }) => {
      if (isInitialised()) {
        output.warn('.copilot-flow/config.json already exists. Re-initialising...');
      }

      const config = {
        ...DEFAULT_CONFIG,
        defaultModel: opts.model,
        swarm: {
          ...DEFAULT_CONFIG.swarm,
          topology: opts.topology as typeof DEFAULT_CONFIG.swarm.topology,
          maxAgents: parseInt(opts.maxAgents, 10),
        },
      };

      ensureRuntimeDirs();
      saveConfig(config);

      // ── .gitignore ─────────────────────────────────────────────────────────
      const gitignorePath = path.join(process.cwd(), '.gitignore');
      const entry = '.copilot-flow/';
      if (fs.existsSync(gitignorePath)) {
        const existing = fs.readFileSync(gitignorePath, 'utf-8');
        if (!existing.includes(entry)) {
          fs.appendFileSync(gitignorePath, `\n${entry}\n`, 'utf-8');
          output.dim('  .gitignore updated: added .copilot-flow/');
        }
      } else {
        fs.writeFileSync(gitignorePath, `${entry}\n`, 'utf-8');
        output.dim('  .gitignore created: added .copilot-flow/');
      }

      // ── .github/ scaffold ──────────────────────────────────────────────────
      fs.mkdirSync(GITHUB_DIR, { recursive: true });
      fs.mkdirSync(AGENTS_DIR, { recursive: true });

      if (writeIfAbsent(IDENTITY_FILE, DEFAULT_IDENTITY)) {
        output.dim(`  Created ${IDENTITY_FILE} — edit to describe your project`);
      } else {
        output.dim(`  Skipped ${IDENTITY_FILE} (already exists)`);
      }

      if (writeIfAbsent(MEMORY_PROMPT, DEFAULT_MEMORY_PROMPT)) {
        output.dim(`  Created ${MEMORY_PROMPT} — edit to customise distillation`);
      } else {
        output.dim(`  Skipped ${MEMORY_PROMPT} (already exists)`);
      }

      // ── Agent prompt files ─────────────────────────────────────────────────
      let agentsCreated = 0;
      for (const [type, def] of Object.entries(AGENT_REGISTRY) as [AgentType, typeof AGENT_REGISTRY[AgentType]][]) {
        const filePath = path.join(AGENTS_DIR, `${type}.md`);
        if (writeIfAbsent(filePath, def.systemMessage + '\n')) {
          agentsCreated++;
        }
      }
      if (agentsCreated > 0) {
        output.dim(`  Created ${agentsCreated} agent prompt(s) in ${AGENTS_DIR}/`);
        output.dim('  Edit any .md file to customise that agent\'s system prompt');
      } else {
        output.dim(`  Skipped agent prompts in ${AGENTS_DIR}/ (already exist)`);
      }

      output.success('Initialised copilot-flow');
      output.blank();
      output.print('  Config:   .copilot-flow/config.json');
      output.print('  Memory:   .copilot-flow/memory.db');
      output.print('  Identity: .github/memory-identity.md');
      output.print('  Prompts:  .github/memory-prompt.md');
      output.print('  Agents:   .github/agents/');
      output.print('  Plans:    .copilot-flow/plans/');
      output.blank();
      output.dim('Next: copilot-flow agent spawn --type coder --task "Your task"');
    });
}
