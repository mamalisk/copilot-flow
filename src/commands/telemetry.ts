import { Command } from 'commander';
import { getTelemetryStore } from '../telemetry/store.js';
import { output, printTable } from '../output.js';
import type { AgentType } from '../types.js';

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function fmtPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function fmtKB(chars: number): string {
  return chars >= 1024 ? `${(chars / 1024).toFixed(1)} KB` : `${chars} B`;
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function registerTelemetry(program: Command): void {
  const tel = program.command('telemetry').description('View agent run metrics and performance');

  // ── telemetry summary ────────────────────────────────────────────────────────
  tel
    .command('summary')
    .description('Show aggregate run statistics')
    .action(() => {
      const store = getTelemetryStore();
      const s = store.summary();

      if (s.totalRuns === 0) {
        output.dim('No telemetry data yet. Run agents with any command to start recording.');
        return;
      }

      output.header('Telemetry Summary');
      const rows: [string, string][] = [
        ['Total runs',    String(s.totalRuns)],
        ['Success rate',  fmtPct(s.successRate)],
        ['Avg latency',   fmtDuration(s.avgDurationMs)],
        ['Avg prompt',    fmtKB(s.avgPromptChars)],
        ['Avg response',  fmtKB(s.avgResponseChars)],
      ];
      if ((s.totalInputTokens ?? 0) > 0) {
        rows.push(
          ['Total tokens in',  fmtTokens(s.totalInputTokens  ?? 0)],
          ['Total tokens out', fmtTokens(s.totalOutputTokens ?? 0)],
          ['Avg tokens in',    fmtTokens(Math.round(s.avgInputTokens  ?? 0))],
          ['Avg tokens out',   fmtTokens(Math.round(s.avgOutputTokens ?? 0))],
        );
      }
      printTable(rows);

      output.blank();
      output.print('Agent breakdown:');
      for (const [type, stat] of Object.entries(s.byAgentType)) {
        output.print(
          `  ${type.padEnd(22)}  ${String(stat.runs).padStart(4)} runs  ` +
          `${fmtPct(stat.successRate).padStart(4)}  ${fmtDuration(stat.avgDurationMs).padStart(8)} avg`
        );
      }

      if (s.topTools.length > 0) {
        output.blank();
        output.print('Top tools:');
        for (const { tool, count } of s.topTools) {
          output.print(`  ${tool.padEnd(28)}  ${String(count).padStart(5)} calls`);
        }
      }
    });

  // ── telemetry list ───────────────────────────────────────────────────────────
  tel
    .command('list')
    .description('List recent agent runs')
    .option('--type <agent>', 'Filter by agent type')
    .option('--limit <n>', 'Number of rows to show (default: 20)', '20')
    .action((opts: { type?: string; limit: string }) => {
      const store = getTelemetryStore();
      const runs = store.list({
        agentType: opts.type as AgentType | undefined,
        limit: parseInt(opts.limit, 10),
      });

      if (runs.length === 0) {
        output.dim('No runs found.');
        return;
      }

      const hasTokens = runs.some(r => (r.inputTokens ?? 0) > 0);
      output.header('Recent Runs');
      for (const r of runs) {
        const date = new Date(r.createdAt).toISOString().slice(0, 16).replace('T', ' ');
        const status = r.success ? '✓' : '✗';
        const tools = r.toolsInvoked.length > 0 ? `  [${r.toolsInvoked.length} tools]` : '';
        const tokens = hasTokens
          ? `  ${(r.inputTokens ?? 0) > 0 ? `${fmtTokens(r.inputTokens ?? 0)}↑${fmtTokens(r.outputTokens ?? 0)}↓` : '       '}`
          : '';
        output.print(
          `  ${status}  ${date}  ${r.agentType.padEnd(22)}  ${fmtDuration(r.durationMs).padStart(8)}` +
          `  ${String(r.attempts) + (r.attempts > 1 ? ' attempts' : ' attempt ').padEnd(10)}` +
          tools + tokens +
          (r.error ? `  ✗ ${r.error.slice(0, 50)}` : '')
        );
      }
    });

  // ── telemetry clear ──────────────────────────────────────────────────────────
  tel
    .command('clear')
    .description('Delete all telemetry records')
    .option('--yes', 'Skip confirmation prompt')
    .action((opts: { yes?: boolean }) => {
      if (!opts.yes) {
        output.warn('This will delete all telemetry records. Pass --yes to confirm.');
        return;
      }
      getTelemetryStore().clear();
      output.success('Telemetry records cleared.');
    });
}
