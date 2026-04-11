import { Command } from 'commander';
import { execSync } from 'child_process';
import { output, printTable } from '../output.js';
import { isInitialised, loadConfig } from '../config.js';
import { clientManager } from '../core/client-manager.js';
import type { ModelInfo } from '@github/copilot-sdk';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

async function fetchModels(): Promise<ModelInfo[]> {
  const client = await clientManager.getClient();
  return client.listModels();
}

function printModels(models: ModelInfo[], configuredDefault: string): void {
  output.blank();
  output.print('  Available models:');
  output.blank();
  for (const m of models) {
    const isDefault = m.id === configuredDefault;
    const tag = isDefault ? ' ← configured default' : '';
    output.print(`    ${m.id.padEnd(30)} ${m.name}${tag}`);
  }
  output.blank();
  if (!configuredDefault) {
    output.dim('  No default model set — Copilot CLI will choose automatically.');
    output.dim('  To pin one: export COPILOT_FLOW_DEFAULT_MODEL=<id>');
    output.dim('              or set "defaultModel" in .copilot-flow/config.json');
  }
}

export function registerDoctor(program: Command): void {
  // ── models subcommand ──────────────────────────────────────────────────────
  program
    .command('models')
    .description('List models available on your Copilot plan')
    .action(async () => {
      output.header('Available models');
      const config = loadConfig();
      try {
        const models = await fetchModels();
        printModels(models, config.defaultModel);
      } catch (err) {
        output.error(`Could not fetch models: ${err instanceof Error ? err.message : String(err)}`);
        output.dim('  → Is the Copilot CLI authenticated? Run: copilot-flow doctor');
        await clientManager.shutdown();
        process.exit(1);
      }
      await clientManager.shutdown();
      process.exit(0);
    });

  program
    .command('doctor')
    .description('Check system health and prerequisites')
    .option('--verbose', 'Show extra detail')
    .action(async (opts: { verbose: boolean }) => {
      output.header('copilot-flow doctor');

      const checks: Check[] = [];

      // ── Node.js version ──────────────────────────────────────────────────
      const nodeVersion = process.version;
      const [nodeMajor, nodeMinorRaw] = nodeVersion.slice(1).split('.').map(Number);
      const nodeSatisfies = nodeMajor > 22 || (nodeMajor === 22 && nodeMinorRaw >= 5);
      checks.push({
        name: 'Node.js >= 22.5',
        ok: nodeSatisfies,
        detail: nodeVersion,
      });

      // ── copilot CLI installed ────────────────────────────────────────────
      let copilotVersion = '';
      let copilotInstalled = false;
      try {
        copilotVersion = execSync('copilot version', { stdio: 'pipe' }).toString().trim();
        copilotInstalled = true;
      } catch {
        try {
          // Some installations expose it via 'gh copilot' as well
          copilotVersion = execSync('gh copilot --version', { stdio: 'pipe' }).toString().trim();
          copilotInstalled = true;
        } catch {
          copilotInstalled = false;
        }
      }
      checks.push({
        name: 'copilot CLI installed',
        ok: copilotInstalled,
        detail: copilotInstalled ? copilotVersion : 'Not found — install from https://github.com/github/copilot',
      });

      // ── copilot authenticated + SDK reachable ────────────────────────────
      // The SDK ping is the definitive test: it starts the copilot process and
      // attempts a real connection. If this fails the CLI is not authenticated.
      let sdkPing = false;
      let sdkDetail = 'Skipped (copilot CLI not found)';
      if (copilotInstalled) {
        try {
          sdkPing = await clientManager.ping();
          await clientManager.shutdown();
          sdkDetail = 'OK';
        } catch (err) {
          sdkPing = false;
          const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
          if (msg.includes('authentication') || msg.includes('custom provider') || msg.includes('session was not created')) {
            sdkDetail = 'Not authenticated — run: copilot login';
          } else {
            sdkDetail = `Failed — ${(err instanceof Error ? err.message : String(err)).slice(0, 60)}`;
          }
        }
      }
      checks.push({
        name: 'copilot authenticated',
        ok: sdkPing,
        detail: sdkDetail,
      });

      // ── .copilot-flow initialised ────────────────────────────────────────
      checks.push({
        name: 'copilot-flow initialised',
        ok: isInitialised(),
        detail: isInitialised() ? '.copilot-flow/config.json found' : 'Run: copilot-flow init',
      });

      // ── node:sqlite available (built-in since Node 22.5) ────────────────
      let sqliteOk = false;
      try {
        require('node:sqlite');
        sqliteOk = true;
      } catch {
        sqliteOk = false;
      }
      const nodeMinor = parseInt(nodeVersion.split('.')[1] ?? '0', 10);
      checks.push({
        name: 'node:sqlite available',
        ok: sqliteOk,
        detail: sqliteOk ? 'OK' : `Requires Node >= 22.5 (current: ${nodeVersion})`,
      });

      // ── Print results ───────────────────────────────────────────────────
      output.blank();
      for (const check of checks) {
        const icon = check.ok ? '✓' : '✗';
        const colour = check.ok
          ? (s: string) => s
          : (s: string) => `\x1b[31m${s}\x1b[0m`;
        output.print(`  ${icon} ${colour(check.name.padEnd(35))} ${check.detail}`);
      }

      output.blank();
      const failed = checks.filter(c => !c.ok);
      if (failed.length === 0) {
        output.success('All checks passed — copilot-flow is ready!');
      } else {
        output.warn(`${failed.length} check(s) failed. See details above.`);
      }

      // ── Show available models when authenticated and --verbose ──────────
      if (opts.verbose && sdkPing) {
        try {
          const config = loadConfig();
          const models = await fetchModels();
          printModels(models, config.defaultModel);
        } catch {
          // non-fatal — doctor results already shown
        }
      } else if (sdkPing) {
        output.dim('  Tip: run with --verbose to see available models');
      }

      await clientManager.shutdown();
      process.exit(failed.length > 0 ? 1 : 0);
    });
}
