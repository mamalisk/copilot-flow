/**
 * Error classification for GitHub Copilot SDK errors.
 * Maps raw errors into structured CopilotFlowError with category and retryability.
 */

export type CopilotFlowErrorCategory =
  | 'copilot_not_installed' // gh copilot CLI not found / SDK cannot start
  | 'authentication'        // not logged in or token invalid (401)
  | 'authorization'         // insufficient permissions (403)
  | 'not_found'             // resource not found (404)
  | 'rate_limit'            // too many requests (429)
  | 'timeout'               // session.sendAndWait() timed out
  | 'session_error'         // session crashed or disconnected unexpectedly
  | 'network'               // connectivity failure
  | 'validation'            // bad input / wrong model name
  | 'unknown';

export interface CopilotFlowError {
  category: CopilotFlowErrorCategory;
  message: string;
  /** Whether this error type is safe to retry. */
  retryable: boolean;
  /** Suggested delay before retry (ms). Present for rate_limit and session_error. */
  retryAfterMs?: number;
  originalError?: unknown;
}

/** Patterns used to classify raw error messages. */
const PATTERNS: Array<{
  test: (msg: string, err: unknown) => boolean;
  category: CopilotFlowErrorCategory;
  retryable: boolean;
  retryAfterMs?: number;
}> = [
  {
    test: msg =>
      msg.includes('copilot: command not found') ||
      msg.includes('enoent') ||
      msg.includes('cannot find') ||
      msg.includes('not installed') ||
      msg.includes('spawn') && msg.includes('enoent'),
    category: 'copilot_not_installed',
    retryable: false,
  },
  {
    test: msg =>
      msg.includes('401') ||
      msg.includes('unauthorized') ||
      msg.includes('authentication') ||
      msg.includes('not authenticated') ||
      msg.includes('login required'),
    category: 'authentication',
    retryable: false,
  },
  {
    test: msg =>
      msg.includes('403') ||
      msg.includes('forbidden') ||
      msg.includes('permission denied') ||
      msg.includes('access denied'),
    category: 'authorization',
    retryable: false,
  },
  {
    test: msg =>
      msg.includes('404') ||
      msg.includes('not found') ||
      msg.includes('unknown model'),
    category: 'not_found',
    retryable: false,
  },
  {
    test: msg =>
      msg.includes('429') ||
      msg.includes('rate limit') ||
      msg.includes('too many requests'),
    category: 'rate_limit',
    retryable: true,
    retryAfterMs: 5_000,
  },
  {
    test: msg =>
      msg.toLowerCase().includes('timeout') ||
      msg.toLowerCase().includes('timed out'),
    category: 'timeout',
    retryable: true,
    retryAfterMs: 1_000,
  },
  {
    test: msg =>
      msg.includes('session') && (
        msg.includes('closed') ||
        msg.includes('disconnect') ||
        msg.includes('crashed') ||
        msg.includes('terminated')
      ),
    category: 'session_error',
    retryable: true,
    retryAfterMs: 2_000,
  },
  {
    test: msg =>
      ['econnreset', 'etimedout', 'econnrefused', 'enotfound', 'epipe'].some(c =>
        msg.includes(c)
      ),
    category: 'network',
    retryable: true,
    retryAfterMs: 1_000,
  },
  {
    test: msg =>
      msg.includes('invalid') ||
      msg.includes('validation') ||
      msg.includes('bad request') ||
      msg.includes('400'),
    category: 'validation',
    retryable: false,
  },
];

/** Classify an unknown thrown value into a structured CopilotFlowError. */
export function classifyError(error: unknown): CopilotFlowError {
  const raw = error instanceof Error ? error : new Error(String(error));
  const msg = raw.message.toLowerCase();

  for (const pattern of PATTERNS) {
    if (pattern.test(msg, error)) {
      return {
        category: pattern.category,
        message: raw.message,
        retryable: pattern.retryable,
        retryAfterMs: pattern.retryAfterMs,
        originalError: error,
      };
    }
  }

  return {
    category: 'unknown',
    message: raw.message,
    retryable: false,
    originalError: error,
  };
}

/** Format a CopilotFlowError for display in the terminal. */
export function formatError(error: CopilotFlowError): string {
  const prefix = `[${error.category.toUpperCase()}]`;
  let msg = `${prefix} ${error.message}`;

  if (error.retryable && error.retryAfterMs) {
    msg += ` (retryable, suggested delay: ${error.retryAfterMs}ms)`;
  } else if (!error.retryable) {
    msg += ` (not retryable)`;
  }

  return msg;
}

/**
 * Wraps an unknown error as a CopilotFlowError and re-throws it.
 * Useful for catch blocks that need structured error info.
 */
export function asCopilotFlowError(error: unknown): CopilotFlowError {
  if (isCopilotFlowError(error)) return error;
  return classifyError(error);
}

export function isCopilotFlowError(value: unknown): value is CopilotFlowError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'category' in value &&
    'message' in value &&
    'retryable' in value
  );
}
