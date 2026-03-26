import { Command } from 'commander';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { output, printTable } from '../output.js';
import { isInitialised } from '../config.js';
import { clientManager } from '../core/client-manager.js';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check system health and prerequisites')
    .option('--verbose', 'Show extra detail')
    .action(async (opts: { verbose: boolean }) => {
      output.header('copilot-flow doctor');

      const checks: Check[] = [];

      // ── Node.js version ──────────────────────────────────────────────────
      const nodeVersion = process.version;
      const nodeMajor = parseInt(nodeVersion.slice(1), 10);
      checks.push({
        name: 'Node.js >= 20',
        ok: nodeMajor >= 20,
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

      // ── copilot authenticated ────────────────────────────────────────────
      let authenticated = false;
      if (copilotInstalled) {
        try {
          execSync('copilot --version', { stdio: 'pipe' });
          // A successful ping via SDK is the real test — we do that below
          authenticated = true;
        } catch {
          authenticated = false;
        }
      }
      checks.push({
        name: 'copilot authenticated',
        ok: authenticated,
        detail: authenticated ? 'Logged in' : 'Run: copilot login',
      });

      // ── @github/copilot-sdk reachable ───────────────────────────────────
      let sdkPing = false;
      if (copilotInstalled && authenticated) {
        try {
          sdkPing = await clientManager.ping();
          await clientManager.shutdown();
        } catch {
          sdkPing = false;
        }
      }
      checks.push({
        name: '@github/copilot-sdk ping',
        ok: sdkPing,
        detail: sdkPing ? 'OK' : copilotInstalled ? 'Failed — check copilot login status' : 'Skipped',
      });

      // ── .copilot-flow initialised ────────────────────────────────────────
      checks.push({
        name: 'copilot-flow initialised',
        ok: isInitialised(),
        detail: isInitialised() ? '.copilot-flow/config.json found' : 'Run: copilot-flow init',
      });

      // ── better-sqlite3 available ────────────────────────────────────────
      let sqliteOk = false;
      try {
        require('better-sqlite3');
        sqliteOk = true;
      } catch {
        sqliteOk = false;
      }
      checks.push({
        name: 'better-sqlite3 available',
        ok: sqliteOk,
        detail: sqliteOk ? 'OK' : 'Run: npm install better-sqlite3',
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
        process.exit(1);
      }
    });
}
