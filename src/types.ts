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
  'orchestrator',
  'product-manager',
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
  /** Session timeout in ms. Overrides the executor default (1 200 000). */
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
  /**
   * Short human-readable description shown in progress output.
   * If omitted the first line of the prompt (truncated to 60 chars) is used.
   */
  label?: string;
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

/**
 * Semantic type for a stored memory entry.
 * - 'fact'           — general-purpose observation (default)
 * - 'decision'       — a deliberate choice made during the project
 * - 'workflow-state' — serialised partial swarm result; excluded from prompt injection
 * - 'context'        — background information that sets the scene
 */
export type MemoryType = 'fact' | 'decision' | 'workflow-state' | 'context';

export interface MemoryEntry {
  id: string;
  namespace: string;
  key: string;
  value: string;
  tags: string[];
  /** Importance score 1–5 (default 3). Higher values are injected first. */
  importance: number;
  /**
   * Semantic type of this entry (default: 'fact').
   * 'workflow-state' entries are excluded from prompt injection.
   */
  type: MemoryType;
  createdAt: number;
  expiresAt?: number;
}

export interface StoreOptions {
  /** TTL in milliseconds. Entry is deleted after this duration. */
  ttlMs?: number;
  tags?: string[];
  /**
   * Importance score 1–5 (default 3).
   * 5 = critical (architecture decisions, security constraints)
   * 4 = important (key design choices)
   * 3 = notable (standard facts, configurations)
   * 2 = minor (supporting details)
   * 1 = trivial (low-signal observations)
   * Higher-scored facts are injected first into agent prompts.
   */
  importance?: number;
  /**
   * Semantic type of this entry (default: 'fact').
   * 'workflow-state' entries are excluded from prompt injection — they are
   * reserved for swarm resumption (serialised partial results that should not
   * pollute agent prompts).
   */
  type?: MemoryType;
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
  /** Default session timeout in ms. Default: 1200000 (20 min). CLI --timeout overrides per-run. */
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
    /**
     * Per-agent-type model overrides. Applied when no CLI --model flag or
     * per-phase model is set. Useful for giving the reviewer a stronger model.
     * Example: { "reviewer": "o1-mini", "security-auditor": "o1" }
     */
    models: Partial<Record<AgentType, string>>;
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
   * Model override for this phase. Takes precedence over per-agent-type config
   * and config.defaultModel, but is overridden by the CLI --model flag.
   * Leave unset to use per-agent-type config or the global default.
   */
  model?: string;
  /**
   * Session timeout in ms for this phase. Overrides the CLI --timeout flag and
   * config.defaultTimeoutMs. Useful for long-running phases (e.g. a heavy coder
   * phase) without changing the timeout for the whole run.
   */
  timeoutMs?: number;
  /**
   * Natural-language description of what the output must contain or achieve.
   * When set, a reviewer agent evaluates the output before the phase is marked
   * complete. On failure the phase is re-run up to maxAcceptanceRetries times.
   */
  acceptanceCriteria?: string;
  /** Max additional attempts on acceptance failure. Default: 2 (3 total). */
  maxAcceptanceRetries?: number;
  /**
   * Per-agent task descriptions for swarm phases with duplicate agent types.
   * When set, `subTasks[i]` replaces the generic phase `description` in the
   * prompt for the i-th agent. Required for mesh topology with duplicate agent types
   * so each agent receives distinct work instead of attempting the same task.
   * Length must match the `agents` array length.
   */
  subTasks?: string[];
  /**
   * Name of a custom agent (loaded from agentDirectories, config.agents.directories,
   * or the CLI --agent-dir list) to activate for this phase.
   * For swarm phases the same agent is activated for every session in the swarm.
   */
  agentName?: string;
  /**
   * Additional directories to scan for *.md custom agent definitions for this phase.
   * Merged with config.agents.directories and the CLI --agent-dir list.
   */
  agentDirectories?: string[];
  /**
   * Additional directories to scan for SKILL.md files for this phase.
   * Merged with config.skills.directories and the CLI --skill-dir list.
   */
  skillDirectories?: string[];
  /**
   * Memory tag filter for this phase. When set and `--memory-namespace` is
   * active, only facts whose tags share at least one element with this list
   * are injected into the prompt. Omit to receive all facts in the namespace.
   *
   * Uses the same tag vocabulary as `memory store --tags`:
   * decision | constraint | requirement | architecture | code | api | config
   *
   * Example: a coder phase that should only see code and architecture facts:
   *   contextTags: [code, architecture]
   */
  contextTags?: string[];
}

export interface Plan {
  version: string;
  /** Path to the original spec file — injected into every phase prompt. */
  spec: string;
  phases: PlanPhase[];
}

// ─── Telemetry Types ──────────────────────────────────────────────────────────

export interface TelemetryRun {
  id: string;
  agentType: AgentType;
  label: string;
  sessionId: string;
  model: string;
  success: boolean;
  durationMs: number;
  attempts: number;
  promptChars: number;
  responseChars: number;
  toolsInvoked: string[];
  error?: string;
  createdAt: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export interface TelemetrySummary {
  totalRuns: number;
  /** 0–1 fraction */
  successRate: number;
  avgDurationMs: number;
  avgPromptChars: number;
  avgResponseChars: number;
  byAgentType: Record<string, { runs: number; successRate: number; avgDurationMs: number }>;
  topTools: Array<{ tool: string; count: number }>;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  avgInputTokens?: number;
  avgOutputTokens?: number;
}

// ─── CLI Types ────────────────────────────────────────────────────────────────

export interface CommandContext {
  args: string[];
  flags: Record<string, unknown>;
  config: CopilotFlowConfig;
  cwd: string;
}
