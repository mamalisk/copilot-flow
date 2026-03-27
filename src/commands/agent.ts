import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { Command } from 'commander';
import matter from 'gray-matter';
import { runAgentTask } from '../agents/executor.js';
import { agentPool } from '../agents/pool.js';
import { listAgentTypes, routeTask } from '../agents/registry.js';
import { output, agentBadge, printTable, setLogLevel, withSpinner } from '../output.js';
import { loadConfig } from '../config.js';
import type { AgentType } from '../types.js';
import type { BackoffStrategy } from '../core/retry.js';
import type { CustomAgentConfig } from '@github/copilot-sdk';

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Read repo instructions from disk. Returns undefined if disabled or not found. */
function resolveInstructions(flag: string | undefined, disabled: boolean, configFile: string, autoLoad: boolean): string | undefined {
  if (disabled) return undefined;
  const filePath = flag ?? (autoLoad ? configFile : undefined);
  if (!filePath) return undefined;
  if (existsSync(filePath)) return readFileSync(filePath, 'utf-8').trim();
  return undefined;
}

/**
 * Load all *.md custom agent definitions from one or more directories.
 * Each file uses YAML frontmatter for metadata; the markdown body is the prompt.
 *
 * Frontmatter fields:
 *   name        — agent identifier (defaults to filename without .md)
 *   displayName — human-readable label (optional)
 *   description — shown in agent listings (optional)
 *   tools       — list of tool names the agent may use (optional)
 */
function loadAgentsFromDirs(dirs: string[]): CustomAgentConfig[] {
  return dirs.flatMap(dir => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const raw = readFileSync(join(dir, f), 'utf-8');
        const { data, content } = matter(raw);
        return {
          name:        data.name        ?? f.replace(/\.md$/, ''),
          displayName: data.displayName,
          description: data.description,
          tools:       data.tools,
          prompt:      content.trim(),
        } as CustomAgentConfig;
      });
  });
}

