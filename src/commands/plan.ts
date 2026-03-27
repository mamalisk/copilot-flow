import { readFileSync, writeFileSync, existsSync } from 'fs';
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
    description: Implement the designed solution.
    type: swarm
    topology: hierarchical
    agents: [coder, coder, tester]
    dependsOn: [design]
  - id: review
    description: Review the implementation for quality and correctness.
    type: agent
    agentType: reviewer
    dependsOn: [implement]
\`\`\`

Specification to plan:
${specContent}`;
}

export function registerPlan(program: Command): void {
  program
    .command('plan <spec>')
    .description('Analyse a spec file and generate a phased execution plan (YAML)')
    .option('-f, --file <path>', 'Output path for the plan file', 'phases.yaml')
    .option('--model <model>', 'Model override')
    .action(async (spec: string, opts: { file: string; model?: string }) => {
      if (!existsSync(spec)) {
        output.error(`Spec file not found: ${spec}`);
        process.exit(1);
      }

      const specContent = readFileSync(spec, 'utf-8').trim();
      const config = loadConfig();

      output.info(`Analysing spec: ${spec}`);
      output.info(`Generating plan → ${opts.file}`);
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

      writeFileSync(opts.file, yaml.dump(plan, { lineWidth: 100 }), 'utf-8');

      output.success(`Plan written to ${opts.file}`);
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
