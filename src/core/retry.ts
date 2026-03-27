/**
 * Retry engine with configurable backoff strategies, jitter, and intervals.
 * Supports exponential, linear, constant, and fibonacci backoff.
 */

export type BackoffStrategy = 'exponential' | 'linear' | 'constant' | 'fibonacci';

export interface RetryConfig {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts: number;
  /** Initial delay in milliseconds before first retry. Default: 1000 */
  initialDelayMs: number;
  /** Maximum delay cap in milliseconds. Default: 30000 */
  maxDelayMs: number;
  /** Backoff strategy. Default: 'exponential' */
  backoffStrategy: BackoffStrategy;
  /** Multiplier for exponential/linear strategies. Default: 2 */
  multiplier: number;
  /** Apply ±10% random jitter to prevent thundering herd. Default: true */
  jitter: boolean;
  /**
   * Custom predicate — return true to retry on this error.
   * Defaults to RetryPredicates.copilotErrors.
   */
  retryOn?: (error: Error, attempt: number) => boolean;
  /** Called before each retry with error, attempt number, and next delay. */
  onRetry?: (error: Error, attempt: number, nextDelayMs: number) => void;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
  backoffStrategy: 'exponential',
  multiplier: 2,
  jitter: true,
};

// Pre-cached fibonacci values to avoid recomputation
const FIB_CACHE: number[] = [1, 1];
function fib(n: number): number {
  while (FIB_CACHE.length <= n) {
    FIB_CACHE.push(FIB_CACHE[FIB_CACHE.length - 1] + FIB_CACHE[FIB_CACHE.length - 2]);
  }
  return FIB_CACHE[n];
}

/** Calculate the base delay (before jitter) for a given attempt (1-indexed). */
export function calculateDelay(attempt: number, config: RetryConfig): number {
  const { initialDelayMs, maxDelayMs, backoffStrategy, multiplier } = config;
  let delay: number;

  switch (backoffStrategy) {
    case 'exponential':
      delay = initialDelayMs * Math.pow(multiplier, attempt - 1);
      break;
    case 'linear':
      delay = initialDelayMs * attempt;
      break;
    case 'constant':
      delay = initialDelayMs;
      break;
    case 'fibonacci':
      delay = initialDelayMs * fib(attempt - 1);
      break;
    default:
      delay = initialDelayMs;
  }

  if (config.jitter) {
    // Apply ±10% random jitter
    const jitterAmount = (Math.random() - 0.5) * 0.2 * delay;
    delay += jitterAmount;
  }

  return Math.min(Math.max(delay, 0), maxDelayMs);
}

/** Built-in retry predicates for common error categories. */
export const RetryPredicates = {
  networkErrors: (e: Error): boolean =>
    ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE', 'EHOSTUNREACH'].some(
      code => e.message.includes(code) || (e as NodeJS.ErrnoException).code === code
    ),

  rateLimitErrors: (e: Error): boolean =>
    e.message.includes('429') ||
    e.message.toLowerCase().includes('rate limit') ||
    e.message.toLowerCase().includes('too many requests'),

  serverErrors: (e: Error): boolean =>
    /\b5[0-9]{2}\b/.test(e.message) ||
    e.message.toLowerCase().includes('internal server error') ||
    e.message.toLowerCase().includes('service unavailable'),

  timeoutErrors: (e: Error): boolean =>
    e.message.toLowerCase().includes('timeout') ||
    e.message.toLowerCase().includes('timed out'),

  /** Retries on all transient Copilot/network errors. */
  copilotErrors: (e: Error): boolean =>
    RetryPredicates.networkErrors(e) ||
    RetryPredicates.rateLimitErrors(e) ||
    RetryPredicates.serverErrors(e) ||
    RetryPredicates.timeoutErrors(e),

  /** Retry on any error. Use with caution. */
  all: (_e: Error): boolean => true,
};

export interface RetryResult<T> {
  value: T;
  attempts: number;
  totalDurationMs: number;
}

/**
 * Execute `fn` with automatic retries on failure.
 *
 * @example
 * const result = await withRetry(
 *   () => session.sendAndWait({ prompt: task }),
 *   { maxAttempts: 3, backoffStrategy: 'exponential', onRetry: (err, n) => console.log(`Retry ${n}: ${err.message}`) }
 * );
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const cfg: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const retryOn = cfg.retryOn ?? RetryPredicates.copilotErrors;

  const startTime = Date.now();
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const isLastAttempt = attempt >= cfg.maxAttempts;
      if (isLastAttempt || !retryOn(lastError, attempt)) {
        throw lastError;
      }

      const delayMs = calculateDelay(attempt, cfg);
      cfg.onRetry?.(lastError, attempt, delayMs);

      await sleep(delayMs);
    }
  }

  // Should never reach here, but TypeScript needs a return path
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
