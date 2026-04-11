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
  /** Model override — takes precedence over the agent registry and config default. */
  model?: string;
  /** Session timeout in ms. Overrides the executor default (120 000). */
  timeoutMs?: number;
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
  /** Default session timeout in ms. Default: 120000 (2 min). CLI --timeout overrides per-run. */
  defaultTimeoutMs: number;
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

// ─── Plan / Exec Types ────────────────────────────────────────────────────────

export interface PlanPhase {
  /** Unique kebab-case identifier used for output filename and dependsOn references. */
  id: string;
  /** Human-readable description of what this phase should accomplish. */
  description: string;
  /** 'agent' runs a single specialist; 'swarm' runs a multi-agent pipeline. */
  type: 'agent' | 'swarm';
  /** Agent type (required when type is 'agent'). */
  agentType?: AgentType;
  /** Swarm topology (used when type is 'swarm'). Default: 'hierarchical'. */
  topology?: SwarmTopology;
  /** Agent types in the swarm pipeline (used when type is 'swarm'). */
  agents?: AgentType[];
  /** Output filename. Defaults to phase-{id}.md. */
  output?: string;
  /** IDs of phases that must complete before this one. */
  dependsOn?: string[];
  /**
   * Natural-language description of what the output must contain or achieve.
   * When set, a reviewer agent evaluates the output before the phase is marked
   * complete. On failure the phase is re-run up to maxAcceptanceRetries times.
   */
  acceptanceCriteria?: string;
  /** Max additional attempts on acceptance failure. Default: 2 (3 total). */
  maxAcceptanceRetries?: number;
}

export interface Plan {
  version: string;
  /** Path to the original spec file — injected into every phase prompt. */
  spec: string;
  phases: PlanPhase[];
}

// ─── CLI Types ────────────────────────────────────────────────────────────────

export interface CommandContext {
  args: string[];
  flags: Record<string, unknown>;
  config: CopilotFlowConfig;
  cwd: string;
}
