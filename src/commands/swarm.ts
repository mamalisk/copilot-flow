import { Command } from 'commander';
import { runSwarm } from '../swarm/coordinator.js';
import { routeTask } from '../agents/registry.js';
import { output, agentBadge } from '../output.js';
import { loadConfig, saveConfig } from '../config.js';
import type { SwarmTask, SwarmTopology, AgentType } from '../types.js';

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
    .requiredOption('--task <task>', 'High-level task to decompose across agents')
    .option('--topology <type>', 'Override topology for this run')
    .option('--agents <list>', 'Comma-separated agent types (e.g. researcher,coder,reviewer)')
    .option('--stream', 'Stream agent outputs as they arrive')
    .option('--max-retries <n>', 'Retry attempts per agent', '3')
    .option('--retry-delay <ms>', 'Initial retry delay in ms', '1000')
    .option('--retry-strategy <strategy>', 'Backoff strategy (exponential|linear|constant|fibonacci)', 'exponential')
    .action(async (opts: {
      task: string;
      topology?: string;
      agents?: string;
      stream: boolean;
      maxRetries: string;
      retryDelay: string;
      retryStrategy: string;
    }) => {
      const config = loadConfig();
      const topology = (opts.topology ?? config.swarm.topology) as SwarmTopology;
      const tasks = buildTaskList(opts.task, opts.agents, {
        maxAttempts: parseInt(opts.maxRetries, 10),
        initialDelayMs: parseInt(opts.retryDelay, 10),
        backoffStrategy: opts.retryStrategy as 'exponential' | 'linear' | 'constant' | 'fibonacci',
      });

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
    });

  // ── swarm status ───────────────────────────────────────────────────────────
  swarm
    .command('status')
    .description('Show current swarm configuration')
    .action(() => {
      const config = loadConfig();
      output.header('Swarm Configuration');
      output.print(`  Topology   : ${config.swarm.topology}`);
      output.print(`  Max agents : ${config.swarm.maxAgents}`);
      output.print(`  Model      : ${config.defaultModel}`);
      output.print(`  Max retries: ${config.retry.maxAttempts}`);
      output.print(`  Backoff    : ${config.retry.backoffStrategy}`);
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
  retryConfig: TaskRetryConfig
): SwarmTask[] {
  if (agentsFlag) {
    const types = agentsFlag.split(',').map(s => s.trim() as AgentType);
    return types.map((type, i) => ({
      id: `task-${i + 1}`,
      agentType: type,
      prompt: task,
      dependsOn: i > 0 ? [`task-${i}`] : undefined,
      retryConfig,
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
  }));
}
