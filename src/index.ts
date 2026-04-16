/**
 * copilot-flow — public package API.
 *
 * Import these when using copilot-flow as a library inside your own scripts.
 */

// Core
export { withRetry, calculateDelay, RetryPredicates, DEFAULT_RETRY_CONFIG } from './core/retry.js';
export type { RetryConfig, BackoffStrategy } from './core/retry.js';
export { classifyError, formatError, asCopilotFlowError, isCopilotFlowError } from './core/error-handler.js';
export type { CopilotFlowError, CopilotFlowErrorCategory } from './core/error-handler.js';
export { clientManager, ClientManager } from './core/client-manager.js';

// Agents
export { runAgentTask } from './agents/executor.js';
export { AGENT_REGISTRY, getAgentDefinition, listAgentTypes, routeTask } from './agents/registry.js';
export { agentPool } from './agents/pool.js';

// Swarm
export { runSwarm } from './swarm/coordinator.js';

// Memory
export { MemoryStore, getMemoryStore } from './memory/store.js';
export { distillToMemory } from './memory/distill.js';
export { buildMemoryContext } from './memory/inject.js';

// Hooks
export { globalHooks, HookRegistry } from './hooks/registry.js';
export { emit, hooks } from './hooks/executor.js';

// Config
export { loadConfig, saveConfig, DEFAULT_CONFIG } from './config.js';

// Types
export type {
  AgentType,
  AgentDefinition,
  AgentState,
  AgentResult,
  SwarmTask,
  SwarmTopology,
  MemoryEntry,
  StoreOptions,
  HookEvent,
  HookHandler,
  HookContext,
  CopilotFlowConfig,
  CommandContext,
} from './types.js';
