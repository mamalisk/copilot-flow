/**
 * Telemetry collector — registers a post-task hook handler that persists
 * one run record per completed agent task.
 *
 * Call registerTelemetryCollector() once at CLI startup (commands/index.ts).
 * The hook fires automatically after every runAgentTask() call.
 */

import { globalHooks } from '../hooks/registry.js';
import { getTelemetryStore } from './store.js';
import type { AgentType } from '../types.js';

export function registerTelemetryCollector(): void {
  globalHooks.on('post-task', async (ctx) => {
    const d = ctx.data as Record<string, unknown>;
    try {
      getTelemetryStore().record({
        id:            `run-${ctx.timestamp}-${Math.random().toString(36).slice(2)}`,
        agentType:     (d.agentType as AgentType) ?? 'coder',
        label:         String(d.label ?? d.agentType ?? ''),
        sessionId:     String(d.sessionId ?? ''),
        model:         String(d.model ?? ''),
        success:       Boolean(d.success),
        durationMs:    Number(d.durationMs ?? 0),
        attempts:      Number(d.attempts ?? 1),
        promptChars:   Number(d.promptChars ?? 0),
        responseChars: Number(d.responseChars ?? 0),
        toolsInvoked:  Array.isArray(d.toolsInvoked) ? (d.toolsInvoked as string[]) : [],
        error:         d.error != null ? String(d.error) : undefined,
        createdAt:     ctx.timestamp,
      });
    } catch { /* non-fatal — telemetry must never break the main flow */ }
  });
}
