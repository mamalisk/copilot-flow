import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { Command } from 'commander';
import matter from 'gray-matter';
import { runSwarm } from '../swarm/coordinator.js';
import { routeTask } from '../agents/registry.js';
import { output, agentBadge } from '../output.js';
import { loadConfig, saveConfig } from '../config.js';
import type { SwarmTask, SwarmTopology, AgentType, SessionExtensions } from '../types.js';
import type { CustomAgentConfig } from '@github/copilot-sdk';

// ── Shared helpers (duplicated from agent.ts to avoid a shared-commands module) ──

function resolveInstructions(flag: string | undefined, disabled: boolean, configFile: string, autoLoad: boolean): string | undefined {
  if (disabled) return undefined;
  const filePath = flag ?? (autoLoad ? configFile : undefined);
  if (!filePath) return undefined;
  if (existsSync(filePath)) return readFileSync(filePath, 'utf-8').trim();
  return undefined;
}

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

export function registerSwarm(program: Command): void {
  const swarm = program.command('swarm').description('Manage multi-agent swarms');

  // ── swarm init ─────────────────────────────────────────────────────────────
  swarm
    .command('init')
    .description('Configure swarm defaults')
    .option('--topology <type>', 'Topology (hierarchical|mesh|sequential)', 'hierarchical')
    .option('--max-agents <n>', 'Maximum concurrent agents', '8')
    .action((opts: { topology: string; maxAgents: string }) => {
      const config = loadConfig();
      config.swarm.topology = opts.topology as SwarmTopology;
      config.swarm.maxAgents = parseInt(opts.maxAgents, 10);
      saveConfig(config);
      output.success(
        `Swarm configured: topology=${config.swarm.topology}, maxAgents=${config.swarm.maxAgents}`
      );
    });

  // ── swarm start ────────────────────────────────────────────────────────────
  swarm
    .command('start')
    .description('Run a multi-agent swarm for a task')
    .option('--task <task>', 'High-level task to decompose across agents')
    .option('--spec <file>', 'Read task from a markdown/text file (alternative to --task)')
    .option('--output <file>', 'Write swarm results to a markdown file')
    .option('--topology <type>', 'Override topology for this run')
    .option('--agents <list>', 'Comma-separated agent types (e.g. researcher,coder,reviewer)')
    .option('--stream', 'Stream agent outputs as they arrive')
    .option('--max-retries <n>', 'Retry attempts per agent', '3')
    .option('--retry-delay <ms>', 'Initial retry delay in ms', '1000')
    .option('--retry-strategy <strategy>', 'Backoff strategy (exponential|linear|constant|fibonacci)', 'exponential')
    .option('--instructions <file>', 'Repo instructions markdown file to inject (default: auto-detects .github/copilot-instructions.md)')
    .option('--no-instructions', 'Disable auto-detection of copilot-instructions.md')
    .option('--skill-dir <path>', 'Directory to scan for SKILL.md files (repeatable)',
      (val, prev: string[]) => [...prev, val], [] as string[])
    .option('--disable-skill <name>', 'Skill name to disable (repeatable)',
      (val, prev: string[]) => [...prev, val], [] as string[])
    .option('--agent-dir <path>', 'Directory of *.json custom agent definitions (repeatable)',
      (val, prev: string[]) => [...prev, val], [] as string[])
    .option('--agent <name>', 'Name of custom agent to activate for every session in this swarm')
    .action(async (opts: {
      task?: string;
      spec?: string;
      output?: string;
      topology?: string;
      agents?: string;
      stream: boolean;
      maxRetries: string;
      retryDelay: string;
      retryStrategy: string;
      instructions?: string;
      noInstructions?: boolean;
      skillDir: string[];
      disableSkill: string[];
      agentDir: string[];
      agent?: string;
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
      const topology = (opts.topology ?? config.swarm.topology) as SwarmTopology;

      // Resolve session extensions
      const instructionsContent = resolveInstructions(
        opts.instructions,
        opts.noInstructions ?? false,
        config.instructions.file,
        config.instructions.autoLoad,
      );
      const skillDirectories = [...config.skills.directories, ...opts.skillDir].filter(Boolean);
      const disabledSkills   = [...config.skills.disabled,    ...opts.disableSkill].filter(Boolean);
      const agentDirs        = [...config.agents.directories,  ...opts.agentDir].filter(Boolean);
      const customAgents     = loadAgentsFromDirs(agentDirs);

      const sessionOptions: SessionExtensions = {
        instructionsContent:  instructionsContent,
        skillDirectories:     skillDirectories.length  ? skillDirectories  : undefined,
        disabledSkills:       disabledSkills.length    ? disabledSkills    : undefined,
        customAgents:         customAgents.length      ? customAgents      : undefined,
        agentName:            opts.agent,
      };

      const retryConfig = {
        maxAttempts:     parseInt(opts.maxRetries, 10),
        initialDelayMs:  parseInt(opts.retryDelay, 10),
        backoffStrategy: opts.retryStrategy as 'exponential' | 'linear' | 'constant' | 'fibonacci',
      };

      const tasks = buildTaskList(task, opts.agents, retryConfig, sessionOptions);

      output.header(`Swarm: ${topology}`);
      output.dim(`Pipeline: ${tasks.map(t => t.agentType).join(' → ')}`);
      output.blank();

      const results = await runSwarm(tasks, topology, {
        onProgress: opts.stream
          ? (_taskId, agentType, chunk) => {
              process.stdout.write(`${agentBadge(agentType)} ${chunk}`);
            }
          : undefined,
      });

      if (opts.stream) output.blank();
      output.header('Results');
      for (const [taskId, result] of results) {
        const icon = result.success ? '✓' : '✗';
        output.print(
          `${icon} [${taskId}] ${agentBadge(result.agentType)} — ${result.durationMs}ms` +
            (result.attempts > 1 ? ` (${result.attempts} attempts)` : '')
        );
        if (!opts.stream && result.success) {
          output.dim(result.output.slice(0, 200) + (result.output.length > 200 ? '…' : ''));
        } else if (!result.success) {
          output.error(result.error ?? 'Unknown error');
        }
        output.blank();
      }

      if (opts.output) {
        const lines: string[] = ['# Swarm Output\n'];
        for (const [taskId, result] of results) {
          lines.push(`## ${taskId} (${result.agentType})\n`);
          lines.push(result.success ? result.output : `**FAILED**: ${result.error ?? 'unknown'}`);
          lines.push('\n---\n');
        }
        writeFileSync(opts.output, lines.join('\n'), 'utf-8');
        output.success(`Results written to ${opts.output}`);
      }
    });

  // ── swarm status ───────────────────────────────────────────────────────────
  swarm
    .command('status')
    .description('Show current swarm configuration')
    .action(() => {
      const config = loadConfig();
      output.header('Swarm Configuration');
      output.print(`  Topology        : ${config.swarm.topology}`);
      output.print(`  Max agents      : ${config.swarm.maxAgents}`);
      output.print(`  Model           : ${config.defaultModel}`);
      output.print(`  Max retries     : ${config.retry.maxAttempts}`);
      output.print(`  Backoff         : ${config.retry.backoffStrategy}`);
      output.print(`  Instructions    : ${config.instructions.autoLoad ? config.instructions.file : 'disabled'}`);
      output.print(`  Skill dirs      : ${config.skills.directories.join(', ') || '—'}`);
      output.print(`  Agent dirs      : ${config.agents.directories.join(', ') || '—'}`);
    });
}

interface TaskRetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  backoffStrategy: 'exponential' | 'linear' | 'constant' | 'fibonacci';
}

function buildTaskList(
  task: string,
  agentsFlag: string | undefined,
  retryConfig: TaskRetryConfig,
  sessionOptions: SessionExtensions,
): SwarmTask[] {
  if (agentsFlag) {
    const types = agentsFlag.split(',').map(s => s.trim() as AgentType);
    return types.map((type, i) => ({
      id: `task-${i + 1}`,
      agentType: type,
      prompt: task,
      dependsOn: i > 0 ? [`task-${i}`] : undefined,
      retryConfig,
      sessionOptions,
    }));
  }

  // Default pipeline based on task type
  const suggested = routeTask(task);
  const pipeline: AgentType[] =
    suggested === 'coder'
      ? ['researcher', 'coder', 'reviewer']
      : [suggested, 'reviewer'];

  return pipeline.map((type, i) => ({
    id: `task-${i + 1}`,
    agentType: type,
    prompt: task,
    dependsOn: i > 0 ? [`task-${i}`] : undefined,
    retryConfig,
    sessionOptions,
  }));
}
