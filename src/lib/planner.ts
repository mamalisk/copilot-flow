/**
 * Shared plan-generation logic — used by both the CLI (`commands/plan.ts`)
 * and the TUI (`tui/screens/plan.tsx`).
 */

import yaml from 'js-yaml';
import { runAgentTask } from '../agents/executor.js';
import type { Plan, AgentType, SwarmTopology } from '../types.js';

// ── Prompt ─────────────────────────────────────────────────────────────────────

const AGENT_TYPES = [
  'coder', 'researcher', 'tester', 'reviewer', 'architect',
  'coordinator', 'analyst', 'debugger', 'documenter', 'optimizer',
  'security-auditor', 'performance-engineer',
].join(', ');

export function buildPlannerPrompt(specContent: string): string {
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
- model: optional model override for this phase (e.g. "o1" for a heavy reasoning phase).
- timeoutMs: optional session timeout in ms for this phase. Use for phases expected to
  take longer than the default (e.g. a large code-generation phase).
- agentName: optional name of a custom agent to activate for this phase. Only set when
  the user's --agent-dir provides a named agent that fits the phase's role.
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
    model: gpt-4o-mini    # optional: cheaper model for bulk code generation
    timeoutMs: 1800000    # optional: 30 min for a heavy phase
    agentName: billing-expert   # optional: activate a custom agent for this phase
    dependsOn: [design]
  - id: review
    description: Review the implementation for quality and correctness.
    type: agent
    agentType: reviewer
    model: o1             # optional: stronger model for validation
    dependsOn: [implement]
\`\`\`

Specification to plan:
${specContent}`;
}

// ── Generate ───────────────────────────────────────────────────────────────────

export interface GeneratePlanOptions {
  model?: string;
  timeoutMs?: number;
  onChunk?: (chunk: string) => void;
}

export interface GeneratePlanResult {
  success: boolean;
  plan?: Plan;
  rawOutput: string;
  error?: string;
}

/**
 * Call the analyst agent with a plan prompt, parse the returned YAML,
 * normalise optional fields, and return the result.
 */
export async function generatePlan(
  specContent: string,
  opts: GeneratePlanOptions = {},
): Promise<GeneratePlanResult> {
  const result = await runAgentTask('analyst', buildPlannerPrompt(specContent), {
    model:     opts.model,
    timeoutMs: opts.timeoutMs,
    onChunk:   opts.onChunk,
  });

  if (!result.success) {
    return { success: false, rawOutput: result.output, error: result.error };
  }

  // Extract YAML from a ```yaml code block, or treat entire response as YAML
  const match   = result.output.match(/```ya?ml\s*\n([\s\S]*?)```/);
  const rawYaml = match ? match[1].trim() : result.output.trim();

  let plan: Plan;
  try {
    plan = yaml.load(rawYaml) as Plan;
    if (!Array.isArray(plan?.phases) || plan.phases.length === 0) {
      throw new Error('No phases found in the generated plan');
    }
  } catch (err) {
    return {
      success: false,
      rawOutput: result.output,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Normalise optional fields (same logic as commands/plan.ts)
  plan.version = (plan.version as string | undefined) ?? '1';
  for (const phase of plan.phases) {
    phase.dependsOn = phase.dependsOn ?? [];
    if (phase.type === 'swarm') {
      phase.topology = (phase.topology as SwarmTopology | undefined) ?? 'hierarchical';
      phase.agents   = (phase.agents   as AgentType[]    | undefined) ?? ['researcher', 'coder', 'reviewer'];
    }
  }

  return { success: true, plan, rawOutput: result.output };
}
