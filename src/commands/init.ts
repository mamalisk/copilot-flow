import { Command } from 'commander';
import { saveConfig, DEFAULT_CONFIG, isInitialised, ensureRuntimeDirs } from '../config.js';
import { output } from '../output.js';

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

      output.success('Initialised copilot-flow');
      output.blank();
      output.print('  Config: .copilot-flow/config.json');
      output.print('  Memory: .copilot-flow/memory.db');
      output.print('  Agents: .copilot-flow/agents/');
      output.blank();
      output.dim('Next: copilot-flow agent spawn --type coder --task "Your task"');
    });
}