export function registerAgent(program: Command): void {
  const agent = program.command('agent').description('Manage Copilot agents');

  // ── agent spawn ────────────────────────────────────────────────────────────
  agent
    .command('spawn')
    .description('Spawn a Copilot agent and run a task')
    .option('--task <task>', 'Task description to run')
    .option('--spec <file>', 'Read task from a markdown/text file (alternative to --task)')
    .option('--output <file>', 'Write result to a markdown file')
    .option('--type <type>', 'Agent type (default: auto-routed from task)')
    .option('--model <model>', 'Override the default model')
    .option('--timeout <ms>', 'Session timeout in ms', '120000')
    .option('--max-retries <n>', 'Maximum retry attempts', '3')
    .option('--retry-delay <ms>', 'Initial retry delay in ms', '1000')
    .option('--retry-strategy <strategy>', 'Backoff strategy (exponential|linear|constant|fibonacci)', 'exponential')
    .option('--no-retry', 'Disable retries')
    .option('--stream', 'Stream output as it arrives')
    .option('--instructions <file>', 'Repo instructions markdown file to inject (default: auto-detects .github/copilot-instructions.md)')
    .option('--no-instructions', 'Disable auto-detection of copilot-instructions.md')
    .option('--skill-dir <path>', 'Directory to scan for SKILL.md files (repeatable)',
      (val, prev: string[]) => [...prev, val], [] as string[])
    .option('--disable-skill <name>', 'Skill name to disable (repeatable)',
      (val, prev: string[]) => [...prev, val], [] as string[])
    .option('--agent-dir <path>', 'Directory of *.json custom agent definitions (repeatable)',
      (val, prev: string[]) => [...prev, val], [] as string[])
    .option('--agent <name>', 'Name of custom agent to activate for this session')
    .option('--verbose', 'Print debug info: session lifecycle, model, prompt size, retries')
    .action(async (opts: {
      task?: string;
      spec?: string;
      output?: string;
      type?: string;
      model?: string;
      timeout: string;
      maxRetries: string;
      retryDelay: string;
      retryStrategy: string;
      retry: boolean;
      stream: boolean;
      instructions?: string;
      noInstructions?: boolean;
      skillDir: string[];
      disableSkill: string[];
      agentDir: string[];
      agent?: string;
      verbose: boolean;
    }) => {
      let task = opts.task ?? '';
      if (opts.spec) {
        task = readFileSync(opts.spec, 'utf-8').trim();
      }
      if (!task) {
        output.error('Provide --task <text> or --spec <file>');
        process.exit(1);
      }

      const config = loadConfig();
      const agentType: AgentType = (opts.type as AgentType | undefined) ?? routeTask(task);

      // Resolve session extensions from flags + config defaults
      const instructionsContent = resolveInstructions(
        opts.instructions,
        opts.noInstructions ?? false,
        config.instructions.file,
        config.instructions.autoLoad,
      );
      const skillDirectories = [
        ...config.skills.directories,
        ...opts.skillDir,
      ].filter(Boolean);
      const disabledSkills = [
        ...config.skills.disabled,
        ...opts.disableSkill,
      ].filter(Boolean);
      const agentDirs = [...config.agents.directories, ...opts.agentDir].filter(Boolean);
      const customAgents = loadAgentsFromDirs(agentDirs);

      if (opts.verbose) setLogLevel('debug');

      output.info(`${agentBadge(agentType)} Running: ${task.slice(0, 80)}`);

      const runTask = () => runAgentTask(agentType, task, {
        model: opts.model ?? config.defaultModel,
        timeoutMs: parseInt(opts.timeout, 10),
        retryConfig: opts.retry === false
          ? { maxAttempts: 1 }
          : {
              maxAttempts: parseInt(opts.maxRetries, 10),
              initialDelayMs: parseInt(opts.retryDelay, 10),
              backoffStrategy: opts.retryStrategy as BackoffStrategy,
            },
        onChunk: opts.stream ? chunk => process.stdout.write(chunk) : undefined,
        instructionsContent,
        skillDirectories: skillDirectories.length ? skillDirectories : undefined,
        disabledSkills: disabledSkills.length ? disabledSkills : undefined,
        customAgents: customAgents.length ? customAgents : undefined,
        agentName: opts.agent,
      });

      // In stream mode output arrives live; in non-stream mode show a spinner so
      // the user knows the agent is active.
      const result = opts.stream || opts.verbose
        ? await runTask()
        : await withSpinner(`${agentBadge(agentType)} Thinking…`, runTask);

      if (opts.stream) output.blank();

      if (result.success) {
        if (!opts.stream) output.print(result.output);
        output.blank();
        output.success(
          `Done in ${result.durationMs}ms` +
          (result.attempts > 1 ? ` (${result.attempts} attempts)` : '')
        );
        if (opts.output) {
          writeFileSync(opts.output, `# Agent Output\n\n${result.output}\n`, 'utf-8');
          output.success(`Result written to ${opts.output}`);
        }
      } else {
        output.error(`Failed: ${result.error}`);
        process.exit(1);
      }
    });

  // ── agent list ─────────────────────────────────────────────────────────────
  agent
    .command('list')
    .description('List agents and their states')
    .option('--type <type>', 'Filter by agent type')
    .option('--status <status>', 'Filter by status (idle|busy|error|terminated)')
    .action((opts: { type?: string; status?: string }) => {
      const agents = agentPool.list({
        type: opts.type as AgentType | undefined,
        status: opts.status as 'idle' | 'busy' | 'error' | 'terminated' | undefined,
      });

      if (agents.length === 0) {
        output.dim('No agents found.');
        return;
      }

      output.header('Active Agents');
      for (const a of agents) {
        printTable([
          ['ID', a.id],
          ['Type', agentBadge(a.type)],
          ['Status', a.status],
          ['Task', a.task?.slice(0, 60) ?? '—'],
          ['Started', new Date(a.startedAt).toISOString()],
        ]);
        output.blank();
      }
    });

  // ── agent types ────────────────────────────────────────────────────────────
  agent
    .command('types')
    .description('List all available agent types')
    .action(() => {
      output.header('Available Agent Types');
      for (const type of listAgentTypes()) {
        output.print(`  ${agentBadge(type)}`);
      }
    });

  // ── agent stop ─────────────────────────────────────────────────────────────
  agent
    .command('stop <id>')
    .description('Mark an agent as terminated')
    .action((id: string) => {
      const agent = agentPool.get(id);
      if (!agent) {
        output.error(`Agent not found: ${id}`);
        process.exit(1);
      }
      agentPool.update(id, { status: 'terminated', completedAt: Date.now() });
      output.success(`Agent ${id} marked as terminated`);
    });
}
