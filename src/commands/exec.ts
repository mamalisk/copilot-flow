import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import path from 'path';
import { Command } from 'commander';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { runAgentTask } from '../agents/executor.js';
import { runSwarm } from '../swarm/coordinator.js';
import { output, agentBadge, generateAgentName } from '../output.js';
import { loadConfig } from '../config.js';
import { clientManager } from '../core/client-manager.js';
import { distillToMemory } from '../memory/distill.js';
import { buildMemoryContext, loadIdentityContent, loadLessonsContent, appendLesson } from '../memory/inject.js';
import { getMemoryStore } from '../memory/store.js';
import type { Plan, PlanPhase, SwarmTask, AgentType, CopilotFlowConfig } from '../types.js';
import type { CustomAgentConfig } from '@github/copilot-sdk';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Read repo instructions from disk. Returns undefined if disabled or not found. */
function resolveInstructions(
  flag: string | undefined,
  disabled: boolean,
  configFile: string,
  autoLoad: boolean,
): string | undefined {
  if (disabled) return undefined;
  const filePath = flag ?? (autoLoad ? configFile : undefined);
  if (!filePath) return undefined;
  if (existsSync(filePath)) return readFileSync(filePath, 'utf-8').trim();
  return undefined;
}

/** Load all *.md custom agent definitions from one or more directories. */
function loadAgentsFromDirs(dirs: string[]): CustomAgentConfig[] {
  return dirs.flatMap(dir => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const raw = readFileSync(join(dir, f), 'utf-8');
        const { data, content } = matter(raw);
        return {
          name:        data.name        ?? f.replace(/\.md$/, ''),
          displayName: data.displayName,
          description: data.description,
          tools:       data.tools,
          prompt:      content.trim(),
        } as CustomAgentConfig;
      });
  });
}

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
  phaseResults: ReadonlyMap<string, string>,
  planDir: string,
  taskDescription?: string,
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

  sections.push(`## Your task — phase "${phase.id}"\n\n${taskDescription ?? phase.description}`);

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

  const result = await runAgentTask('reviewer', prompt, { timeoutMs, model, label: generateAgentName('reviewer') });
  if (!result.success) {
    return { pass: false, reason: result.error ?? 'Reviewer agent failed' };
  }

  const lines = result.output.trim().split('\n');
  const pass = lines[0].trim().toUpperCase().startsWith('PASS');
  const reason = lines.slice(1).join('\n').trim();
  return { pass, reason };
}

/** Session extensions resolved once per run and optionally overridden per phase. */
interface SessionExts {
  customAgents: CustomAgentConfig[];
  skillDirs: string[];
  instructionsContent: string | undefined;
  memoryNamespace: string | undefined;
}

/**
 * Execute a single phase (agent or swarm), including the acceptance-criteria
 * retry loop. Throws on failure so `Promise.all` can reject the whole wave.
 *
 * @param parallelCount  Number of phases in the current wave. When > 1 and
 *                       stream is enabled, chunk output is prefixed with
 *                       `[phase.id] ` so parallel streams are distinguishable.
 */
