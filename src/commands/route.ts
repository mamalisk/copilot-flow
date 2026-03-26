import { Command } from 'commander';
import { routeTask, listAgentTypes, AGENT_REGISTRY } from '../agents/registry.js';
import { output, agentBadge, printTable } from '../output.js';

export function registerRoute(program: Command): void {
  const route = program.command('route').description('Route tasks to the best agent type');

  // ── route task ─────────────────────────────────────────────────────────────
  route
    .command('task')
    .description('Suggest the best agent type for a task')
    .requiredOption('--task <task>', 'Task description')
    .action((opts: { task: string }) => {
      const type = routeTask(opts.task);
      const def = AGENT_REGISTRY[type];
      output.header('Routing Result');
      printTable([
        ['Task', opts.task.slice(0, 80)],
        ['Agent', agentBadge(type)],
        ['Description', def.description],
        ['Capabilities', def.capabilities.join(', ')],
      ]);
    });

  // ── route list-agents ──────────────────────────────────────────────────────
  route
    .command('list-agents')
    .description('List all agent types with their capabilities')
    .action(() => {
      output.header('Available Agent Types');
      for (const type of listAgentTypes()) {
        const def = AGENT_REGISTRY[type];
        output.print(`  ${agentBadge(type).padEnd(32)} ${def.description}`);
      }
    });
}
