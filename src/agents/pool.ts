/**
 * Agent pool — tracks active agent states in memory and persists them to disk.
 */

import fs from 'fs';
import path from 'path';
import type { AgentState, AgentType } from '../types.js';

const AGENTS_DIR = path.join('.copilot-flow', 'agents');

function ensureDir(): void {
  if (!fs.existsSync(AGENTS_DIR)) {
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
  }
}

function agentPath(id: string): string {
  return path.join(AGENTS_DIR, `${id}.json`);
}

export const agentPool = {
  /** Register a new agent state. */
  register(state: AgentState): void {
    ensureDir();
    fs.writeFileSync(agentPath(state.id), JSON.stringify(state, null, 2));
  },

  /** Update an existing agent state (partial). */
  update(id: string, patch: Partial<AgentState>): void {
    const existing = agentPool.get(id);
    if (!existing) return;
    const updated = { ...existing, ...patch };
    fs.writeFileSync(agentPath(id), JSON.stringify(updated, null, 2));
  },

  /** Get a single agent state by ID. */
  get(id: string): AgentState | null {
    const p = agentPath(id);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as AgentState;
    } catch {
      return null;
    }
  },

  /** List all agent states. */
  list(filter?: { type?: AgentType; status?: AgentState['status'] }): AgentState[] {
    ensureDir();
    const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.json'));
    const agents = files.flatMap(f => {
      try {
        return [JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, f), 'utf-8')) as AgentState];
      } catch {
        return [];
      }
    });

    return agents.filter(a => {
      if (filter?.type && a.type !== filter.type) return false;
      if (filter?.status && a.status !== filter.status) return false;
      return true;
    });
  },

  /** Remove an agent state from disk. */
  remove(id: string): void {
    const p = agentPath(id);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  },

  /** Remove all terminated/errored agents older than maxAgeMs. */
  gc(maxAgeMs = 24 * 60 * 60 * 1_000): void {
    const now = Date.now();
    for (const agent of agentPool.list()) {
      if (
        (agent.status === 'terminated' || agent.status === 'error') &&
        now - agent.startedAt > maxAgeMs
      ) {
        agentPool.remove(agent.id);
      }
    }
  },
};
