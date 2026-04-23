/**
 * CLI entry point — registers all commands and parses arguments.
 */

import { Command } from 'commander';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../../package.json') as { version: string };
import { registerInit } from './init.js';
import { registerAgent } from './agent.js';
import { registerSwarm } from './swarm.js';
import { registerMemory } from './memory.js';
import { registerHooks } from './hooks.js';
import { registerRoute } from './route.js';
import { registerStatus } from './status.js';
import { registerDoctor } from './doctor.js';
import { registerPlan } from './plan.js';
import { registerExec } from './exec.js';
import { registerTui } from './tui.js';
import { isInitialised, ensureRuntimeDirs, saveConfig, DEFAULT_CONFIG } from '../config.js';
import { output } from '../output.js';

const program = new Command();

program
  .name('copilot-flow')
  .description(
    'Multi-agent orchestration framework for GitHub Copilot CLI\n' +
    'Inspired by Ruflo (claude-flow) — https://github.com/ruvnet/claude-flow'
  )
  .version(version);

// Register all commands
registerInit(program);
registerAgent(program);
registerSwarm(program);
registerMemory(program);
registerHooks(program);
registerRoute(program);
registerStatus(program);
registerDoctor(program);
registerPlan(program);
registerExec(program);
registerTui(program);

// Auto-init: if .copilot-flow/config.json is missing and the command is not
// one of the exempt commands, silently initialise with defaults before running.
const SKIP_AUTO_INIT = new Set(['init', 'doctor', 'status']);
const firstArg = process.argv[2] ?? '';
const isExempt =
  firstArg === '' ||
  firstArg.startsWith('-') || // --version, --help, etc.
  SKIP_AUTO_INIT.has(firstArg);

if (!isExempt && !isInitialised()) {
  output.dim('  Auto-initialising .copilot-flow/ (run "copilot-flow init" to customise)');
  ensureRuntimeDirs();
  saveConfig(DEFAULT_CONFIG);
}

program.parse(process.argv);
