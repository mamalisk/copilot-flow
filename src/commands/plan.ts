import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { Command } from 'commander';
import yaml from 'js-yaml';
import { runAgentTask } from '../agents/executor.js';
import { output } from '../output.js';
import { loadConfig } from '../config.js';
import { clientManager } from '../core/client-manager.js';
import type { Plan, AgentType, SwarmTopology } from '../types.js';

const AGENT_TYPES = [
  'coder', 'researcher', 'tester', 'reviewer', 'architect',
  'coordinator', 'analyst', 'debugger', 'documenter', 'optimizer',
  'security-auditor', 'performance-engineer',
].join(', ');

function buildPlannerPrompt(specContent: string): string {
  return `You are a software project planner for an AI agent pipeline. \
Analyse the following specification and produce a YAML execution plan \
that breaks the work into sequential phases.

Rules:
- Each phase must have a unique kebab-case id.
- type must be "agent" (single specialist) or "swarm" (multi-agent pipeline).
- agentType (type: agent) must be one of: ${AGENT_TYPES}
- topology (type: swarm) must be one of: hierarchical, sequential, mesh
- agents (type: swarm) is a list of agentType values forming the pipeline.
- dependsOn lists phase ids that must complete before this phase starts.
- The first phase must have an empty dependsOn list.
- output is optional — if omitted the file will be named phase-{id}.md.
- subTasks: when topology is "mesh" AND agents contains duplicate types, you MUST provide
  a subTasks list of the same length as agents. Each entry is the specific task description
  for that agent. This ensures each agent receives distinct work instead of attempting the
  entire task independently and colliding on shared resources.
- Output ONLY valid YAML inside a single \`\`\`yaml code block. No other text.

Example structure:
\`\`\`yaml
version: "1"
phases:
  - id: research
    description: Investigate the problem domain and gather requirements.
    type: agent
    agentType: researcher
    dependsOn: []
  - id: design
    description: Design the solution architecture based on research.
    type: swarm
    topology: hierarchical
    agents: [architect, analyst]
    dependsOn: [research]
  - id: implement
    description: Implement the solution in 3 programming languages as fast as possible.
    type: swarm
    topology: mesh
    agents: [coder, coder, coder]
    subTasks:
      - "Write hello_world.py — a Python script that prints 'Hello, World!'"
      - "Write hello_world.js — a Node.js script that prints 'Hello, World!'"
      - "Write hello_world.go — a Go program that prints 'Hello, World!'"
    dependsOn: [design]
  - id: review
    description: Review the implementation for quality and correctness.
    type: agent
    agentType: reviewer
    model: ''       # optional — leave empty to use config.agents.models.reviewer or defaultModel
    dependsOn: [implement]
\`\`\`

Specification to plan:
${specContent}`;
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
    .option('--model <model>', 'Model override')
    .action(async (spec: string, opts: { file?: string; model?: string }) => {
      if (!existsSync(spec)) {
        output.error(`Spec file not found: ${spec}`);
        process.exit(1);
      }

      const outFile = opts.file ?? defaultPlanFile(spec);
      mkdirSync(path.dirname(outFile), { recursive: true });

      const specContent = readFileSync(spec, 'utf-8').trim();
      const config = loadConfig();

      output.info(`Analysing spec: ${spec}`);
      output.info(`Generating plan → ${outFile}`);
      output.blank();

      const result = await runAgentTask('analyst', buildPlannerPrompt(specContent), {
        model: opts.model ?? config.defaultModel,
        timeoutMs: config.defaultTimeoutMs,
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
