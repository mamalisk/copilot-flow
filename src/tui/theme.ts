/**
 * Shared visual constants for the copilot-flow TUI.
 */

export const AGENT_COLORS: Record<string, string> = {
  coder: 'blue',
  researcher: 'cyan',
  tester: 'green',
  reviewer: 'yellow',
  architect: 'magenta',
  coordinator: 'white',
  analyst: 'cyan',
  debugger: 'red',
  documenter: 'white',
  optimizer: 'green',
  'security-auditor': 'red',
  'performance-engineer': 'yellow',
  orchestrator: 'magenta',
  'product-manager': 'white',
};

export const STATUS_ICONS = {
  waiting: '○',
  running: '●',
  done:    '✓',
  failed:  '✗',
  skipped: '⊘',
} as const;

export type StatusKind = keyof typeof STATUS_ICONS;

export function agentColor(type: string): string {
  return AGENT_COLORS[type] ?? 'white';
}

export function importanceStars(n: number): string {
  const clamped = Math.max(0, Math.min(5, Math.round(n)));
  return '★'.repeat(clamped) + '☆'.repeat(5 - clamped);
}

/** Interpolate a green→yellow→red color based on 0–1 fill ratio. */
export function barColor(ratio: number): string {
  if (ratio >= 0.75) return 'red';
  if (ratio >= 0.5)  return 'yellow';
  return 'green';
}
