import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runAgentTask } from '../../src/agents/executor.js';

// ── Mock @github/copilot-sdk ────────────────────────────────────────────────
const mockDisconnect = vi.fn().mockResolvedValue(undefined);
const mockOn = vi.fn();
const mockSendAndWait = vi.fn();

const mockSession = {
  sessionId: 'test-session-123',
  on: mockOn,
  sendAndWait: mockSendAndWait,
  disconnect: mockDisconnect,
};

const mockCreateSession = vi.fn().mockResolvedValue(mockSession);
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockPing = vi.fn().mockResolvedValue({ message: 'pong', timestamp: Date.now() });

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: vi.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    ping: mockPing,
    createSession: mockCreateSession,
  })),
  approveAll: vi.fn().mockResolvedValue(undefined),
}));

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
  mockSendAndWait.mockResolvedValue({ data: { content: 'Hello from Copilot!' } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runAgentTask', () => {
  it('runs a task and returns the response', async () => {
    const result = await runAgentTask('coder', 'Write hello world');

    expect(result.success).toBe(true);
    expect(result.output).toBe('Hello from Copilot!');
    expect(result.agentType).toBe('coder');
    expect(result.attempts).toBe(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('creates a session with the correct system message', async () => {
    await runAgentTask('coder', 'Test task');

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        systemMessage: expect.objectContaining({ content: expect.stringContaining('expert software engineer') }),
      })
    );
  });

  it('passes model to createSession when explicitly provided', async () => {
    await runAgentTask('coder', 'Test task', { model: 'claude-sonnet-4-5' });

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-5',
      })
    );
  });

  it('omits model from createSession when none is configured', async () => {
    await runAgentTask('coder', 'Test task');

    const callArg = mockCreateSession.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty('model');
  });

  it('disconnects the session after completion', async () => {
    await runAgentTask('coder', 'Test task');
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('uses the system prompt matching the agent type', async () => {
    await runAgentTask('security-auditor', 'Audit this code');

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        systemMessage: expect.objectContaining({
          content: expect.stringContaining('security'),
        }),
      })
    );
  });

  it('accepts a model override', async () => {
    await runAgentTask('coder', 'Task', { model: 'gpt-4o-mini' });

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini' })
    );
  });

  it('retries on transient failures', async () => {
    vi.useFakeTimers();

    let calls = 0;
    mockSendAndWait.mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error('ECONNRESET');
      return { data: { content: 'finally worked' } };
    });

    const promise = runAgentTask('coder', 'Task', {
      retryConfig: {
        maxAttempts: 3,
        initialDelayMs: 100,
        backoffStrategy: 'constant',
        jitter: false,
      },
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.output).toBe('finally worked');
  });

  it('returns a failure result (not throw) when all retries exhausted', async () => {
    vi.useFakeTimers();

    mockSendAndWait.mockRejectedValue(new Error('ECONNRESET'));

    const promise = runAgentTask('coder', 'Task', {
      retryConfig: {
        maxAttempts: 2,
        initialDelayMs: 50,
        backoffStrategy: 'constant',
        jitter: false,
      },
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNRESET');
  });

  it('calls onChunk for each delta', async () => {
    // Simulate streaming by triggering the delta handler
    mockOn.mockImplementation((event: string, cb: (e: { data: { deltaContent: string } }) => void) => {
      if (event === 'assistant.message_delta') {
        cb({ data: { deltaContent: 'chunk1' } });
        cb({ data: { deltaContent: 'chunk2' } });
      }
    });
    mockSendAndWait.mockResolvedValue({ data: { content: 'full response' } });

    const chunks: string[] = [];
    await runAgentTask('coder', 'Task', { onChunk: c => chunks.push(c) });

    expect(chunks).toContain('chunk1');
    expect(chunks).toContain('chunk2');
  });
});
