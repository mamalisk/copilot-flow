import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  withRetry,
  calculateDelay,
  RetryPredicates,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
} from '../../src/core/retry.js';

// Speed up tests by skipping real sleep
vi.mock('../../src/core/retry.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/core/retry.js')>();
  return mod;
});

// Replace setTimeout with immediate resolution in tests
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// Helper: advance all timers and flush microtasks
async function flush() {
  await vi.runAllTimersAsync();
}

describe('calculateDelay', () => {
  const base: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    jitter: false, // deterministic for these tests
  };

  it('exponential: doubles each attempt', () => {
    expect(calculateDelay(1, { ...base, backoffStrategy: 'exponential', initialDelayMs: 1000, multiplier: 2 })).toBe(1000);
    expect(calculateDelay(2, { ...base, backoffStrategy: 'exponential', initialDelayMs: 1000, multiplier: 2 })).toBe(2000);
    expect(calculateDelay(3, { ...base, backoffStrategy: 'exponential', initialDelayMs: 1000, multiplier: 2 })).toBe(4000);
  });

  it('linear: multiplies by attempt number', () => {
    expect(calculateDelay(1, { ...base, backoffStrategy: 'linear', initialDelayMs: 500, multiplier: 1 })).toBe(500);
    expect(calculateDelay(2, { ...base, backoffStrategy: 'linear', initialDelayMs: 500, multiplier: 1 })).toBe(1000);
    expect(calculateDelay(3, { ...base, backoffStrategy: 'linear', initialDelayMs: 500, multiplier: 1 })).toBe(1500);
  });

  it('constant: always returns initialDelayMs', () => {
    expect(calculateDelay(1, { ...base, backoffStrategy: 'constant', initialDelayMs: 750 })).toBe(750);
    expect(calculateDelay(5, { ...base, backoffStrategy: 'constant', initialDelayMs: 750 })).toBe(750);
  });

  it('fibonacci: follows fib sequence', () => {
    // fib(1)=1, fib(2)=1, fib(3)=2, fib(4)=3
    expect(calculateDelay(1, { ...base, backoffStrategy: 'fibonacci', initialDelayMs: 100 })).toBe(100);
    expect(calculateDelay(2, { ...base, backoffStrategy: 'fibonacci', initialDelayMs: 100 })).toBe(100);
    expect(calculateDelay(3, { ...base, backoffStrategy: 'fibonacci', initialDelayMs: 100 })).toBe(200);
    expect(calculateDelay(4, { ...base, backoffStrategy: 'fibonacci', initialDelayMs: 100 })).toBe(300);
  });

  it('caps at maxDelayMs', () => {
    expect(
      calculateDelay(10, { ...base, backoffStrategy: 'exponential', initialDelayMs: 1000, multiplier: 2, maxDelayMs: 5000 })
    ).toBe(5000);
  });

  it('applies jitter in ±10% range', () => {
    const delay = calculateDelay(1, { ...base, jitter: true, backoffStrategy: 'constant', initialDelayMs: 1000 });
    expect(delay).toBeGreaterThanOrEqual(800);
    expect(delay).toBeLessThanOrEqual(1200);
  });
});

describe('withRetry', () => {
  it('returns immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds on third attempt', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error('ECONNRESET');
      return 'success';
    });

    const promise = withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 100,
      backoffStrategy: 'constant',
      jitter: false,
      retryOn: RetryPredicates.networkErrors,
    });

    await flush();
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after maxAttempts exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const promise = withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 50,
      backoffStrategy: 'constant',
      jitter: false,
      retryOn: RetryPredicates.networkErrors,
    });
    void promise.catch(() => {});

    await flush();
    await expect(promise).rejects.toThrow('ECONNRESET');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('401 unauthorized'));
    const promise = withRetry(fn, {
      maxAttempts: 3,
      retryOn: RetryPredicates.networkErrors, // 401 is not a network error
    });
    void promise.catch(() => {});

    await flush();
    await expect(promise).rejects.toThrow('401 unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry with correct attempt and delay', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue('ok');

    const promise = withRetry(fn, {
      maxAttempts: 3,
      initialDelayMs: 200,
      backoffStrategy: 'constant',
      jitter: false,
      retryOn: RetryPredicates.networkErrors,
      onRetry,
    });

    await flush();
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 200);
  });

  it('respects maxAttempts: 1 (no retries)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const promise = withRetry(fn, { maxAttempts: 1 });
    void promise.catch(() => {});

    await flush();
    await expect(promise).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('RetryPredicates', () => {
  it('networkErrors matches ECONNRESET', () => {
    expect(RetryPredicates.networkErrors(new Error('ECONNRESET'))).toBe(true);
    expect(RetryPredicates.networkErrors(new Error('ETIMEDOUT'))).toBe(true);
    expect(RetryPredicates.networkErrors(new Error('some other error'))).toBe(false);
  });

  it('rateLimitErrors matches 429', () => {
    expect(RetryPredicates.rateLimitErrors(new Error('429 Too Many Requests'))).toBe(true);
    expect(RetryPredicates.rateLimitErrors(new Error('rate limit exceeded'))).toBe(true);
    expect(RetryPredicates.rateLimitErrors(new Error('401 Unauthorized'))).toBe(false);
  });

  it('serverErrors matches 5xx', () => {
    expect(RetryPredicates.serverErrors(new Error('500 Internal Server Error'))).toBe(true);
    expect(RetryPredicates.serverErrors(new Error('503 Service Unavailable'))).toBe(true);
    expect(RetryPredicates.serverErrors(new Error('404 Not Found'))).toBe(false);
  });

  it('copilotErrors is union of all transient errors', () => {
    expect(RetryPredicates.copilotErrors(new Error('ECONNRESET'))).toBe(true);
    expect(RetryPredicates.copilotErrors(new Error('429'))).toBe(true);
    expect(RetryPredicates.copilotErrors(new Error('503'))).toBe(true);
    expect(RetryPredicates.copilotErrors(new Error('timed out'))).toBe(true);
    expect(RetryPredicates.copilotErrors(new Error('401'))).toBe(false);
  });
});
