/**
 * Swarm coordinator — orchestrates multiple Copilot sessions as a swarm.
 * Supports hierarchical, mesh, and sequential topologies.
 */

import { runAgentTask } from '../agents/executor.js';
import { hooks } from '../hooks/executor.js';
import { getMemoryStore } from '../memory/store.js';
import { distillToMemory } from '../memory/distill.js';
import { buildMemoryContext } from '../memory/inject.js';
import { output, agentBadge, generateAgentName } from '../output.js';
import type { SwarmTask, SwarmTopology, AgentResult } from '../types.js';

/**
 * Short human-readable description for a task.
 * Uses task.label if set, otherwise takes the first line of the prompt (≤60 chars).
 */
function taskDescription(task: SwarmTask): string {
  const text = task.label ?? task.prompt;
  const firstLine = text.split('\n')[0].trim();
  return firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine;
}

/**
 * Generate a unique display label for a task's agent instance.
 * Uses an inventive adjective+name combo (e.g. "swift-Ada", "keen-Darwin")
 * so parallel agents of the same type are memorable and distinguishable.
 * Called once per task to keep the label stable for the whole run.
 */
function agentLabel(task: SwarmTask): string {
  return generateAgentName(task.agentType);
}

export interface SwarmOptions {
  /** Called whenever an agent produces a text chunk. */
  onProgress?: (taskId: string, agentType: string, chunk: string) => void;
  /** Namespace used for inter-agent memory sharing. Default: 'swarm' */
  memoryNamespace?: string;
}

/**
 * Run a set of tasks as a coordinated swarm.
 *
 * - **sequential**: Tasks run one by one in order.
 * - **hierarchical**: Independent tasks run in parallel; dependent tasks wait.
 * - **mesh**: All tasks run in parallel with shared memory.
 */
export async function runSwarm(
  tasks: SwarmTask[],
  topology: SwarmTopology = 'hierarchical',
  options: SwarmOptions = {}
): Promise<Map<string, AgentResult>> {
  const results = new Map<string, AgentResult>();
  const ns = options.memoryNamespace ?? 'swarm';

  await hooks.swarmStart({ topology, taskCount: tasks.length });
  output.info(`Starting ${topology} swarm with ${tasks.length} task(s)`);

  switch (topology) {
    case 'sequential':
      await runSequential(tasks, results, ns, options);
      break;
    case 'hierarchical':
      await runHierarchical(tasks, results, ns, options);
      break;
    case 'mesh':
      await runMesh(tasks, results, ns, options);
      break;
  }

  await hooks.swarmEnd({ topology, results: Object.fromEntries(results) });
  const succeeded = [...results.values()].filter(r => r.success).length;
  output.success(`Swarm complete: ${succeeded}/${tasks.length} tasks succeeded`);

  return results;
}

/** Run tasks one after another. Results of earlier tasks are stored in memory. */
async function runSequential(
  tasks: SwarmTask[],
  results: Map<string, AgentResult>,
  ns: string,
  options: SwarmOptions
): Promise<void> {
  const mem = getMemoryStore();
  const memCtx = options.memoryNamespace ? buildMemoryContext(options.memoryNamespace) : '';
  for (const task of tasks) {
    output.info(`${agentBadge(task.agentType)} ${task.id} — ${taskDescription(task)}`);
    const result = await runAgentTask(task.agentType, memCtx + buildPrompt(task, results, mem, ns), {
      retryConfig: task.retryConfig,
      ...task.sessionOptions,
      label: agentLabel(task),
      onChunk: options.onProgress
        ? chunk => options.onProgress!(task.id, task.agentType, chunk)
        : undefined,
    });
    results.set(task.id, result);
    if (result.success) {
      mem.store(ns, `task:${task.id}:result`, result.output, { ttlMs: 60 * 60 * 1000 });
      if (options.memoryNamespace) {
        const model = task.sessionOptions?.model ?? '';
        await distillToMemory(result.output, options.memoryNamespace, `task:${task.id}`, model);
      }
    }
  }
}

/**
 * Run independent tasks in parallel; tasks with dependencies wait.
 * Uses a simple wave/level-based execution model.
 */
