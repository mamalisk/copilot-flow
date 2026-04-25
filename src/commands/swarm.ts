import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { Command } from 'commander';
import matter from 'gray-matter';
import { runSwarm } from '../swarm/coordinator.js';
import { routeTask } from '../agents/registry.js';
import { registerEventLog } from '../hooks/event-log.js';
import { output, agentBadge } from '../output.js';
import { loadConfig, saveConfig } from '../config.js';
import { clientManager } from '../core/client-manager.js';
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
    .option('--agents <list>', 'Comma-separated agent types (e.g. researcher,coder,reviewer). Duplicate types trigger automatic coordinator orchestration.')
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
    .option('--model <model>', 'Model override for all agents in this swarm')
    .option('--timeout <ms>', 'Session timeout per agent in ms (default: from config, fallback 1200000)')
    .action(async (opts: {
      task?: string;
      spec?: string;
      output?: string;
      topology?: string;
      agents?: string;
      model?: string;
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
      timeout?: string;
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
        timeoutMs:            opts.timeout ? parseInt(opts.timeout, 10) : config.defaultTimeoutMs,
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

      const tasks = buildTaskList(task, opts.agents, retryConfig, sessionOptions).map(t => ({
        ...t,
        sessionOptions: {
          ...t.sessionOptions,
          model: opts.model ?? config.agents.models?.[t.agentType] ?? config.defaultModel ?? undefined,
        },
      }));

      // Coordinator-based orchestration requires wave execution — mesh ignores dependsOn.
      const hasDependencies = tasks.some(t => t.dependsOn?.length);
      let effectiveTopology = topology;
      if (topology === 'mesh' && hasDependencies) {
        output.warn('Coordinator orchestration requires ordered execution — overriding mesh to hierarchical.');
        effectiveTopology = 'hierarchical';
      }

      output.header(`Swarm: ${effectiveTopology}`);
      output.dim(`Pipeline: ${tasks.map(t => t.agentType).join(' → ')}`);
      output.blank();
      registerEventLog();

      const results = await runSwarm(tasks, effectiveTopology, {
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

      const anyFailed = [...results.values()].some(r => !r.success);
      await clientManager.shutdown();
      process.exit(anyFailed ? 1 : 0);
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

// ── Orchestration helpers ──────────────────────────────────────────────────────

/**
 * Prompt for a coordinator that precedes N parallel agents of the same type.
 * Produces a numbered plan so each agent can self-assign by finding "Subtask K:".
 */
function buildCoordinatorPrompt(
  originalTask: string,
  agentType: AgentType,
  count: number,
): string {
  return (
    `You are coordinating ${count} ${agentType} agents working in parallel.\n` +
    `Decompose the task below into exactly ${count} distinct, non-overlapping subtasks.\n` +
    `Label each one "Subtask 1:", "Subtask 2:", … "Subtask ${count}:" so each agent can self-assign.\n` +
    `Each subtask must be fully self-contained — agents work independently without further clarification.\n\n` +
    `Task:\n${originalTask}`
  );
}

/**
 * Prompt for a parallel agent that picks its subtask from the coordinator's output.
 * The coordinator's output is prepended automatically by buildPrompt() in
 * coordinator.ts via the dependsOn relationship — no extra wiring needed here.
 */
function buildParallelAgentPrompt(
  originalTask: string,
  agentType: AgentType,
  index: number,
  total: number,
): string {
  return (
    `You are ${agentType} agent #${index} of ${total} working in parallel.\n` +
    `A coordinator has divided the work into ${total} subtasks above.\n` +
    `Find "Subtask ${index}:" in the coordinator's output and execute that specific subtask only.\n` +
    `Do not duplicate work assigned to the other ${total - 1} agent(s).\n\n` +
    `Overall task context:\n${originalTask}`
  );
}

interface AgentEntry {
  agentType: AgentType;
  taskId: string;
  prompt: string;
  dependsOn: string[];
  label?: string;
  /** Metadata used to detect whether an explicit coordinator matches the next group. */
  _coordinatesType?: AgentType;
  _coordinatesCount?: number;
}

/**
 * Parse an ordered agent list into AgentEntry records with:
 * - automatic coordinator injection before any duplicate-type group
 * - parallel agents all depending on their coordinator (not on each other)
 * - the first agent after a parallel group depending on ALL parallel agents
 * - sequential agents depending on the previous step
 */
function buildAgentEntries(task: string, types: AgentType[]): AgentEntry[] {
  const entries: AgentEntry[] = [];
  let counter = 0;
  const nextId = () => `task-${++counter}`;
  /** What the next entry should depend on (single previous, or all parallel agents). */
  let currentDeps: string[] = [];

  let i = 0;
  while (i < types.length) {
    const type = types[i];

    // Count consecutive same-type run (coordinators never form groups)
    let runLen = 1;
    if (type !== 'coordinator') {
      while (i + runLen < types.length && types[i + runLen] === type) runLen++;
    }

    // ── Coordinator ──────────────────────────────────────────────────────────
    if (type === 'coordinator') {
      const nextType = types[i + 1] as AgentType | undefined;
      let nextRun = 0;
      if (nextType && nextType !== 'coordinator') {
        while (i + 1 + nextRun < types.length && types[i + 1 + nextRun] === nextType) nextRun++;
      }

      const taskId = nextId();
      if (nextRun > 1) {
        // This coordinator orchestrates the following duplicate group
        entries.push({
          agentType: 'coordinator',
          taskId,
          prompt: buildCoordinatorPrompt(task, nextType!, nextRun),
          dependsOn: currentDeps.slice(),
          _coordinatesType: nextType,
          _coordinatesCount: nextRun,
        });
      } else {
        // Coordinator with no following group — sequential agent with original task
        entries.push({ agentType: 'coordinator', taskId, prompt: task, dependsOn: currentDeps.slice() });
      }
      currentDeps = [taskId];
      i++;
      continue;
    }

    // ── Duplicate group ──────────────────────────────────────────────────────
    if (runLen > 1) {
      const prev = entries[entries.length - 1];
      let coordinatorId: string;

      if (
        prev?.agentType === 'coordinator' &&
        prev._coordinatesType === type &&
        prev._coordinatesCount === runLen
      ) {
        // Explicitly placed coordinator already covers this group
        coordinatorId = prev.taskId;
      } else {
        // Auto-inject a coordinator immediately before this group
        coordinatorId = nextId();
        entries.push({
          agentType: 'coordinator',
          taskId: coordinatorId,
          prompt: buildCoordinatorPrompt(task, type, runLen),
          dependsOn: currentDeps.slice(),
          _coordinatesType: type,
          _coordinatesCount: runLen,
        });
        currentDeps = [coordinatorId];
      }

      const parallelIds: string[] = [];
      for (let k = 0; k < runLen; k++) {
        const taskId = nextId();
        parallelIds.push(taskId);
        entries.push({
          agentType: type,
          taskId,
          prompt: buildParallelAgentPrompt(task, type, k + 1, runLen),
          dependsOn: [coordinatorId],
          label: `${type} #${k + 1} of ${runLen}`,
        });
      }
      // Next sequential agent must wait for ALL parallel agents to complete
      currentDeps = parallelIds;
      i += runLen;
      continue;
    }

    // ── Single sequential agent ──────────────────────────────────────────────
    const taskId = nextId();
    entries.push({ agentType: type, taskId, prompt: task, dependsOn: currentDeps.slice() });
    currentDeps = [taskId];
    i++;
  }

  return entries;
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
    return buildAgentEntries(task, types).map(e => ({
      id: e.taskId,
      agentType: e.agentType,
      prompt: e.prompt,
      label: e.label,
      dependsOn: e.dependsOn.length > 0 ? e.dependsOn : undefined,
      retryConfig,
      sessionOptions,
    }));
  }

  // Default pipeline — all different types, no orchestration needed
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