async function runPhase(
  phase: PlanPhase,
  plan: Plan,
  phaseResults: ReadonlyMap<string, string>,
  planDir: string,
  opts: { force: boolean; stream: boolean; maxAcceptanceRetries: string },
  config: CopilotFlowConfig,
  cliModel: string,
  timeoutMs: number,
  globalMaxRetries: number,
  parallelCount: number,
  sessionExts: SessionExts,
): Promise<{ id: string; output: string; outFile: string; skipped: boolean }> {
  const outFile = phaseOutputFile(phase, planDir);

  // Skip already-complete phases unless --force
  if (!opts.force && existsSync(outFile)) {
    const existing = readFileSync(outFile, 'utf-8').trim();
    output.dim(`  [${phase.id}] Already complete — skipping (${outFile}). Use --force to re-run.`);
    return { id: phase.id, output: existing, outFile, skipped: true };
  }

  const streamPrefix = parallelCount > 1 && opts.stream ? `[${phase.id}] ` : '';

  // Per-phase timeout overrides the global CLI --timeout / config value
  const phaseTimeoutMs = phase.timeoutMs ?? timeoutMs;

  // Merge global session extensions with per-phase overrides
  const phaseSkillDirs = [
    ...sessionExts.skillDirs,
    ...(phase.skillDirectories ?? []),
  ].filter(Boolean);

  const phaseAgents = phase.agentDirectories?.length
    ? [...sessionExts.customAgents, ...loadAgentsFromDirs(phase.agentDirectories)]
    : sessionExts.customAgents;

  const maxRetries = phase.maxAcceptanceRetries ?? globalMaxRetries;
  let attempt = 0;
  let phaseOutput = '';
  const failReasons: string[] = [];

  // Inject memories from prior runs (prepended once — not inside the retry loop).
  // contextTags narrows the injected facts to those matching the phase's tag filter.
  const phaseAgentType = phase.agentType ?? 'analyst';
  const memoryContext = sessionExts.memoryNamespace
    ? buildMemoryContext(
        sessionExts.memoryNamespace,
        phase.contextTags,
        undefined,
        loadIdentityContent(),
        loadLessonsContent(phaseAgentType),
        phase.description.slice(0, 200),
      )
    : '';

  while (attempt <= maxRetries) {
    const basePrompt = buildPhasePrompt(phase, plan, phaseResults, planDir);
    const prompt = memoryContext + basePrompt;

    // ── Run the phase (agent or swarm) ──────────────────────────────────────
    if (phase.type === 'swarm') {
      const topology = phase.topology ?? 'hierarchical';
      const agentTypes = phase.agents ?? ['researcher', 'coder', 'reviewer'];

      output.info(`[${phase.id}] Swarm (${topology}): ${agentTypes.map(a => agentBadge(a)).join(' → ')}`);

      const tasks: SwarmTask[] = agentTypes.map((agentType, i) => ({
        id: `${phase.id}-task-${i + 1}`,
        agentType,
        label: `${phase.id} — step ${i + 1}: ${agentType}`,
        prompt: memoryContext + buildPhasePrompt(phase, plan, phaseResults, planDir, phase.subTasks?.[i]),
        dependsOn: topology === 'mesh' ? undefined : i > 0 ? [`${phase.id}-task-${i}`] : undefined,
        sessionOptions: {
          model: resolveModel(agentType, phase, cliModel, config),
          timeoutMs: phaseTimeoutMs,
          skillDirectories: phaseSkillDirs.length ? phaseSkillDirs : undefined,
          customAgents:     phaseAgents.length    ? phaseAgents    : undefined,
          agentName:        phase.agentName,
          instructionsContent: sessionExts.instructionsContent,
        },
      }));

      const swarmResults = await runSwarm(tasks, topology, {
        onProgress: opts.stream
          ? (_taskId, agentType, chunk) =>
              process.stdout.write(`${streamPrefix}${agentBadge(agentType)} ${chunk}`)
          : undefined,
      });

      if (topology === 'mesh' && tasks.length > 1) {
        // Collect every agent's report independently
        const reports: Array<{ task: SwarmTask; output: string }> = [];
        const failed: string[] = [];
        for (const task of tasks) {
          const r = swarmResults.get(task.id);
          if (r?.success) {
            reports.push({ task, output: r.output });
          } else {
            failed.push(`${task.agentType} (${task.id}): ${r?.error ?? 'unknown'}`);
          }
        }

        if (reports.length === 0) {
          throw new Error(`Phase "${phase.id}" failed: all mesh agents failed. ${failed.join('; ')}`);
        }
        if (failed.length > 0) {
          output.warn(`  [${phase.id}] ${failed.length} mesh agent(s) failed: ${failed.join('; ')}`);
        }

        // Concatenate individual reports (preserved verbatim regardless of consolidation outcome)
        const agentSections = reports
          .map((r, i) =>
            `### Agent ${i + 1} — ${r.task.label ?? `${r.task.agentType} (${r.task.id})`}\n\n${r.output}`)
          .join('\n\n---\n\n');

        // Run a coordinator agent to synthesise a consolidated report from all individual outputs
        const consolidationPrompt =
          `You are consolidating independent reports from ${reports.length} parallel agents ` +
          `who each worked on a separate part of the same phase.\n\n` +
          `Phase description: ${phase.description}\n\n` +
          `## Individual agent reports\n\n${agentSections}\n\n` +
          `## Your task\n\n` +
          `Produce a single consolidated report that:\n` +
          `- Synthesises all findings into one coherent document\n` +
          `- Preserves important detail from each agent's report\n` +
          `- Resolves conflicts or overlaps between reports\n` +
          `- Uses clear headings to organise the output`;

        output.info(`  [${phase.id}] Consolidating ${reports.length} mesh agent report(s)…`);
        const consolidation = await runAgentTask('coordinator', consolidationPrompt, {
          model: resolveModel('coordinator', phase, cliModel, config),
          timeoutMs: phaseTimeoutMs,
          label: `${phase.id}/consolidator`,
          instructionsContent: sessionExts.instructionsContent,
        });

        const consolidatedSection = consolidation.success
          ? consolidation.output
          : `*(consolidation failed — see individual reports below)*`;

        if (!consolidation.success) {
          output.warn(`  [${phase.id}] Consolidation step failed — individual reports preserved`);
        }

        phaseOutput =
          `## Consolidated Report\n\n${consolidatedSection}\n\n` +
          `---\n\n## Individual Agent Reports\n\n${agentSections}`;
      } else {
        const last = swarmResults.get(tasks[tasks.length - 1].id);
        if (!last?.success) {
          throw new Error(`Phase "${phase.id}" failed: ${last?.error ?? 'unknown error'}`);
        }
        phaseOutput = last.output;
      }

    } else {
      const agentType = phase.agentType ?? 'analyst';
      output.info(`[${phase.id}] Agent: ${agentBadge(agentType)}`);

      const result = await runAgentTask(agentType, prompt, {
        model: resolveModel(agentType, phase, cliModel, config),
        timeoutMs: phaseTimeoutMs,
        label: generateAgentName(agentType),
        skillDirectories: phaseSkillDirs.length ? phaseSkillDirs : undefined,
        customAgents:     phaseAgents.length    ? phaseAgents    : undefined,
        agentName:        phase.agentName,
        instructionsContent: sessionExts.instructionsContent,
        onChunk: opts.stream
          ? chunk => process.stdout.write(`${streamPrefix}${chunk}`)
          : undefined,
      });

      if (!result.success) {
        throw new Error(`Phase "${phase.id}" failed: ${result.error}`);
      }
      phaseOutput = result.output;
    }

    // ── Acceptance check (if criteria defined) ──────────────────────────────
    if (!phase.acceptanceCriteria) break;

    if (opts.stream) output.blank();
    output.dim(`  [${phase.id}] Checking acceptance criteria (attempt ${attempt + 1}/${maxRetries + 1})…`);
    const check = await runAcceptanceCheck(
      phase.acceptanceCriteria,
      phaseOutput,
      phaseTimeoutMs,
      resolveModel('reviewer', phase, cliModel, config),
    );

    if (check.pass) {
      output.dim(`  [${phase.id}] Acceptance: PASS`);
      // Record a lesson when prior attempts failed — the failure reason is the lesson
      if (failReasons.length > 0 && sessionExts.memoryNamespace) {
        const summary = failReasons.slice(0, 3).join(' | ');
        const lessonValue =
          `Phase "${phase.id}" required ${failReasons.length} retry attempt(s). ` +
          `Acceptance failure(s): ${summary}`;
        appendLesson(phaseAgentType, `recovery:${phase.id}`, lessonValue);
        getMemoryStore().store(
          sessionExts.memoryNamespace,
          `lesson:${phase.id}:recovery`,
          lessonValue,
          { type: 'decision', importance: 4, tags: ['lesson', 'error-recovery'] },
        );
      }
      break;
    }

    failReasons.push(check.reason ?? 'no reason given');
    attempt++;
    if (attempt > maxRetries) {
      throw new Error(
        `Phase "${phase.id}" failed acceptance after ${maxRetries + 1} attempt(s).` +
        (check.reason ? ` Reason: ${check.reason}` : ''),
      );
    }

    output.warn(`  [${phase.id}] Acceptance: FAIL — ${check.reason}`);
    output.info(`  [${phase.id}] Retrying (attempt ${attempt + 1}/${maxRetries + 1})…`);
  }

  writeFileSync(outFile, `# Phase: ${phase.id}\n\n${phaseOutput}\n`, 'utf-8');

  // Distil key facts into memory (best-effort, fires after phase is written to disk)
  if (sessionExts.memoryNamespace) {
    const distilModel = resolveModel(phaseAgentType, phase, cliModel, config);
    output.dim(`  [${phase.id}] Distilling to memory (namespace: ${sessionExts.memoryNamespace})…`);
    await distillToMemory(phaseOutput, sessionExts.memoryNamespace, `phase:${phase.id}`, distilModel, undefined, phaseAgentType);
  }

  return { id: phase.id, output: phaseOutput, outFile, skipped: false };
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
    .option('--agent-dir <path>', 'Directory of *.md custom agent definitions (repeatable)',
      (val, prev: string[]) => [...prev, val], [] as string[])
    .option('--skill-dir <path>', 'Directory to scan for SKILL.md files (repeatable)',
      (val, prev: string[]) => [...prev, val], [] as string[])
    .option('--instructions <file>', 'Repo instructions file to inject (default: auto-detects .github/copilot-instructions.md)')
    .option('--no-instructions', 'Disable auto-detection of copilot-instructions.md')
    .option('--memory-namespace <ns>', 'Enable cross-run memory: distil phase outputs and inject prior context under this namespace')
    .action(async (planFile: string, opts: {
      phase?: string;
      force: boolean;
      model?: string;
      timeout?: string;
      maxAcceptanceRetries: string;
      stream: boolean;
      agentDir: string[];
      skillDir: string[];
      instructions?: string;
      noInstructions?: boolean;
      memoryNamespace?: string;
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
      const cliModel = opts.model ?? '';
      const timeoutMs = opts.timeout ? parseInt(opts.timeout, 10) : config.defaultTimeoutMs;
      const globalMaxRetries = parseInt(opts.maxAcceptanceRetries, 10);
      const phaseResults = new Map<string, string>();

      // Phase output files live alongside the plan file
      const planDir = path.dirname(path.resolve(planFile));
      mkdirSync(planDir, { recursive: true });

      // Resolve session extensions once for the whole run
      const agentDirs = [...config.agents.directories, ...opts.agentDir].filter(Boolean);
      const skillDirs = [...config.skills.directories, ...opts.skillDir].filter(Boolean);
      const sessionExts: SessionExts = {
        customAgents: loadAgentsFromDirs(agentDirs),
        skillDirs,
        instructionsContent: resolveInstructions(
          opts.instructions,
          opts.noInstructions ?? false,
          config.instructions.file,
          config.instructions.autoLoad,
        ),
        memoryNamespace: opts.memoryNamespace,
      };

      // ── Single-phase path ────────────────────────────────────────────────
      if (opts.phase) {
        const target = plan.phases.find(p => p.id === opts.phase);
        if (!target) {
          output.error(`Phase not found: "${opts.phase}". Available: ${plan.phases.map(p => p.id).join(', ')}`);
          process.exit(1);
        }

        output.header(`Executing plan: ${planFile}`);
        output.header(`Phase: ${target.id}`);
        output.dim(target.description);

        try {
          const r = await runPhase(
            target, plan, phaseResults, planDir,
            opts, config, cliModel, timeoutMs, globalMaxRetries, 1, sessionExts,
          );
          if (!r.skipped) {
            if (opts.stream) output.blank();
            output.success(`Phase "${r.id}" complete → ${r.outFile}`);
          }
        } catch (err) {
          output.error(err instanceof Error ? err.message : String(err));
          await clientManager.shutdown();
          process.exit(1);
        }

        await clientManager.shutdown();
        process.exit(0);
      }

      // ── Wave-based parallel path ─────────────────────────────────────────
      const allPhases = topoSort(plan.phases);
      const completed = new Set<string>();
      const remaining = new Set(allPhases.map(p => p.id));

      output.header(`Executing plan: ${planFile}`);
      output.dim(`Phases: ${allPhases.map(p => p.id).join(' → ')}`);
      output.blank();

      while (remaining.size > 0) {
        // Collect all phases whose dependencies are satisfied
        const wave = allPhases.filter(p =>
          remaining.has(p.id) &&
          (p.dependsOn ?? []).every(dep => completed.has(dep)),
        );

        if (wave.length === 0) {
          output.error('Deadlock detected — dependency cycle or unresolvable dependsOn in plan');
          await clientManager.shutdown();
          process.exit(1);
        }

        if (wave.length === 1) {
          output.header(`Phase: ${wave[0].id}`);
          output.dim(wave[0].description);
        } else {
          output.header(`Parallel phases: ${wave.map(p => p.id).join(' + ')}`);
          output.dim(`  Running ${wave.length} phases concurrently`);
        }

        // phaseResults is ReadonlyMap during the wave; all phases in this wave
        // read from completed results only — no writes until after the wave.
        const readonlyResults: ReadonlyMap<string, string> = phaseResults;

        let waveResults: Array<{ id: string; output: string; outFile: string; skipped: boolean }>;
        try {
          waveResults = await Promise.all(
            wave.map(phase =>
              runPhase(
                phase, plan, readonlyResults, planDir,
                opts, config, cliModel, timeoutMs, globalMaxRetries, wave.length, sessionExts,
              ),
            ),
          );
        } catch (err) {
          output.error(err instanceof Error ? err.message : String(err));
          await clientManager.shutdown();
          process.exit(1);
        }

        for (const r of waveResults) {
          phaseResults.set(r.id, r.output);
          completed.add(r.id);
          remaining.delete(r.id);
          if (!r.skipped) {
            if (opts.stream) output.blank();
            output.success(`Phase "${r.id}" complete → ${r.outFile}`);
          }
        }

        output.blank();
      }

      output.success('All phases complete.');
      await clientManager.shutdown();
      process.exit(0);
    });
}
