import { Command } from 'commander';
import { agentPool } from '../agents/pool.js';
import { getMemoryStore } from '../memory/store.js';
import { output, printTable } from '../output.js';
import { loadConfig, isInitialised } from '../config.js';

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show system status overview')
    .action(() => {
      const initialised = isInitialised();
      output.header('copilot-flow status');

      printTable([
        ['Initialised', initialised ? '✓ Yes' : '✗ No — run: copilot-flow init'],
      ]);

      if (!initialised) return;

      const config = loadConfig();

      output.blank();
      output.print('Configuration');
      printTable([
        ['Default model', config.defaultModel],
        ['Topology', config.swarm.topology],
        ['Max agents', String(config.swarm.maxAgents)],
        ['Max retries', String(config.retry.maxAttempts)],
        ['Backoff', config.retry.backoffStrategy],
        ['Jitter', config.retry.jitter ? 'on' : 'off'],
      ]);

      output.blank();
      output.print('Agents');
      const agents = agentPool.list();
      if (agents.length === 0) {
        output.dim('  No agent records found.');
      } else {
        const byStatus = agents.reduce<Record<string, number>>((acc, a) => {
          acc[a.status] = (acc[a.status] ?? 0) + 1;
          return acc;
        }, {});
        for (const [status, count] of Object.entries(byStatus)) {
          output.print(`  ${status}: ${count}`);
        }
      }

      output.blank();
      output.print('Memory');
      try {
        const store = getMemoryStore(config.memory.path);
        const swarmEntries = store.list('swarm').length;
        output.print(`  swarm namespace: ${swarmEntries} entries`);
      } catch {
        output.dim('  Memory store not available.');
      }
    });
}