async function runHierarchical(
  tasks: SwarmTask[],
  results: Map<string, AgentResult>,
  ns: string,
  options: SwarmOptions
): Promise<void> {
  const mem = getMemoryStore();
  const memCtx = options.memoryNamespace ? buildMemoryContext(options.memoryNamespace) : '';
  const remaining = [...tasks];

  while (remaining.length > 0) {
    // Find tasks whose dependencies are all satisfied
    const ready = remaining.filter(t =>
      (t.dependsOn ?? []).every(dep => results.has(dep))
    );

    if (ready.length === 0) {
      throw new Error(
        `Swarm deadlock — no tasks are runnable. Remaining: ${remaining.map(t => t.id).join(', ')}`
      );
    }

    if (ready.length === 1) {
      output.info(`${agentBadge(ready[0].agentType)} ${ready[0].id} — ${taskDescription(ready[0])}`);
    } else {
      output.info(`Running ${ready.length} tasks in parallel:`);
      for (const t of ready) {
        output.dim(`  ${agentBadge(t.agentType)} ${t.id} — ${taskDescription(t)}`);
      }
    }

    const waveResults = await Promise.all(
      ready.map(task =>
        runAgentTask(task.agentType, memCtx + buildPrompt(task, results, mem, ns), {
          retryConfig: task.retryConfig,
          ...task.sessionOptions,
          label: agentLabel(task),
          onChunk: options.onProgress
            ? chunk => options.onProgress!(task.id, task.agentType, chunk)
            : undefined,
        }).then(r => ({ task, result: r }))
      )
    );

    for (const { task, result } of waveResults) {
      results.set(task.id, result);
      remaining.splice(remaining.indexOf(task), 1);
      if (result.success) {
        mem.store(ns, `task:${task.id}:result`, result.output, { ttlMs: 60 * 60 * 1000 });
        if (options.memoryNamespace) {
          const model = task.sessionOptions?.model ?? '';
          await distillToMemory(result.output, options.memoryNamespace, `task:${task.id}`, model);
        }
      }
    }
  }
}

/** All tasks run concurrently with shared memory. */
async function runMesh(
  tasks: SwarmTask[],
  results: Map<string, AgentResult>,
  ns: string,
  options: SwarmOptions
): Promise<void> {
  const mem = getMemoryStore();
  const memCtx = options.memoryNamespace ? buildMemoryContext(options.memoryNamespace) : '';
  output.info(`Running all ${tasks.length} tasks concurrently (mesh):`);
  for (const t of tasks) {
    output.dim(`  ${agentBadge(t.agentType)} ${t.id} — ${taskDescription(t)}`);
  }
  const settled = await Promise.allSettled(
    tasks.map(task =>
      runAgentTask(task.agentType, memCtx + buildPrompt(task, results, mem, ns), {
        retryConfig: task.retryConfig,
        ...task.sessionOptions,
        label: agentLabel(task),
        onChunk: options.onProgress
          ? chunk => options.onProgress!(task.id, task.agentType, chunk)
          : undefined,
      }).then(r => ({ task, result: r }))
    )
  );

  for (const s of settled) {
    if (s.status === 'fulfilled') {
      const { task, result } = s.value;
      results.set(task.id, result);
      if (result.success) {
        mem.store(ns, `task:${task.id}:result`, result.output, { ttlMs: 60 * 60 * 1000 });
        if (options.memoryNamespace) {
          const model = task.sessionOptions?.model ?? '';
          await distillToMemory(result.output, options.memoryNamespace, `task:${task.id}`, model);
        }
      }
    }
  }
}

/**
 * Enrich a task's prompt with available context from already-completed tasks.
 * Injects results from dependencies into the prompt so agents can build on each other.
 */
function buildPrompt(
  task: SwarmTask,
  results: Map<string, AgentResult>,
  mem: ReturnType<typeof getMemoryStore>,
  ns: string
): string {
  let prompt = task.prompt;

  const depContext: string[] = [];
  for (const dep of task.dependsOn ?? []) {
    const cached = mem.retrieve(ns, `task:${dep}:result`);
    if (cached) {
      depContext.push(`--- Output from task "${dep}" ---\n${cached}`);
    } else {
      const result = results.get(dep);
      if (result?.success) {
        depContext.push(`--- Output from task "${dep}" ---\n${result.output}`);
      }
    }
  }

  if (depContext.length > 0) {
    prompt = `Context from previous tasks:\n\n${depContext.join('\n\n')}\n\n---\n\n${prompt}`;
  }

  return prompt;
}
