/**
 * Hook registry — priority-ordered pub/sub for lifecycle events.
 */

import type { HookEvent, HookHandler, HookContext } from '../types.js';

interface HookEntry {
  id: string;
  event: HookEvent;
  handler: HookHandler;
  priority: number;
}

let _nextId = 0;

export class HookRegistry {
  private hooks: HookEntry[] = [];

  /** Register a handler for an event. Higher priority runs first. Default: 50. */
  on(event: HookEvent, handler: HookHandler, priority = 50): () => void {
    const entry: HookEntry = { id: String(_nextId++), event, handler, priority };
    this.hooks.push(entry);
    this.hooks.sort((a, b) => b.priority - a.priority);
    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /** Unregister a handler. */
  off(event: HookEvent, handler: HookHandler): void {
    this.hooks = this.hooks.filter(h => !(h.event === event && h.handler === handler));
  }

  /** Get handlers registered for an event, sorted by priority. */
  getHandlers(event: HookEvent): HookHandler[] {
    return this.hooks.filter(h => h.event === event).map(h => h.handler);
  }

  /** Return all registered hooks (for inspection). */
  list(): Array<{ id: string; event: HookEvent; priority: number }> {
    return this.hooks.map(({ id, event, priority }) => ({ id, event, priority }));
  }

  clear(): void {
    this.hooks = [];
  }
}

export const globalHooks = new HookRegistry();
