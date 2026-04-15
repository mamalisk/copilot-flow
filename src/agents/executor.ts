/**
 * Agent executor — creates a Copilot session for an agent type and runs a task,
 * wrapping everything with retry logic and streaming support.
 */

import { approveAll } from '@github/copilot-sdk';
import type { CustomAgentConfig } from '@github/copilot-sdk';
import { clientManager } from '../core/client-manager.js';
import { withRetry, RetryPredicates } from '../core/retry.js';
import { classifyError } from '../core/error-handler.js';
import { output } from '../output.js';
import { getAgentDefinition } from './registry.js';
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
  // Use explicitly passed model, then agent registry default, then config default.
  // Empty string means "let the Copilot CLI choose" — omitted from createSession entirely.
  const model = options.model || def.model || '';
  const timeoutMs = options.timeoutMs ?? 1_200_000;
  const startTime = Date.now();
  let attempts = 0;

  const onRetry = (err: Error, attempt: number, nextDelay: number) => {
    output.warn(
      `[${agentType}] Retry ${attempt} in ${nextDelay}ms — ${err.message.slice(0, 80)}`
    );
  };

  let sessionId = '';

  try {
    const output_text = await withRetry(
      async () => {
        attempts++;
        const client = await clientManager.getClient();
        output.debug(`[${agentType}] Creating session (model: ${model || 'default'}, attempt: ${attempts})`);

        const session = await client.createSession({
          ...(model && { model }),
          onPermissionRequest: approveAll,

          // Repo instructions go into the dedicated custom_instructions section so
          // they don't overwrite the agent's own system message.
          systemMessage: options.instructionsContent
            ? {
                mode: 'customize' as const,
                content: def.systemMessage,
                sections: {
                  custom_instructions: {
                    action: 'append' as const,
                    content: options.instructionsContent,
                  },
                } as Record<string, { action: 'append' | 'replace' | 'remove'; content?: string }>,
              }
            : { content: def.systemMessage },

          // Skills
          ...(options.skillDirectories?.length && { skillDirectories: options.skillDirectories }),
          ...(options.disabledSkills?.length   && { disabledSkills:   options.disabledSkills   }),

          // Custom agents
          ...(options.customAgents?.length     && { customAgents:     options.customAgents     }),
          ...(options.agentName                && { agent:            options.agentName        }),
        });

        sessionId = session.sessionId;
        output.debug(`[${agentType}] Session started: ${sessionId}`);

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
              output.dim(`  [${agentType}] ─── Response ──────────────────────────────`);
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
            output.dim(`  [${agentType}] Thinking…`);
          }
        });

        // Intent — what the agent plans to do next.
        session.on('assistant.intent', (e: { data: { intent: string } }) => {
          if (!responseStarted) {
            output.dim(`  [${agentType}] ${e.data.intent}`);
          }
        });

        // Tool calls — show name plus the most informative argument.
        session.on('tool.execution_start', (e: { data: { toolCallId: string; toolName: string; arguments?: Record<string, unknown> } }) => {
          toolCallNames.set(e.data.toolCallId, e.data.toolName);
          if (!responseStarted) {
            output.dim(`  [${agentType}] → ${e.data.toolName}${formatToolArgs(e.data.arguments)}`);
          }
        });
        session.on('tool.execution_progress', (e: { data: { progressMessage: string } }) => {
          if (!responseStarted) {
            output.dim(`  [${agentType}]   ${e.data.progressMessage}`);
          }
        });
        // Report tool failures regardless of streaming state.
        session.on('tool.execution_complete', (e: { data: { toolCallId: string; success: boolean } }) => {
          if (!e.data.success) {
            const name = toolCallNames.get(e.data.toolCallId) ?? 'tool';
            output.warn(`[${agentType}] ✗ ${name} failed`);
          }
        });

        output.debug(`[${agentType}] Sending prompt (${task.length} chars, timeout: ${timeoutMs}ms)`);
        const result = await session.sendAndWait({ prompt: task }, timeoutMs);

        // Prefer the full message from sendAndWait; fall back to streamed text
        const finalText =
          (result as { data?: { content?: string } } | undefined)?.data?.content ??
          collected;

        await session.disconnect();
        output.debug(`[${agentType}] Session completed: ${sessionId}`);

        return finalText;
      },
      {
        ...options.retryConfig,
        retryOn: options.retryConfig?.retryOn ?? RetryPredicates.copilotErrors,
        onRetry: options.retryConfig?.onRetry ?? onRetry,
      }
    );

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
    output.error(`[${agentType}] Failed after ${attempts} attempt(s): ${classified.message}`);
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
