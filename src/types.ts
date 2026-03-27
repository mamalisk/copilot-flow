/**
 * Shared TypeScript types and interfaces for copilot-flow.
 */

import type { RetryConfig } from './core/retry.js';
import type { CustomAgentConfig } from '@github/copilot-sdk';

// ─── Agent Types ─────────────────────────────────────────────────────────────

export const AGENT_TYPE_LIST = [
  'coder',
  'researcher',
  'tester',
  'reviewer',
  'architect',
  'coordinator',
  'analyst',
  'debugger',
  'documenter',
  'optimizer',
  'security-auditor',
  'performance-engineer',
] as const;

export type AgentType = (typeof AGENT_TYPE_LIST)[number];

export interface AgentDefinition {
  model: string;
  systemMessage: string;
  description: string;
  capabilities: string[];
}

export interface AgentState {
  id: string;
  type: AgentType;
  sessionId: string;
  status: 'idle' | 'busy' | 'error' | 'terminated';
  task?: string;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export interface AgentResult {
  agentType: AgentType;
  agentId: string;
  sessionId: string;
  output: string;
  durationMs: number;
  attempts: number;
  success: boolean;
  error?: string;
}

// ─── Session Extension Types ──────────────────────────────────────────────────

/**
 * SDK-level session customisations shared between RunTaskOptions and SwarmTask.
 * All fields are optional — omitting them uses SDK defaults.
 */
export interface SessionExtensions {
  /** Content of a repo instructions file, injected into the custom_instructions section. */
  instructionsContent?: string;
  /** Directories to scan for SKILL.md files. */
  skillDirectories?: string[];
  /** Skill names to disable for this session. */
  disabledSkills?: string[];
  /** Custom agent definitions to register. */
  customAgents?: CustomAgentConfig[];
  /** Name of the custom agent to activate. */
  agentName?: string;
}

// ─── Swarm Types ──────────────────────────────────────────────────────────────

export type SwarmTopology = 'hierarchical' | 'mesh' | 'sequential';

export interface SwarmTask {
  id: string;
  agentType: AgentType;
  prompt: string;
  /** IDs of tasks that must complete before this one. */
  dependsOn?: string[];
  retryConfig?: Partial<RetryConfig>;
  /** Session-level options forwarded to runAgentTask for every agent in this task. */
  sessionOptions?: SessionExtensions;
}

export interface SwarmState {
  id: string;
  topology: SwarmTopology;
  tasks: SwarmTask[];
  status: 'idle' | 'running' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;
}

// ─── Memory Types ─────────────────────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  namespace: string;
  key: string;
  value: string;
  tags: string[];
  createdAt: number;
  expiresAt?: number;
}

export interface StoreOptions {
  /** TTL in milliseconds. Entry is deleted after this duration. */
  ttlMs?: number;
  tags?: string[];
}

// ─── Hook Types ───────────────────────────────────────────────────────────────

export type HookEvent =
  | 'pre-task'
  | 'post-task'
  | 'session-start'
  | 'session-end'
  | 'agent-spawn'
  | 'agent-terminate'
  | 'swarm-start'
  | 'swarm-end';

export interface HookContext<T = unknown> {
  event: HookEvent;
  timestamp: number;
  data?: T;
  metadata?: Record<string, unknown>;
}

export type HookHandler<T = unknown> = (ctx: HookContext<T>) => Promise<void>;

// ─── Config Types ─────────────────────────────────────────────────────────────

export interface CopilotFlowConfig {
  version: string;
  /** Default model passed to createSession(). Default: 'gpt-4o' */
  defaultModel: string;
  swarm: {
    topology: SwarmTopology;
    /** Maximum concurrent sessions. Default: 8 */
    maxAgents: number;
  };
  memory: {
    backend: 'sqlite' | 'memory';
    /** Path to SQLite file. Default: .copilot-flow/memory.db */
    path: string;
  };
  retry: RetryConfig;
  hooks: {
    enabled: boolean;
    /** Per-hook execution timeout in ms. Default: 5000 */
    timeoutMs: number;
  };
  instructions: {
    /** Path to repo instructions file. Default: .github/copilot-instructions.md */
    file: string;
    /** Auto-load the file on every agent/swarm run if it exists. Default: true */
    autoLoad: boolean;
  };
  skills: {
    /** Directories scanned for SKILL.md files on every run. */
    directories: string[];
    /** Skill names to disable globally. */
    disabled: string[];
  };
  agents: {
    /** Directories scanned for *.json custom agent definition files. */
    directories: string[];
  };
}

// ─── CLI Types ────────────────────────────────────────────────────────────────

export interface CommandContext {
  args: string[];
  flags: Record<string, unknown>;
  config: CopilotFlowConfig;
  cwd: string;
}
