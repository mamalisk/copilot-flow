/**
 * Configuration loading, defaults, and persistence for copilot-flow.
 */

import fs from 'fs';
import path from 'path';
import type { CopilotFlowConfig } from './types.js';
import { DEFAULT_RETRY_CONFIG } from './core/retry.js';

const CONFIG_DIR = '.copilot-flow';
const CONFIG_FILE = 'config.json';
const CONFIG_VERSION = '1.0.0';

export const DEFAULT_CONFIG: CopilotFlowConfig = {
  version: CONFIG_VERSION,
  defaultModel: process.env.COPILOT_FLOW_DEFAULT_MODEL ?? '',
  defaultTimeoutMs: parseInt(process.env.COPILOT_FLOW_TIMEOUT_MS ?? '1200000', 10),
  swarm: {
    topology: 'hierarchical',
    maxAgents: 8,
  },
  memory: {
    backend: 'sqlite',
    path: path.join(CONFIG_DIR, 'memory.db'),
  },
  retry: {
    ...DEFAULT_RETRY_CONFIG,
    maxAttempts: parseInt(process.env.COPILOT_FLOW_MAX_RETRIES ?? '3', 10),
    initialDelayMs: parseInt(process.env.COPILOT_FLOW_RETRY_DELAY_MS ?? '1000', 10),
  },
  hooks: {
    enabled: true,
    timeoutMs: 5_000,
  },
  instructions: {
    file: '.github/copilot-instructions.md',
    autoLoad: true,
  },
  skills: {
    directories: [],
    disabled: [],
  },
  agents: {
    directories: [],
    models: {},
  },
};

/** Resolve the config file path relative to cwd. */
export function getConfigPath(cwd = process.cwd()): string {
  return path.join(cwd, CONFIG_DIR, CONFIG_FILE);
}

/** Load config from disk, merging with defaults. Returns defaults if file missing. */
export function loadConfig(cwd = process.cwd()): CopilotFlowConfig {
  const configPath = getConfigPath(cwd);

  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CopilotFlowConfig>;
    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** Write config to disk. Creates the directory if it doesn't exist. */
export function saveConfig(config: CopilotFlowConfig, cwd = process.cwd()): void {
  const configDir = path.join(cwd, CONFIG_DIR);
  const configPath = path.join(configDir, CONFIG_FILE);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

/** Deep merge partial config over base config. */
function mergeConfig(
  base: CopilotFlowConfig,
  override: Partial<CopilotFlowConfig>
): CopilotFlowConfig {
  return {
    ...base,
    ...override,
    swarm:        { ...base.swarm,        ...(override.swarm        ?? {}) },
    memory:       { ...base.memory,       ...(override.memory       ?? {}) },
    retry:        { ...base.retry,        ...(override.retry        ?? {}) },
    hooks:        { ...base.hooks,        ...(override.hooks        ?? {}) },
    instructions: { ...base.instructions, ...(override.instructions ?? {}) },
    skills:       { ...base.skills,       ...(override.skills       ?? {}) },
    agents: {
      ...base.agents,
      ...(override.agents ?? {}),
      models: { ...base.agents.models, ...(override.agents?.models ?? {}) },
    },
  };
}

/** Check whether the config directory has been initialised. */
export function isInitialised(cwd = process.cwd()): boolean {
  return fs.existsSync(getConfigPath(cwd));
}

/** Ensure the .copilot-flow/ runtime directories exist. */
export function ensureRuntimeDirs(cwd = process.cwd()): void {
  const base = path.join(cwd, CONFIG_DIR);
  for (const sub of ['', 'agents', 'plans']) {
    const dir = path.join(base, sub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
