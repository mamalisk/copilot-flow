import { Command } from 'commander';
import { globalHooks } from '../hooks/registry.js';
import { emit } from '../hooks/executor.js';
import { output, printTable } from '../output.js';
import type { HookEvent } from '../types.js';

export function registerHooks(program: Command): void {
  const hooks = program.command('hooks').description('Manage and fire lifecycle hooks');

  // ── hooks list ─────────────────────────────────────────────────────────────
  hooks
    .command('list')
    .description('List all registered hooks')
    .action(() => {
      const registered = globalHooks.list();
      if (registered.length === 0) {
        output.dim('No hooks registered.');
        return;
      }
      output.header('Registered Hooks');
      for (const h of registered) {
        printTable([
          ['ID', h.id],
          ['Event', h.event],
          ['Priority', String(h.priority)],
        ]);
        output.blank();
      }
    });

  // ── hooks fire ─────────────────────────────────────────────────────────────
  hooks
    .command('fire <event>')
    .description('Manually fire a hook event')
    .option('--data <json>', 'JSON data to pass to handlers')
    .action(async (event: string, opts: { data?: string }) => {
      const validEvents: HookEvent[] = [
        'pre-task', 'post-task', 'session-start', 'session-end',
        'agent-spawn', 'agent-terminate', 'swarm-start', 'swarm-end',
      ];

      if (!validEvents.includes(event as HookEvent)) {
        output.error(`Unknown event: ${event}. Valid: ${validEvents.join(', ')}`);
        process.exit(1);
      }

      let data: unknown;
      if (opts.data) {
        try {
          data = JSON.parse(opts.data);
        } catch {
          output.error('--data must be valid JSON');
          process.exit(1);
        }
      }

      await emit(event as HookEvent, data);
      output.success(`Fired: ${event}`);
    });

  // ── Convenience hook commands matching Ruflo's pattern ────────────────────
  for (const event of ['pre-task', 'post-task', 'session-start', 'session-end'] as HookEvent[]) {
    hooks
      .command(event)
      .description(`Fire the ${event} hook`)
      .option('--data <json>', 'JSON payload')
      .action(async (opts: { data?: string }) => {
        let data: unknown;
        if (opts.data) {
          try { data = JSON.parse(opts.data); } catch { /* ignore */ }
        }
        await emit(event, data);
        output.success(`Fired: ${event}`);
      });
  }
}
