import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { saveConfig, DEFAULT_CONFIG, isInitialised, ensureRuntimeDirs } from '../config.js';
import { output } from '../output.js';
import { AGENT_REGISTRY } from '../agents/registry.js';
import type { AgentType } from '../types.js';

const GITHUB_DIR            = '.github';
const AGENTS_DIR            = '.github/agents';
const LESSONS_DIR           = '.github/lessons';
const SKILLS_DIR            = '.github/skills';
const COPILOT_FLOW_SKILL_DIR = '.github/skills/copilot-flow';
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

/** Template header for per-agent lesson files. */
function agentLessonTemplate(agentType: string): string {
  return `<!-- Lessons learned by the "${agentType}" agent across all runs.
     This file is updated automatically by copilot-flow when agents discover
     patterns, pitfalls, or important constraints during execution.
     You can also add lessons manually using the bullet format below.
     Injected into every "${agentType}" agent prompt as "## Lessons learned".
     Run: copilot-flow memory lint --namespace <ns> --promote  to promote facts here. -->
`;
}

const GLOBAL_LESSON_TEMPLATE = `<!-- Cross-agent lessons — injected into ALL agent prompts as "## Lessons learned".
     Promoted here via: copilot-flow memory lint --namespace <ns> (promote action).
     Add lessons manually in bullet format:
     - **topic**: description *(YYYY-MM-DD)* -->
`;

const SKILL_TEMPLATE = `# Skills

<!--
  This directory contains SKILL.md files that agents can invoke as tools.
  Each skill file describes a repeatable procedure the agent can follow.

  Format: each file should have a YAML frontmatter block followed by markdown body.

  Example — .github/skills/deploy-staging/SKILL.md:
  ---
  name: deploy-staging
  description: Deploy the current branch to the staging environment
  ---
  1. Run: npm run build
  2. Run: npm run deploy:staging
  3. Verify at https://staging.example.com
  4. Post result to #deployments Slack channel

  Register skill directories with:
    copilot-flow exec plan.yaml --skill-dir .github/skills
-->
`;

