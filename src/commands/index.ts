/**
 * CLI entry point — registers all commands and parses arguments.
 */

import { Command } from 'commander';
import { registerInit } from './init.js';
import { registerAgent } from './agent.js';
import { registerSwarm } from './swarm.js';
import { registerMemory } from './memory.js';
import { registerHooks } from './hooks.js';
import { registerRoute } from './route.js';
import { registerStatus } from './status.js';
import { registerDoctor } from './doctor.js';

const program = new Command();

program
  .name('copilot-flow')
  .description(
    'Multi-agent orchestration framework for GitHub Copilot CLI\n' +
    'Inspired by Ruflo (claude-flow) — https://github.com/ruvnet/claude-flow'
  )
  .version('1.0.0');

// Register all commands
registerInit(program);
registerAgent(program);
registerSwarm(program);
registerMemory(program);
registerHooks(program);
registerRoute(program);
registerStatus(program);
registerDoctor(program);

program.parse(process.argv);
