/**
 * Agent executor — creates a Copilot session for an agent type and runs a task,
 * wrapping everything with retry logic and streaming support.
 */

import fs from 'fs';
import path from 'path';
import { approveAll } from '@github/copilot-sdk';
import type { CustomAgentConfig } from '@github/copilot-sdk';
import { clientManager } from '../core/client-manager.js';
import { withRetry, RetryPredicates } from '../core/retry.js';
import { classifyError } from '../core/error-handler.js';
import { output } from '../output.js';
import { hooks } from '../hooks/executor.js';
import { getAgentDefinition } from './registry.js';
import { appendLesson } from '../memory/inject.js';
import type { AgentType, AgentResult } from '../types.js';
import type { RetryConfig } from '../core/retry.js';

// Re-export RetryConfig from types for convenience
export type { AgentType, AgentResult };

/** Extract the most useful argument from a tool call for display (path, command, query, etc.). */
function formatToolArgs(args?: Record<string, unknown>): string {
  if (!args) return '';
  const first = Object.entries(args).find(([, v]) => typeof v === 'string');
  if (!first) return '';
  const val = String(first[1]);
  return ': ' + (val.length > 80 ? val.slice(0, 77) + '…' : val);
}

export interface RunTaskOptions {
  /** Override the model from the agent registry. */
  model?: string;
  /** Session timeout in ms. Default: 1_200_000 (20 minutes). */
  timeoutMs?: number;
  /** Retry configuration override. */
  retryConfig?: Partial<RetryConfig>;
  /** Called with each streamed text delta (for live output). */
  onChunk?: (text: string) => void;
  /** Content of a repo instructions file, injected into the custom_instructions section. */
  instructionsContent?: string;
  /** Directories to scan for SKILL.md files. */
  skillDirectories?: string[];
  /** Skill names to disable for this session. */
  disabledSkills?: string[];
  /** Custom agent definitions to register in the session. */
  customAgents?: CustomAgentConfig[];
  /** Name of the custom agent to activate for this session. */
  agentName?: string;
  /**
   * Short label used in all progress output (e.g. "coder/task-2").
   * Defaults to agentType. Set by the swarm coordinator and exec runner
   * so parallel agents of the same type are distinguishable in logs.
   */
  label?: string;
}

/**
 * Run a task using a specific agent type.
 * Creates a fresh Copilot session, sends the prompt, collects the response,
 * and disconnects. Retries on transient failures.
 */
