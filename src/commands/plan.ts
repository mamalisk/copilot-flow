import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import path from 'path';
import { Command } from 'commander';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { output } from '../output.js';
import { loadConfig } from '../config.js';
import { clientManager } from '../core/client-manager.js';
import { buildPlannerPrompt } from '../lib/planner.js';
import { runAgentTask } from '../agents/executor.js';
import type { Plan, AgentType, SwarmTopology } from '../types.js';
import type { CustomAgentConfig } from '@github/copilot-sdk';

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

/** Build the default plan output path: .copilot-flow/plans/{spec-basename}-{timestamp}/phases.yaml */
function defaultPlanFile(spec: string): string {
  const base = path.basename(spec, path.extname(spec));
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join('.copilot-flow', 'plans', `${base}-${ts}`, 'phases.yaml');
}

export function registerPlan(program: Command): void {
  program
    .command('plan <spec>')
    .description('Analyse a spec file and generate a phased execution plan (YAML)')
    .option('-f, --file <path>', 'Output path for the plan file (default: .copilot-flow/plans/{spec}-{ts}/phases.yaml)')
    .option('--model <model>', 'Model override for the planner agent')
    .option('--agent-dir <path>', 'Directory of *.md custom agent definitions (repeatable)',
      (val, prev: string[]) => [...prev, val], [] as string[])
    .option('--skill-dir <path>', 'Directory to scan for SKILL.md files (repeatable)',
      (val, prev: string[]) => [...prev, val], [] as string[])
    .option('--instructions <file>', 'Repo instructions file to inject (default: auto-detects .github/copilot-instructions.md)')
    .option('--no-instructions', 'Disable auto-detection of copilot-instructions.md')
    .action(async (spec: string, opts: {
      file?: string;
      model?: string;
      agentDir: string[];
      skillDir: string[];
      instructions?: string;
      noInstructions?: boolean;
    }) => {
      if (!existsSync(spec)) {
        output.error(`Spec file not found: ${spec}`);
        process.exit(1);
      }

      const outFile = opts.file ?? defaultPlanFile(spec);
      mkdirSync(path.dirname(outFile), { recursive: true });

      const specContent = readFileSync(spec, 'utf-8').trim();
      const config = loadConfig();

      const agentDirs = [...config.agents.directories, ...opts.agentDir].filter(Boolean);
      const skillDirs = [...config.skills.directories, ...opts.skillDir].filter(Boolean);
      const customAgents = loadAgentsFromDirs(agentDirs);
      const instructionsContent = resolveInstructions(
        opts.instructions,
        opts.noInstructions ?? false,
        config.instructions.file,
        config.instructions.autoLoad,
      );

      output.info(`Analysing spec: ${spec}`);
      output.info(`Generating plan → ${outFile}`);
      output.blank();

      const result = await runAgentTask('analyst', buildPlannerPrompt(specContent), {
        model: opts.model ?? config.defaultModel,
        timeoutMs: config.defaultTimeoutMs,
        skillDirectories:    skillDirs.length    ? skillDirs    : undefined,
        customAgents:        customAgents.length ? customAgents : undefined,
        instructionsContent: instructionsContent,
      });

      if (!result.success) {
        output.error(`Planning failed: ${result.error}`);
        await clientManager.shutdown();
        process.exit(1);
      }

      // Extract YAML from a ```yaml code block, or treat the whole response as YAML
      const match = result.output.match(/```ya?ml\s*\n([\s\S]*?)```/);
      const rawYaml = match ? match[1].trim() : result.output.trim();

      let plan: Plan;
      try {
        plan = yaml.load(rawYaml) as Plan;
        if (!Array.isArray(plan?.phases) || plan.phases.length === 0) {
          throw new Error('No phases found in the generated plan');
        }
      } catch (err) {
        output.error(`Generated YAML is invalid: ${err instanceof Error ? err.message : String(err)}`);
        output.dim('Raw model output:');
        output.dim(result.output.slice(0, 600));
        await clientManager.shutdown();
        process.exit(1);
      }

      // Stamp in the spec path and version before saving
      plan.spec = spec;
      plan.version = (plan.version as string | undefined) ?? '1';

      // Normalise optional fields
      for (const phase of plan.phases) {
        phase.dependsOn = phase.dependsOn ?? [];
        if (phase.type === 'swarm') {
          phase.topology = (phase.topology as SwarmTopology | undefined) ?? 'hierarchical';
          phase.agents = (phase.agents as AgentType[] | undefined) ?? ['researcher', 'coder', 'reviewer'];
        }
      }

      writeFileSync(outFile, yaml.dump(plan, { lineWidth: 100 }), 'utf-8');

      output.success(`Plan written to ${outFile}`);
      output.blank();
      output.print(`  ${plan.phases.length} phase(s):`);
      for (const phase of plan.phases) {
        const typeLabel = phase.type === 'swarm'
          ? `swarm/${phase.topology} [${(phase.agents ?? []).join(', ')}]`
          : `agent/${phase.agentType}`;
        const deps = phase.dependsOn?.length ? ` (after: ${phase.dependsOn.join(', ')})` : '';
        output.print(`    ${phase.id.padEnd(22)} ${typeLabel}${deps}`);
      }

      await clientManager.shutdown();
      process.exit(0);
    });
}
