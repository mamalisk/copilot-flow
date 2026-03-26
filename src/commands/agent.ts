import { Command } from 'commander';
import { runAgentTask } from '../agents/executor.js';
import { agentPool } from '../agents/pool.js';
import { listAgentTypes, routeTask } from '../agents/registry.js';
import { output, agentBadge, printTable } from '../output.js';
import { loadConfig } from '../config.js';
import type { AgentType } from '../types.js';
import type { BackoffStrategy } from '../core/retry.js';

export function registerAgent(program: Command): void {
  const agent = program.command('agent').description('Manage Copilot agents');

  // ── agent spawn ────────────────────────────────────────────────────────────
  agent
    .command('spawn')
    .description('Spawn a Copilot agent and run a task')
    .requiredOption('--task <task>', 'Task description to run')
    .option('--type <type>', 'Agent type (default: auto-routed from task)')
    .option('--model <model>', 'Override the default model')
    .option('--timeout <ms>', 'Session timeout in ms', '120000')
    .option('--max-retries <n>', 'Maximum retry attempts', '3')
    .option('--retry-delay <ms>', 'Initial retry delay in ms', '1000')
    .option('--retry-strategy <strategy>', 'Backoff strategy (exponential|linear|constant|fibonacci)', 'exponential')
    .option('--no-retry', 'Disable retries')
    .option('--stream', 'Stream output as it arrives')
    .action(async (opts: {
      task: string;
      type?: string;
      model?: string;
      timeout: string;
      maxRetries: string;
      retryDelay: string;
      retryStrategy: string;
      retry: boolean;
      stream: boolean;
    }) => {
      const config = loadConfig();
      const agentType: AgentType = (opts.type as AgentType | undefined) ?? routeTask(opts.task);

      output.info(`${agentBadge(agentType)} Running: ${opts.task.slice(0, 80)}`);

      const result = await runAgentTask(agentType, opts.task, {
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
      });

      if (opts.stream) output.blank();

      if (result.success) {
        if (!opts.stream) output.print(result.output);
        output.blank();
        output.success(
          `Done in ${result.durationMs}ms` +
          (result.attempts > 1 ? ` (${result.attempts} attempts)` : '')
        );
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
