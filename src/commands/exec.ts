import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { Command } from 'commander';
import yaml from 'js-yaml';
import { runAgentTask } from '../agents/executor.js';
import { runSwarm } from '../swarm/coordinator.js';
import { output, agentBadge } from '../output.js';
import { loadConfig } from '../config.js';
import { clientManager } from '../core/client-manager.js';
import type { Plan, PlanPhase, SwarmTask, AgentType, CopilotFlowConfig } from '../types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve model for a specific agent type within a phase.
 * Precedence (highest → lowest):
 *   CLI --model  >  phase.model  >  config.agents.models[type]  >  config.defaultModel
 */
function resolveModel(
  agentType: AgentType,
  phase: PlanPhase,
  cliModel: string,
  config: CopilotFlowConfig,
): string {
  return (
    cliModel ||
    phase.model ||
    config.agents.models?.[agentType] ||
    config.defaultModel
  );
}

function phaseOutputFile(phase: PlanPhase, planDir: string): string {
  const filename = phase.output ?? `phase-${phase.id}.md`;
  return path.join(planDir, filename);
}

/**
 * Topological sort: returns phases in a valid execution order
 * where every dependency appears before the phase that needs it.
 */
function topoSort(phases: PlanPhase[]): PlanPhase[] {
  const byId = new Map(phases.map(p => [p.id, p]));
  const result: PlanPhase[] = [];
  const visited = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const phase = byId.get(id);
    if (!phase) throw new Error(`Unknown phase id in dependsOn: "${id}"`);
    for (const dep of phase.dependsOn ?? []) visit(dep);
    result.push(phase);
  }

  for (const phase of phases) visit(phase.id);
  return result;
}

/**
 * Build the prompt for a phase: original spec + outputs from all dependencies
 * (read from the in-memory results map first, then fall back to disk).
 */
function buildPhasePrompt(
  phase: PlanPhase,
  plan: Plan,
  phaseResults: Map<string, string>,
  planDir: string,
): string {
  const sections: string[] = [];

  if (plan.spec && existsSync(plan.spec)) {
    sections.push(
      `## Original specification (${plan.spec})\n\n${readFileSync(plan.spec, 'utf-8').trim()}`,
    );
  }

  for (const depId of phase.dependsOn ?? []) {
    const depPhase = plan.phases.find(p => p.id === depId);
    if (!depPhase) continue;
    const depFile = phaseOutputFile(depPhase, planDir);
    const content =
      phaseResults.get(depId) ??
      (existsSync(depFile) ? readFileSync(depFile, 'utf-8').trim() : null);
    if (content) {
      sections.push(`## Output from phase "${depId}"\n\n${content}`);
    }
  }

  sections.push(`## Your task — phase "${phase.id}"\n\n${phase.description}`);

  return sections.join('\n\n---\n\n');
}

/**
 * Ask a reviewer agent whether the phase output meets the acceptance criteria.
 * Returns { pass, reason } — reason is the reviewer's explanation.
 */
async function runAcceptanceCheck(
  criteria: string,
  phaseOutput: string,
  timeoutMs: number,
  model: string,
): Promise<{ pass: boolean; reason: string }> {
  const prompt =
    `Evaluate whether the following output meets the acceptance criteria.\n` +
    `Respond with PASS or FAIL on the first line, followed by a brief explanation.\n\n` +
    `Acceptance criteria:\n${criteria}\n\n` +
    `Output to evaluate:\n${phaseOutput}`;

  const result = await runAgentTask('reviewer', prompt, { timeoutMs, model });
  if (!result.success) {
    return { pass: false, reason: result.error ?? 'Reviewer agent failed' };
  }

  const lines = result.output.trim().split('\n');
  const pass = lines[0].trim().toUpperCase().startsWith('PASS');
  const reason = lines.slice(1).join('\n').trim();
  return { pass, reason };
}

// ─── Command ──────────────────────────────────────────────────────────────────

