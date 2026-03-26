/**
 * Agent type registry — defines system prompts and capabilities for each
 * built-in agent type. Inspired by Ruflo's 12 agent types.
 */

import type { AgentDefinition, AgentType } from '../types.js';

export const AGENT_REGISTRY: Record<AgentType, AgentDefinition> = {
  coder: {
    model: 'gpt-4o',
    description: 'Writes clean, efficient, production-ready code',
    systemMessage:
      'You are an expert software engineer. Write clean, efficient, production-ready code. ' +
      'Follow best practices, add appropriate error handling, and include inline comments ' +
      'only where logic is non-obvious.',
    capabilities: ['coding', 'implementation', 'refactoring', 'debugging'],
  },

  researcher: {
    model: 'gpt-4o',
    description: 'Investigates topics and gathers information thoroughly',
    systemMessage:
      'You are a thorough researcher. Investigate topics deeply, gather relevant information, ' +
      'and present findings in a clear, structured format with citations where applicable.',
    capabilities: ['research', 'analysis', 'documentation', 'summarisation'],
  },

  tester: {
    model: 'gpt-4o',
    description: 'Writes comprehensive tests and identifies edge cases',
    systemMessage:
      'You are a testing expert. Write comprehensive unit tests, integration tests, and ' +
      'identify edge cases. Follow TDD principles and aim for high coverage of critical paths.',
    capabilities: ['testing', 'validation', 'coverage-analysis', 'qa'],
  },

  reviewer: {
    model: 'gpt-4o',
    description: 'Reviews code for quality, correctness, and security',
    systemMessage:
      'You are a senior code reviewer. Identify bugs, security vulnerabilities, performance ' +
      'issues, and style violations. Be constructive and specific. Prioritise critical issues.',
    capabilities: ['code-review', 'security', 'quality', 'feedback'],
  },

  architect: {
    model: 'gpt-4o',
    description: 'Designs system architecture and makes high-level technical decisions',
    systemMessage:
      'You are a software architect. Design scalable, maintainable system architectures. ' +
      'Consider trade-offs, scalability, security, and long-term maintainability. Produce ' +
      'clear diagrams and decision rationale.',
    capabilities: ['architecture', 'design', 'planning', 'decision-making'],
  },

  coordinator: {
    model: 'gpt-4o',
    description: 'Coordinates multi-agent workflows and decomposes complex tasks',
    systemMessage:
      'You are a multi-agent coordinator. Break down complex tasks into clear subtasks. ' +
      'Assign work to appropriate specialists and synthesise their outputs into a coherent result.',
    capabilities: ['coordination', 'planning', 'decomposition', 'synthesis'],
  },

  analyst: {
    model: 'gpt-4o',
    description: 'Analyses requirements, data, and systems',
    systemMessage:
      'You are a requirements and systems analyst. Analyse requirements, identify ambiguities, ' +
      'and produce precise specifications. Investigate system behaviour and propose solutions.',
    capabilities: ['analysis', 'requirements', 'specification', 'problem-solving'],
  },

  debugger: {
    model: 'gpt-4o',
    description: 'Diagnoses and fixes bugs and runtime issues',
    systemMessage:
      'You are a debugging specialist. Methodically identify root causes of bugs and runtime ' +
      'issues. Propose targeted fixes with minimal side effects. Explain your diagnosis clearly.',
    capabilities: ['debugging', 'root-cause-analysis', 'fixing', 'tracing'],
  },

  documenter: {
    model: 'gpt-4o',
    description: 'Writes clear technical documentation',
    systemMessage:
      'You are a technical writer. Write clear, concise, and accurate documentation including ' +
      'READMEs, API docs, and inline comments. Tailor content to the intended audience.',
    capabilities: ['documentation', 'writing', 'api-docs', 'readme'],
  },

  optimizer: {
    model: 'gpt-4o',
    description: 'Optimises code for performance and efficiency',
    systemMessage:
      'You are a performance optimisation specialist. Profile and optimise code for speed, ' +
      'memory, and efficiency. Explain the impact of each optimisation and any trade-offs.',
    capabilities: ['optimisation', 'performance', 'profiling', 'refactoring'],
  },

  'security-auditor': {
    model: 'gpt-4o',
    description: 'Audits code and systems for security vulnerabilities',
    systemMessage:
      'You are a security auditor. Identify OWASP Top 10 vulnerabilities, injection flaws, ' +
      'authentication weaknesses, and insecure configurations. Provide concrete remediation steps.',
    capabilities: ['security', 'vulnerability-scanning', 'penetration-testing', 'remediation'],
  },

  'performance-engineer': {
    model: 'gpt-4o',
    description: 'Engineers systems for high performance and scalability',
    systemMessage:
      'You are a performance engineer. Design and implement high-performance systems. Conduct ' +
      'benchmarks, analyse bottlenecks, and recommend architecture changes for scalability.',
    capabilities: ['performance-engineering', 'benchmarking', 'scalability', 'infrastructure'],
  },
};

/** Get the definition for an agent type, or throw if unknown. */
export function getAgentDefinition(type: AgentType): AgentDefinition {
  const def = AGENT_REGISTRY[type];
  if (!def) throw new Error(`Unknown agent type: ${type}`);
  return def;
}

/** Return all agent types as an array. */
export function listAgentTypes(): AgentType[] {
  return Object.keys(AGENT_REGISTRY) as AgentType[];
}

/**
 * Suggest the best agent type for a given task description.
 * Simple keyword-based routing — no ML required.
 */
export function routeTask(task: string): AgentType {
  const t = task.toLowerCase();

  if (/secur|vuln|exploit|cve|owasp|auth(entication|orization)/.test(t)) return 'security-auditor';
  if (/test|spec|coverage|tdd|jest|vitest|mocha/.test(t)) return 'tester';
  if (/review|audit|quality|lint|feedback/.test(t)) return 'reviewer';
  if (/architect|design|system|scalab|diagram|adr/.test(t)) return 'architect';
  if (/debug|fix|bug|error|crash|exception|trace/.test(t)) return 'debugger';
  if (/document|readme|jsdoc|api doc|comment/.test(t)) return 'documenter';
  if (/optim|performance|speed|memory|profil|bench/.test(t)) return 'optimizer';
  if (/research|investigate|find|explore|gather/.test(t)) return 'researcher';
  if (/analys|requirement|spec|business logic/.test(t)) return 'analyst';
  if (/coordinat|orchestrat|plan|decompos|workflow/.test(t)) return 'coordinator';
  if (/implement|write|build|create|add|refactor/.test(t)) return 'coder';

  return 'coder'; // sensible default
}