export async function runAgentTask(
  agentType: AgentType,
  task: string,
  options: RunTaskOptions = {}
): Promise<AgentResult> {
  const def = getAgentDefinition(agentType);

  // Check for a project-local system prompt override in .github/agents/<type>.md.
  // When the file exists its trimmed content replaces the registry default so teams
  // can tailor agent behaviour without touching the package source.
  const customPromptPath = path.join(process.cwd(), '.github', 'agents', `${agentType}.md`);
  const systemMessage = fs.existsSync(customPromptPath)
    ? fs.readFileSync(customPromptPath, 'utf-8').trim()
    : def.systemMessage;

  // Use explicitly passed model, then agent registry default, then config default.
  // Empty string means "let the Copilot CLI choose" — omitted from createSession entirely.
  const model = options.model || def.model || '';
  const timeoutMs = options.timeoutMs ?? 1_200_000;
  const startTime = Date.now();
  let attempts = 0;

  // Label used in all progress output. Callers (coordinator, exec) pass a unique
  // label such as "coder/task-2" or "analyst/design" so parallel agents are
  // distinguishable. Defaults to the bare agent type for single-agent runs.
  const displayLabel = options.label ?? agentType;

  const onRetry = (err: Error, attempt: number, nextDelay: number) => {
    output.warn(
      `[${displayLabel}] Retry ${attempt} in ${nextDelay}ms — ${err.message.slice(0, 80)}`
    );
  };

  let sessionId = '';
  // Accumulated tool names for telemetry (reset per outer attempt, not per retry).
  const toolsInvoked: string[] = [];

  try {
    void hooks.preTask({ agentType, label: displayLabel });

    const output_text = await withRetry(
      async () => {
        attempts++;
        const client = await clientManager.getClient();
        output.debug(`[${displayLabel}] Creating session (model: ${model || 'default'}, attempt: ${attempts})`);

        const session = await client.createSession({
          ...(model && { model }),
          onPermissionRequest: approveAll,
          // Copilot binary 1.0.24+ sends elicitation.requested for file/action
          // confirmations. Without this handler the request hangs and the tool
          // reports failure. Accept all elicitations automatically.
          onElicitationRequest: () => ({ action: 'accept' as const, content: { confirmed: true } }),

          // Repo instructions go into the dedicated custom_instructions section so
          // they don't overwrite the agent's own system message.
          systemMessage: options.instructionsContent
            ? {
                mode: 'customize' as const,
                content: systemMessage,
                sections: {
                  custom_instructions: {
                    action: 'append' as const,
                    content: options.instructionsContent,
                  },
                } as Record<string, { action: 'append' | 'replace' | 'remove'; content?: string }>,
              }
            : { content: systemMessage },

          // Skills
          ...(options.skillDirectories?.length && { skillDirectories: options.skillDirectories }),
          ...(options.disabledSkills?.length   && { disabledSkills:   options.disabledSkills   }),

          // Custom agents
          ...(options.customAgents?.length     && { customAgents:     options.customAgents     }),
          ...(options.agentName                && { agent:            options.agentName        }),
        });

        sessionId = session.sessionId;
        output.debug(`[${displayLabel}] Session started: ${sessionId}`);
        void hooks.sessionStart({ agentType, label: displayLabel, sessionId, model: model || 'default' });

        let collected = '';
        // Once streaming response text starts, suppress further progress lines so
        // they don't interleave with the response on stdout.
        let responseStarted = false;
        // Reasoning models (o1/o3) emit reasoning_delta before the response.
        let reasoningShown = false;
        // Map toolCallId → toolName so we can report which tool failed.
        const toolCallNames = new Map<string, string>();

        // ── Response streaming ───────────────────────────────────────────────
        // Print a clear separator before the first chunk so progress logs and
        // response text are visually separated.
        if (options.onChunk) {
          session.on('assistant.message_delta', (e: { data: { deltaContent: string } }) => {
            if (!responseStarted) {
              responseStarted = true;
              output.blank();
              output.dim(`  [${displayLabel}] ─── Response ──────────────────────────────`);
            }
            const chunk = e.data.deltaContent ?? '';
            options.onChunk!(chunk);
            collected += chunk;
          });
        }

        // ── Progress events ──────────────────────────────────────────────────
        // Reasoning (o1/o3 models) — show a single indicator, not the full content.
        session.on('assistant.reasoning_delta', (_e: unknown) => {
          if (!reasoningShown && !responseStarted) {
            reasoningShown = true;
            output.dim(`  [${displayLabel}] Thinking…`);
          }
        });

        // Intent — what the agent plans to do next.
        session.on('assistant.intent', (e: { data: { intent: string } }) => {
          if (!responseStarted) {
            output.dim(`  [${displayLabel}] ${e.data.intent}`);
          }
        });

        // Tool calls — show name plus the most informative argument.
        session.on('tool.execution_start', (e: { data: { toolCallId: string; toolName: string; arguments?: Record<string, unknown> } }) => {
          toolCallNames.set(e.data.toolCallId, e.data.toolName);
          toolsInvoked.push(e.data.toolName);
          if (!responseStarted) {
            output.dim(`  [${displayLabel}] → ${e.data.toolName}${formatToolArgs(e.data.arguments)}`);
          }
        });
        session.on('permission.completed', (e: { data: { result: { kind: string } } }) => {
          if (e.data.result.kind !== 'approved') {
            output.warn(`[${displayLabel}] permission denied: ${e.data.result.kind}`);
          }
        });
        session.on('tool.execution_progress', (e: { data: { progressMessage: string } }) => {
          if (!responseStarted) {
            output.dim(`  [${displayLabel}]   ${e.data.progressMessage}`);
          }
        });
        // Report tool failures regardless of streaming state.
        session.on('tool.execution_complete', (e: { data: { toolCallId: string; success: boolean; error?: { message: string; code?: string } } }) => {
          if (!e.data.success) {
            const name = toolCallNames.get(e.data.toolCallId) ?? 'tool';
            const detail = e.data.error ? ` (${e.data.error.code ?? ''}: ${e.data.error.message})` : '';
            output.warn(`[${displayLabel}] ✗ ${name} failed${detail}`);
          }
        });

        output.debug(`[${displayLabel}] Sending prompt (${task.length} chars, timeout: ${timeoutMs}ms)`);
        const result = await session.sendAndWait({ prompt: task }, timeoutMs);

        // Prefer the full message from sendAndWait; fall back to streamed text
        const finalText =
          (result as { data?: { content?: string } } | undefined)?.data?.content ??
          collected;

        await session.disconnect();
        output.debug(`[${displayLabel}] Session completed: ${sessionId}`);
        void hooks.sessionEnd({ agentType, label: displayLabel, sessionId, success: true });

        return finalText;
      },
      {
        ...options.retryConfig,
        retryOn: options.retryConfig?.retryOn ?? RetryPredicates.copilotErrors,
        onRetry: options.retryConfig?.onRetry ?? onRetry,
      }
    );

    await hooks.postTask({ agentType, label: displayLabel, success: true, durationMs: Date.now() - startTime, attempts, promptChars: task.length, responseChars: output_text.length, model, sessionId, toolsInvoked });

    return {
      agentType,
      agentId: `${agentType}-${Date.now()}`,
      sessionId,
      output: output_text,
      durationMs: Date.now() - startTime,
      attempts,
      success: true,
    };
  } catch (err) {
    const classified = classifyError(err);
    output.error(`[${displayLabel}] Failed after ${attempts} attempt(s): ${classified.message}`);
    await hooks.postTask({ agentType, label: displayLabel, success: false, durationMs: Date.now() - startTime, attempts, promptChars: task.length, responseChars: 0, model, sessionId, toolsInvoked, error: classified.message });
    // Record a permanent lesson so future runs know this agent/task combination fails
    appendLesson(
      agentType,
      `agent-failure:${agentType}-${Date.now()}`,
      `Agent "${agentType}" exhausted ${attempts} retry attempt(s): ${classified.message}`,
    );
    if (classified.category === 'authentication') {
      output.dim('  → On enterprise/managed Macs: set GITHUB_TOKEN or GH_TOKEN to skip keychain');
      output.dim('  →   export GITHUB_TOKEN=<your-pat>   # GitHub PAT with Copilot access');
      output.dim('  →   export GH_TOKEN=$(gh auth token)  # if gh CLI is already authenticated');
      output.dim('  → On personal machines: run: copilot login');
    } else if (classified.category === 'not_found' && classified.message.toLowerCase().includes('model')) {
      output.dim(`  → Model "${model}" is not available on your Copilot plan.`);
      output.dim('  → Try a different model with --model <name>, e.g.:');
      output.dim('  →   --model claude-sonnet-4-5');
      output.dim('  →   --model gpt-4o-mini');
      output.dim('  →   --model o3-mini');
      output.dim('  → Or set a permanent default: COPILOT_FLOW_DEFAULT_MODEL=<name>');
    } else if (classified.category === 'copilot_not_installed') {
      output.dim('  → Install the Copilot CLI: https://github.com/github/copilot');
    }

    return {
      agentType,
      agentId: `${agentType}-${Date.now()}`,
      sessionId,
      output: '',
      durationMs: Date.now() - startTime,
      attempts,
      success: false,
      error: classified.message,
    };
  }
}
