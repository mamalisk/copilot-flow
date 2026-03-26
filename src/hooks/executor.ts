/**
 * Hook executor — runs all handlers for an event with timeout protection.
 */

import { globalHooks } from './registry.js';
import { output } from '../output.js';
import type { HookEvent, HookContext } from '../types.js';

const DEFAULT_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Hook timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Emit a hook event and run all registered handlers.
 * Handlers that exceed the timeout or throw are logged but do not block execution.
 *
 * @param continueOnError - If false, the first handler error aborts remaining handlers. Default: true.
 */
export async function emit<T = unknown>(
  event: HookEvent,
  data?: T,
  options: { timeoutMs?: number; continueOnError?: boolean } = {}
): Promise<void> {
  const handlers = globalHooks.getHandlers(event);
  if (handlers.length === 0) return;

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const continueOnError = options.continueOnError ?? true;

  const ctx: HookContext<T> = {
    event,
    timestamp: Date.now(),
    data,
  };

  for (const handler of handlers) {
    try {
      await withTimeout(handler(ctx), timeoutMs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.warn(`Hook [${event}] handler error: ${msg}`);
      if (!continueOnError) throw err;
    }
  }
}

// Convenience wrappers
export const hooks = {
  preTask: (data?: unknown) => emit('pre-task', data),
  postTask: (data?: unknown) => emit('post-task', data),
  sessionStart: (data?: unknown) => emit('session-start', data),
  sessionEnd: (data?: unknown) => emit('session-end', data),
  agentSpawn: (data?: unknown) => emit('agent-spawn', data),
  agentTerminate: (data?: unknown) => emit('agent-terminate', data),
  swarmStart: (data?: unknown) => emit('swarm-start', data),
  swarmEnd: (data?: unknown) => emit('swarm-end', data),
};