const COPILOT_FLOW_SKILL = `---
name: copilot-flow
description: >
  How to use the copilot-flow multi-agent orchestration framework —
  commands, memory system, phase YAML format, and adaptive learning.
---

# copilot-flow skill

## Core commands

### Plan & execute a phased pipeline
\`\`\`bash
# 1. Generate a phase plan from a spec file
copilot-flow plan prd.md

# 2. Execute the plan (phases run in dependency order; independent phases run in parallel)
copilot-flow exec .copilot-flow/plans/prd-<timestamp>/phases.yaml \\
  --memory-namespace my-project
\`\`\`

### Run a single agent task
\`\`\`bash
copilot-flow agent spawn --type coder --task "Implement user auth with JWT"
copilot-flow agent spawn --type researcher --task "Survey competing auth libraries"
\`\`\`

### Run a swarm (multi-agent, single task)
\`\`\`bash
copilot-flow swarm run --task "Build the checkout flow" \\
  --topology hierarchical --agents coder,tester,reviewer
\`\`\`

---

## phases.yaml format

\`\`\`yaml
version: "1"
spec: prd.md
phases:
  - id: research
    type: agent
    agentType: researcher
    description: Investigate domain and constraints.

  - id: design
    type: agent
    agentType: architect
    description: Produce system design and API contracts.
    dependsOn: [research]

  - id: implement
    type: swarm
    topology: hierarchical
    agents: [coder, tester]
    description: Implement and test the feature.
    dependsOn: [design]
    acceptanceCriteria: >
      All public functions have tests; no TypeScript errors.
    maxAcceptanceRetries: 2
    contextTags: [code, architecture]   # only these memory tags injected

  - id: review
    type: agent
    agentType: reviewer
    description: Final quality and security review.
    dependsOn: [implement]
    model: gpt-4o                       # per-phase model override
\`\`\`

### Key phase fields
| Field | Description |
|-------|-------------|
| \`type\` | \`agent\` (single specialist) or \`swarm\` (multi-agent) |
| \`agentType\` | Built-in type: coder, researcher, tester, reviewer, architect, coordinator, analyst, debugger, documenter, optimizer, security-auditor, performance-engineer, orchestrator, product-manager |
| \`topology\` | \`hierarchical\` \\| \`sequential\` \\| \`mesh\` (swarm phases only) |
| \`dependsOn\` | Phase IDs that must complete first; omit to run in the first wave |
| \`acceptanceCriteria\` | Natural-language pass/fail criteria; triggers re-runs on failure |
| \`maxAcceptanceRetries\` | Extra attempts on acceptance failure (default 2) |
| \`contextTags\` | Filter memory injection to specific tags (reduces context noise) |
| \`model\` | Per-phase model override |

---

## Memory system

### Store a fact or decision
\`\`\`bash
copilot-flow memory store \\
  --namespace my-project \\
  --key auth-strategy \\
  --value "JWT 15-min expiry, no refresh tokens" \\
  --type decision \\
  --importance 5 \\
  --ttl 2592000000    # 30 days in ms (omit for permanent)
\`\`\`

**Memory types**: \`fact\` (default) | \`decision\` | \`context\` | \`workflow-state\` (never injected into prompts)

**Importance scale**: 5 = critical · 4 = important · 3 = notable · 2 = minor · 1 = trivial

**Tags** (for contextTags filtering): \`decision\` | \`constraint\` | \`requirement\` | \`architecture\` | \`code\` | \`api\` | \`config\`

### Retrieve / search
\`\`\`bash
copilot-flow memory retrieve --namespace my-project --key auth-strategy
copilot-flow memory search  --namespace my-project --query "authentication"
copilot-flow memory list    --namespace my-project --type decision
\`\`\`

### Consolidate with lint
\`\`\`bash
copilot-flow memory lint --namespace my-project --dry-run   # preview
copilot-flow memory lint --namespace my-project             # apply
\`\`\`
Lint deduplicates facts, merges related entries, and promotes critical lessons to \`.github/lessons/_global.md\`.

---

## Adaptive learning — two-track persistence

| Store | Lifetime | Contents |
|-------|----------|----------|
| \`.copilot-flow/memory.db\` (SQLite) | 30-day TTL (default) | Distilled facts, decisions, context |
| \`.github/lessons/<agentType>.md\` | Permanent (git-tracked) | Patterns, pitfalls, recovery lessons |

Facts distilled from successful runs are stored in SQLite. When the distillation model flags a fact as a lesson (importance 4–5, \`"lesson": true\`), it is also appended permanently to the agent's lesson file.

Acceptance failures and exhausted retries are also written to lesson files automatically.

### Prompt injection order (when --memory-namespace is active)
\`\`\`
## Project identity      ← .github/memory-identity.md (static brief)
## Lessons learned       ← .github/lessons/<agentType>.md + _global.md
## Remembered context    ← SQLite facts (importance-ranked, tag-filtered)
\`\`\`

---

## Initialise a new project
\`\`\`bash
copilot-flow init
\`\`\`
Creates: \`.copilot-flow/config.json\`, \`.github/memory-identity.md\`, \`.github/agents/<type>.md\` (14 agent prompts), \`.github/lessons/<type>.md\` (14 lesson files + \`_global.md\`), \`.github/skills/copilot-flow/SKILL.md\`.

Edit \`.github/memory-identity.md\` to describe your project — it is injected into every agent prompt.
Edit any \`.github/agents/<type>.md\` to customise a specific agent's system prompt without rebuilding.
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
        const content = `---\nname: ${type}\ndescription: ${def.description}\n---\n${def.systemMessage}\n`;
        if (writeIfAbsent(filePath, content)) {
          agentsCreated++;
        }
      }
      if (agentsCreated > 0) {
        output.dim(`  Created ${agentsCreated} agent prompt(s) in ${AGENTS_DIR}/`);
        output.dim('  Edit any .md file to customise that agent\'s system prompt');
      } else {
        output.dim(`  Skipped agent prompts in ${AGENTS_DIR}/ (already exist)`);
      }

      // ── Lessons files ──────────────────────────────────────────────────────
      fs.mkdirSync(LESSONS_DIR, { recursive: true });
      let lessonsCreated = 0;
      for (const type of Object.keys(AGENT_REGISTRY) as AgentType[]) {
        const filePath = path.join(LESSONS_DIR, `${type}.md`);
        if (writeIfAbsent(filePath, agentLessonTemplate(type))) {
          lessonsCreated++;
        }
      }
      if (writeIfAbsent(path.join(LESSONS_DIR, '_global.md'), GLOBAL_LESSON_TEMPLATE)) {
        lessonsCreated++;
      }
      if (lessonsCreated > 0) {
        output.dim(`  Created ${lessonsCreated} lesson file(s) in ${LESSONS_DIR}/`);
        output.dim('  Lessons are written here automatically as agents learn from runs');
      } else {
        output.dim(`  Skipped lesson files in ${LESSONS_DIR}/ (already exist)`);
      }

      // ── Skills scaffold ────────────────────────────────────────────────────
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
      fs.mkdirSync(COPILOT_FLOW_SKILL_DIR, { recursive: true });
      let skillsCreated = 0;
      if (writeIfAbsent(path.join(SKILLS_DIR, 'README.md'), SKILL_TEMPLATE)) skillsCreated++;
      if (writeIfAbsent(path.join(COPILOT_FLOW_SKILL_DIR, 'SKILL.md'), COPILOT_FLOW_SKILL)) skillsCreated++;
      if (skillsCreated > 0) {
        output.dim(`  Created ${skillsCreated} skill file(s) in ${SKILLS_DIR}/`);
        output.dim('  Add your own SKILL.md files in subdirectories of .github/skills/');
      } else {
        output.dim(`  Skipped ${SKILLS_DIR}/ (already exists)`);
      }

      output.success('Initialised copilot-flow');
      output.blank();
      output.print('  Config:   .copilot-flow/config.json');
      output.print('  Memory:   .copilot-flow/memory.db');
      output.print('  Identity: .github/memory-identity.md');
      output.print('  Prompts:  .github/memory-prompt.md');
      output.print('  Agents:   .github/agents/');
      output.print('  Lessons:  .github/lessons/');
      output.print('  Skills:   .github/skills/');
      output.print('  Plans:    .copilot-flow/plans/');
      output.blank();
      output.dim('Next: copilot-flow agent spawn --type coder --task "Your task"');
    });
}