export function registerExec(program: Command): void {
  program
    .command('exec <plan>')
    .description('Execute a phased plan — all phases or a single one')
    .option('--phase <id>', 'Run only this phase (dependency output files must exist on disk)')
    .option('--force', 'Re-run phases even if their output file already exists')
    .option('--model <model>', 'Model override for all agents in this run')
    .option('--timeout <ms>', 'Session timeout per agent in ms (overrides config)')
    .option('--max-acceptance-retries <n>', 'Max re-runs on acceptance failure (default: 2)', '2')
    .option('--stream', 'Stream agent output as it arrives')
    .action(async (planFile: string, opts: {
      phase?: string;
      force: boolean;
      model?: string;
      timeout?: string;
      maxAcceptanceRetries: string;
      stream: boolean;
    }) => {
      if (!existsSync(planFile)) {
        output.error(`Plan file not found: ${planFile}`);
        process.exit(1);
      }

      let plan: Plan;
      try {
        plan = yaml.load(readFileSync(planFile, 'utf-8')) as Plan;
        if (!Array.isArray(plan?.phases) || plan.phases.length === 0) {
          throw new Error('No phases found');
        }
      } catch (err) {
        output.error(`Invalid plan file: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }

      const config = loadConfig();
      const model = opts.model ?? config.defaultModel;
      const timeoutMs = opts.timeout ? parseInt(opts.timeout, 10) : config.defaultTimeoutMs;
      const globalMaxRetries = parseInt(opts.maxAcceptanceRetries, 10);
      const phaseResults = new Map<string, string>();

      // Phase output files live alongside the plan file
      const planDir = path.dirname(path.resolve(planFile));
      mkdirSync(planDir, { recursive: true });

      // Determine which phases to run
      let phasesToRun: PlanPhase[];
      if (opts.phase) {
        const target = plan.phases.find(p => p.id === opts.phase);
        if (!target) {
          output.error(`Phase not found: "${opts.phase}". Available: ${plan.phases.map(p => p.id).join(', ')}`);
          process.exit(1);
        }
        phasesToRun = [target];
      } else {
        phasesToRun = topoSort(plan.phases);
      }

      output.header(`Executing plan: ${planFile}`);
      output.dim(`Phases: ${phasesToRun.map(p => p.id).join(' → ')}`);
      output.blank();

      for (const phase of phasesToRun) {
        const outFile = phaseOutputFile(phase, planDir);

        output.header(`Phase: ${phase.id}`);
        output.dim(phase.description);

        // Skip already-complete phases unless --force
        if (!opts.force && existsSync(outFile)) {
          const existing = readFileSync(outFile, 'utf-8').trim();
          phaseResults.set(phase.id, existing);
          output.dim(`  Already complete — skipping (${outFile}). Use --force to re-run.`);
          output.blank();
          continue;
        }

        const maxRetries = phase.maxAcceptanceRetries ?? globalMaxRetries;
        let attempt = 0;
        let phaseOutput = '';

        while (attempt <= maxRetries) {
          const prompt = buildPhasePrompt(phase, plan, phaseResults, planDir);

          // ── Run the phase (agent or swarm) ──────────────────────────────
          if (phase.type === 'swarm') {
            const topology = phase.topology ?? 'hierarchical';
            const agentTypes = phase.agents ?? ['researcher', 'coder', 'reviewer'];

            output.info(`Swarm (${topology}): ${agentTypes.map(a => agentBadge(a)).join(' → ')}`);

            const tasks: SwarmTask[] = agentTypes.map((agentType, i) => ({
              id: `${phase.id}-task-${i + 1}`,
              agentType,
              prompt,
              dependsOn: i > 0 ? [`${phase.id}-task-${i}`] : undefined,
              sessionOptions: { model: resolveModel(agentType, phase, model, config), timeoutMs },
            }));

            const results = await runSwarm(tasks, topology, {
              onProgress: opts.stream
                ? (_taskId, agentType, chunk) => process.stdout.write(`${agentBadge(agentType)} ${chunk}`)
                : undefined,
            });

            const last = results.get(tasks[tasks.length - 1].id);
            if (!last?.success) {
              output.error(`Phase "${phase.id}" failed: ${last?.error ?? 'unknown error'}`);
              await clientManager.shutdown();
              process.exit(1);
            }
            phaseOutput = last.output;

          } else {
            const agentType = phase.agentType ?? 'analyst';
            output.info(`Agent: ${agentBadge(agentType)}`);

            const result = await runAgentTask(agentType, prompt, {
              model: resolveModel(agentType, phase, model, config),
              timeoutMs,
              onChunk: opts.stream ? chunk => process.stdout.write(chunk) : undefined,
            });

            if (!result.success) {
              output.error(`Phase "${phase.id}" failed: ${result.error}`);
              await clientManager.shutdown();
              process.exit(1);
            }
            phaseOutput = result.output;
          }

          // ── Acceptance check (if criteria defined) ──────────────────────
          if (!phase.acceptanceCriteria) break;

          if (opts.stream) output.blank();
          output.dim(`  Checking acceptance criteria (attempt ${attempt + 1}/${maxRetries + 1})…`);
          const check = await runAcceptanceCheck(
            phase.acceptanceCriteria,
            phaseOutput,
            timeoutMs,
            resolveModel('reviewer', phase, model, config),
          );

          if (check.pass) {
            output.dim('  Acceptance: PASS');
            break;
          }

          attempt++;
          if (attempt > maxRetries) {
            output.error(`Phase "${phase.id}" failed acceptance after ${maxRetries + 1} attempt(s).`);
            if (check.reason) output.dim(`  Reason: ${check.reason}`);
            await clientManager.shutdown();
            process.exit(1);
          }

          output.warn(`  Acceptance: FAIL — ${check.reason}`);
          output.info(`  Retrying phase (attempt ${attempt + 1}/${maxRetries + 1})…`);
        }

        writeFileSync(outFile, `# Phase: ${phase.id}\n\n${phaseOutput}\n`, 'utf-8');
        phaseResults.set(phase.id, phaseOutput);

        if (opts.stream) output.blank();
        output.success(`Phase "${phase.id}" complete → ${outFile}`);
        output.blank();
      }

      output.success('All phases complete.');
      await clientManager.shutdown();
      process.exit(0);
    });
}
