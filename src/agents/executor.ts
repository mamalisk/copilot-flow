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

export interface RunTaskOptions {
  /** Override the model from the agent registry. */
  model?: string;
  /** Session timeout in ms. Default: 120_000 (2 minutes). */
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
  const model = options.model ?? def.model;
  const timeoutMs = options.timeoutMs ?? 120_000;
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
        output.debug(`[${agentType}] Creating session (model: ${model}, attempt: ${attempts})`);

        const session = await client.createSession({
          model,
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

        if (options.onChunk) {
          session.on('assistant.message_delta', (e: { data: { deltaContent: string } }) => {
            const chunk = e.data.deltaContent ?? '';
            options.onChunk!(chunk);
            collected += chunk;
          });
        }

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
