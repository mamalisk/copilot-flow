import { describe, it, expect } from 'vitest';
import {
  classifyError,
  formatError,
  isCopilotFlowError,
  asCopilotFlowError,
} from '../../src/core/error-handler.js';

describe('classifyError', () => {
  it('classifies copilot not installed', () => {
    const err = classifyError(new Error('copilot: command not found'));
    expect(err.category).toBe('copilot_not_installed');
    expect(err.retryable).toBe(false);
  });

  it('classifies ENOENT as copilot_not_installed', () => {
    const err = classifyError(new Error('spawn ENOENT'));
    expect(err.category).toBe('copilot_not_installed');
  });

  it('classifies 401 as authentication', () => {
    const err = classifyError(new Error('401 Unauthorized'));
    expect(err.category).toBe('authentication');
    expect(err.retryable).toBe(false);
  });

  it('classifies not authenticated', () => {
    const err = classifyError(new Error('not authenticated — run copilot login'));
    expect(err.category).toBe('authentication');
  });

  it('classifies 403 as authorization', () => {
    const err = classifyError(new Error('403 Forbidden'));
    expect(err.category).toBe('authorization');
    expect(err.retryable).toBe(false);
  });

  it('classifies 429 as rate_limit', () => {
    const err = classifyError(new Error('429 Too Many Requests'));
    expect(err.category).toBe('rate_limit');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(5000);
  });

  it('classifies rate limit text', () => {
    const err = classifyError(new Error('rate limit exceeded'));
    expect(err.category).toBe('rate_limit');
  });

  it('classifies timeout', () => {
    const err = classifyError(new Error('Request timed out after 120000ms'));
    expect(err.category).toBe('timeout');
    expect(err.retryable).toBe(true);
  });

  it('classifies session crash', () => {
    const err = classifyError(new Error('session closed unexpectedly'));
    expect(err.category).toBe('session_error');
    expect(err.retryable).toBe(true);
  });

  it('classifies ECONNRESET as network', () => {
    const err = classifyError(new Error('ECONNRESET'));
    expect(err.category).toBe('network');
    expect(err.retryable).toBe(true);
  });

  it('classifies unknown errors', () => {
    const err = classifyError(new Error('something completely unexpected'));
    expect(err.category).toBe('unknown');
    expect(err.retryable).toBe(false);
  });

  it('handles non-Error thrown values', () => {
    const err = classifyError('just a string error');
    expect(err.category).toBe('unknown');
    expect(err.message).toBe('just a string error');
  });

  it('preserves original error reference', () => {
    const original = new Error('ECONNRESET');
    const err = classifyError(original);
    expect(err.originalError).toBe(original);
  });
});

describe('formatError', () => {
  it('includes category in output', () => {
    const err = classifyError(new Error('ECONNRESET'));
    const formatted = formatError(err);
    expect(formatted).toContain('NETWORK');
    expect(formatted).toContain('ECONNRESET');
  });

  it('notes retryability', () => {
    const retryable = classifyError(new Error('ECONNRESET'));
    expect(formatError(retryable)).toContain('retryable');

    const nonRetryable = classifyError(new Error('401 Unauthorized'));
    expect(formatError(nonRetryable)).toContain('not retryable');
  });
});

describe('isCopilotFlowError', () => {
  it('returns true for classified errors', () => {
    const err = classifyError(new Error('ECONNRESET'));
    expect(isCopilotFlowError(err)).toBe(true);
  });

  it('returns false for raw errors', () => {
    expect(isCopilotFlowError(new Error('foo'))).toBe(false);
    expect(isCopilotFlowError(null)).toBe(false);
    expect(isCopilotFlowError('string')).toBe(false);
  });
});

describe('asCopilotFlowError', () => {
  it('passes through already-classified errors', () => {
    const classified = classifyError(new Error('ECONNRESET'));
    expect(asCopilotFlowError(classified)).toBe(classified);
  });

  it('classifies raw errors', () => {
    const err = asCopilotFlowError(new Error('429'));
    expect(err.category).toBe('rate_limit');
  });
});
