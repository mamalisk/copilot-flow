/**
 * Persistent event log — appends every hook event to .copilot-flow/events.jsonl.
 * This allows the TUI monitor screen to display events from any process
 * (CLI commands, TUI-triggered tasks) by polling the file.
 */

import fs from 'fs';
import path from 'path';
import { globalHooks } from './registry.js';
import type { HookEvent, HookContext } from '../types.js';

export const LOG_PATH = path.join(process.cwd(), '.copilot-flow', 'events.jsonl');

const ALL_EVENTS: HookEvent[] = [
  'pre-task', 'post-task',
  'session-start', 'session-end',
  'agent-spawn', 'agent-terminate',
  'swarm-start', 'swarm-end',
];

function appendEvent(ctx: HookContext): void {
  try {
    const dir = path.dirname(LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      LOG_PATH,
      JSON.stringify({ event: ctx.event, ts: ctx.timestamp, data: ctx.data }) + '\n',
      'utf-8',
    );
  } catch { /* non-fatal */ }
}

/**
 * Register hook handlers that persist all lifecycle events to disk.
 * Returns an unsubscribe function.
 * Call once per process (idempotent — duplicate calls just add extra writers).
 */
export function registerEventLog(): () => void {
  const unsubs = ALL_EVENTS.map(evt =>
    globalHooks.on(evt, async (ctx) => appendEvent(ctx as HookContext), 10),
  );
  return () => unsubs.forEach(fn => fn());
}
