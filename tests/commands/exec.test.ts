/**
 * Tests for src/commands/exec.ts
 *
 * Strategy:
 *  - Mock runAgentTask, runSwarm, clientManager, and loadConfig so no real
 *    Copilot CLI is needed.
 *  - Write real YAML plan files to a per-test tmp directory so file I/O works
 *    as in production.
 *  - Mock process.exit to capture failure codes without killing the runner.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Command } from 'commander';
import type { AgentResult } from '../../src/types.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockRunAgentTask = vi.fn();
const mockRunSwarm     = vi.fn();
const mockShutdown     = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/agents/executor.js',    () => ({ runAgentTask: mockRunAgentTask }));
vi.mock('../../src/swarm/coordinator.js',  () => ({ runSwarm: mockRunSwarm }));
vi.mock('../../src/core/client-manager.js', () => ({
  clientManager: { getClient: vi.fn(), shutdown: mockShutdown },
}));

const mockLoadConfig = vi.fn().mockReturnValue({
  defaultModel: '',
  defaultTimeoutMs: 1_200_000,
  agents: { models: {}, directories: [] },
  skills: { directories: [], disabled: [] },
  instructions: { file: '.github/copilot-instructions.md', autoLoad: false },
});
vi.mock('../../src/config.js', () => ({ loadConfig: mockLoadConfig }));

// ── Helpers ───────────────────────────────────────────────────────────────────

function successResult(output: string, agentType = 'analyst'): AgentResult {
  return {
    agentType: agentType as AgentResult['agentType'],
    agentId:   'test-agent',
    sessionId: 'test-session',
    output,
    durationMs: 10,
    attempts:   1,
    success:    true,
  };
}

function failResult(error: string): AgentResult {
  return {
    agentType:  'analyst',
    agentId:    'test-agent',
    sessionId:  'test-session',
    output:     '',
    durationMs: 10,
    attempts:   1,
    success:    false,
    error,
  };
}

/**
 * Write a phases.yaml to `dir` and return its path.
 * Each phase object is serialised as YAML with minimal quoting.
 */
function writePlan(dir: string, phases: object[], spec = ''): string {
  const planFile = join(dir, 'phases.yaml');
  const phaseYaml = phases.map(p => {
    const obj = p as Record<string, unknown>;
    const lines: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) {
        lines.push(`    ${k}:`);
        for (const item of v) lines.push(`      - "${item}"`);
      } else if (v === undefined) {
        // skip
      } else {
        lines.push(`    ${k}: ${JSON.stringify(v)}`);
      }
    }
    return `  -\n${lines.join('\n')}`;
  }).join('\n');

  writeFileSync(planFile, `version: "1.0.0"\nspec: ${JSON.stringify(spec)}\nphases:\n${phaseYaml}\n`, 'utf-8');
  return planFile;
}

/** Run the exec command against a plan file. Returns exit code (or 0 on success). */
async function runExec(planFile: string, extraArgs: string[] = []): Promise<number> {
  const { registerExec } = await import('../../src/commands/exec.js');

  const program = new Command();
  program.exitOverride(); // prevent commander from calling process.exit on --help
  registerExec(program);

  let exitCode = 0;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit(${code})`);
  });

  try {
    // argv[0] = node executable, argv[1] = script name, argv[2+] = actual args
    await program.parseAsync(['node', 'copilot-flow', 'exec', planFile, ...extraArgs]);
  } catch {
    // process.exit throws — expected; exitCode already captured
  } finally {
    exitSpy.mockRestore();
  }
  return exitCode;
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'exec-test-'));
  vi.clearAllMocks();
  mockShutdown.mockResolvedValue(undefined);
  mockLoadConfig.mockReturnValue({
    defaultModel: '',
    defaultTimeoutMs: 1_200_000,
    agents: { models: {}, directories: [] },
    skills: { directories: [], disabled: [] },
    instructions: { file: '.github/copilot-instructions.md', autoLoad: false },
  });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('exec — single phase', () => {
  it('runs a single-phase plan and writes output file', async () => {
    mockRunAgentTask.mockResolvedValue(successResult('Phase A output'));

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(0);
    expect(mockRunAgentTask).toHaveBeenCalledOnce();
    const outFile = join(tmpDir, 'phase-a.md');
    expect(existsSync(outFile)).toBe(true);
    expect(readFileSync(outFile, 'utf-8')).toContain('Phase A output');
  });

  it('exits 1 when plan file does not exist', async () => {
    const code = await runExec(join(tmpDir, 'nonexistent.yaml'));
    expect(code).toBe(1);
    expect(mockRunAgentTask).not.toHaveBeenCalled();
  });

  it('exits 1 when plan has no phases', async () => {
    const planFile = join(tmpDir, 'empty.yaml');
    writeFileSync(planFile, 'version: "1.0.0"\nspec: ""\nphases: []\n', 'utf-8');
    const code = await runExec(planFile);
    expect(code).toBe(1);
  });
});

describe('exec — --phase flag (single-phase path)', () => {
  it('runs only the named phase', async () => {
    mockRunAgentTask.mockResolvedValue(successResult('B output'));

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
      { id: 'b', description: 'Do B', type: 'agent', agentType: 'analyst' },
    ]);

    const code = await runExec(planFile, ['--phase', 'b']);

    expect(code).toBe(0);
    expect(mockRunAgentTask).toHaveBeenCalledOnce();
    expect(existsSync(join(tmpDir, 'phase-b.md'))).toBe(true);
    expect(existsSync(join(tmpDir, 'phase-a.md'))).toBe(false);
  });

  it('exits 1 when named phase does not exist', async () => {
    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
    ]);
    const code = await runExec(planFile, ['--phase', 'missing']);
    expect(code).toBe(1);
    expect(mockRunAgentTask).not.toHaveBeenCalled();
  });

  it('loads dependency output from disk for --phase', async () => {
    // Pre-write A's output file (simulating it was run before)
    writeFileSync(join(tmpDir, 'phase-a.md'), '# Phase: a\n\nA result\n', 'utf-8');
    mockRunAgentTask.mockResolvedValue(successResult('B output'));

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
      { id: 'b', description: 'Do B', type: 'agent', agentType: 'analyst', dependsOn: ['a'] },
    ]);

    const code = await runExec(planFile, ['--phase', 'b']);

    expect(code).toBe(0);
    // B's prompt must reference A's output
    const promptArg: string = mockRunAgentTask.mock.calls[0][1];
    expect(promptArg).toContain('A result');
  });
});

describe('exec — skip and force', () => {
  it('skips phase whose output file already exists', async () => {
    writeFileSync(join(tmpDir, 'phase-a.md'), '# Phase: a\n\nCached output\n', 'utf-8');

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(0);
    expect(mockRunAgentTask).not.toHaveBeenCalled();
  });

  it('re-runs phase with --force even if output file exists', async () => {
    writeFileSync(join(tmpDir, 'phase-a.md'), '# Phase: a\n\nOld output\n', 'utf-8');
    mockRunAgentTask.mockResolvedValue(successResult('Fresh output'));

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
    ]);

    const code = await runExec(planFile, ['--force']);

    expect(code).toBe(0);
    expect(mockRunAgentTask).toHaveBeenCalledOnce();
    expect(readFileSync(join(tmpDir, 'phase-a.md'), 'utf-8')).toContain('Fresh output');
  });

  it('uses cached output from skipped phase in downstream prompt', async () => {
    writeFileSync(join(tmpDir, 'phase-a.md'), '# Phase: a\n\nCached A\n', 'utf-8');
    mockRunAgentTask.mockResolvedValue(successResult('B output'));

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
      { id: 'b', description: 'Do B', type: 'agent', agentType: 'analyst', dependsOn: ['a'] },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(0);
    expect(mockRunAgentTask).toHaveBeenCalledOnce();
    const promptArg: string = mockRunAgentTask.mock.calls[0][1];
    expect(promptArg).toContain('Cached A');
  });
});

describe('exec — serial dependencies', () => {
  it('runs A then B then C in order when A→B→C', async () => {
    // Use the "Your task" section to identify which phase is being run
    const callOrder: string[] = [];
    mockRunAgentTask.mockImplementation(async (_type: string, prompt: string) => {
      const match = (prompt as string).match(/Your task — phase "([^"]+)"/);
      const id = match?.[1] ?? 'unknown';
      callOrder.push(id);
      return successResult(`Output of ${id}`);
    });

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
      { id: 'b', description: 'Do B', type: 'agent', agentType: 'analyst', dependsOn: ['a'] },
      { id: 'c', description: 'Do C', type: 'agent', agentType: 'analyst', dependsOn: ['b'] },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(0);
    expect(callOrder).toEqual(['a', 'b', 'c']);
  });

  it('passes output of A into B\'s prompt', async () => {
    mockRunAgentTask
      .mockResolvedValueOnce(successResult('A produced this'))
      .mockResolvedValueOnce(successResult('B output'));

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
      { id: 'b', description: 'Do B', type: 'agent', agentType: 'analyst', dependsOn: ['a'] },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(0);
    const bPrompt: string = mockRunAgentTask.mock.calls[1][1];
    expect(bPrompt).toContain('A produced this');
  });
});

describe('exec — parallel phases (wave execution)', () => {
  it('runs independent phases in the same wave (no deps)', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    mockRunAgentTask.mockImplementation(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await Promise.resolve(); // yield to let other tasks in the wave start
      concurrent--;
      return successResult('output');
    });

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
      { id: 'b', description: 'Do B', type: 'agent', agentType: 'analyst' },
      { id: 'c', description: 'Do C', type: 'agent', agentType: 'analyst' },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(0);
    expect(mockRunAgentTask).toHaveBeenCalledTimes(3);
    expect(maxConcurrent).toBe(3); // all three ran concurrently
  });

  it('runs B and C in parallel when both depend on A but not each other', async () => {
    // Track concurrent calls using a simple counter — no prompt parsing needed.
    // Promise.all starts both runPhase(B) and runPhase(C) synchronously, so both
    // mock bodies run up to their first await before either resolves.
    let concurrent = 0;
    let maxConcurrent = 0;
    let aCallCount = 0;

    mockRunAgentTask.mockImplementation(async () => {
      aCallCount++;
      const thisCall = aCallCount;
      // First call is A (runs alone in wave 1); subsequent are B and C (wave 2)
      if (thisCall === 1) {
        return successResult('A output'); // A completes synchronously — no await
      }
      // B and C: track concurrency
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await Promise.resolve(); // yield so both can increment before either resolves
      concurrent--;
      return successResult('BC output');
    });

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
      { id: 'b', description: 'Do B', type: 'agent', agentType: 'analyst', dependsOn: ['a'] },
      { id: 'c', description: 'Do C', type: 'agent', agentType: 'analyst', dependsOn: ['a'] },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(0);
    expect(mockRunAgentTask).toHaveBeenCalledTimes(3);
    // B and C both started before either finished → max concurrent = 2
    expect(maxConcurrent).toBe(2);
    // Both B and C output files written
    expect(existsSync(join(tmpDir, 'phase-b.md'))).toBe(true);
    expect(existsSync(join(tmpDir, 'phase-c.md'))).toBe(true);
  });

  it('handles mixed pipeline: A → [B+C] → D', async () => {
    // Wave 1: A alone, Wave 2: B+C parallel, Wave 3: D alone
    // Track max concurrent calls — should be 2 when B and C run together.
    let maxConcurrent = 0;
    let concurrent = 0;
    let callCount = 0;

    mockRunAgentTask.mockImplementation(async () => {
      callCount++;
      const thisCall = callCount;
      // Call 1 = A (wave 1), calls 2 & 3 = B and C (wave 2), call 4 = D (wave 3)
      if (thisCall >= 2 && thisCall <= 3) {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await Promise.resolve();
        concurrent--;
        return successResult(`wave2-${thisCall} output`);
      }
      return successResult(`output-${thisCall}`);
    });

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
      { id: 'b', description: 'Do B', type: 'agent', agentType: 'analyst', dependsOn: ['a'] },
      { id: 'c', description: 'Do C', type: 'agent', agentType: 'analyst', dependsOn: ['a'] },
      { id: 'd', description: 'Do D', type: 'agent', agentType: 'analyst', dependsOn: ['b', 'c'] },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(0);
    expect(mockRunAgentTask).toHaveBeenCalledTimes(4);
    expect(maxConcurrent).toBe(2); // B and C ran in parallel
    // D's prompt must include both B and C outputs (written by wave 2)
    const dPrompt: string = mockRunAgentTask.mock.calls[3][1];
    expect(dPrompt).toContain('wave2-2 output');
    expect(dPrompt).toContain('wave2-3 output');
  });

  it('skips already-complete phases in a wave and runs the rest', async () => {
    // B's output exists; A does not
    writeFileSync(join(tmpDir, 'phase-b.md'), '# Phase: b\n\nCached B\n', 'utf-8');
    mockRunAgentTask.mockResolvedValue(successResult('A output'));

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
      { id: 'b', description: 'Do B', type: 'agent', agentType: 'analyst' },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(0);
    // Only A was executed; B was skipped
    expect(mockRunAgentTask).toHaveBeenCalledOnce();
    const calledPrompt: string = mockRunAgentTask.mock.calls[0][1];
    expect(calledPrompt).toContain('phase "a"');
  });
});

describe('exec — model resolution', () => {
  it('uses phase.model when set and no CLI --model', async () => {
    mockRunAgentTask.mockResolvedValue(successResult('output'));

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst', model: 'o1-mini' },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(0);
    expect(mockRunAgentTask).toHaveBeenCalledWith(
      'analyst',
      expect.any(String),
      expect.objectContaining({ model: 'o1-mini' }),
    );
  });

  it('CLI --model overrides phase.model', async () => {
    mockRunAgentTask.mockResolvedValue(successResult('output'));

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst', model: 'o1-mini' },
    ]);

    const code = await runExec(planFile, ['--model', 'gpt-4o-mini']);

    expect(code).toBe(0);
    expect(mockRunAgentTask).toHaveBeenCalledWith(
      'analyst',
      expect.any(String),
      expect.objectContaining({ model: 'gpt-4o-mini' }),
    );
  });

  it('uses config.agents.models for agent type when no phase.model or CLI --model', async () => {
    mockLoadConfig.mockReturnValue({
      defaultModel: '',
      defaultTimeoutMs: 1_200_000,
      agents: { models: { analyst: 'claude-sonnet-4-5' }, directories: [] },
      skills: { directories: [], disabled: [] },
      instructions: { file: '.github/copilot-instructions.md', autoLoad: false },
    });
    mockRunAgentTask.mockResolvedValue(successResult('output'));

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(0);
    expect(mockRunAgentTask).toHaveBeenCalledWith(
      'analyst',
      expect.any(String),
      expect.objectContaining({ model: 'claude-sonnet-4-5' }),
    );
  });

  it('falls back to config.defaultModel when no other model is set', async () => {
    mockLoadConfig.mockReturnValue({
      defaultModel: 'gpt-4o',
      defaultTimeoutMs: 1_200_000,
      agents: { models: {}, directories: [] },
      skills: { directories: [], disabled: [] },
      instructions: { file: '.github/copilot-instructions.md', autoLoad: false },
    });
    mockRunAgentTask.mockResolvedValue(successResult('output'));

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(0);
    expect(mockRunAgentTask).toHaveBeenCalledWith(
      'analyst',
      expect.any(String),
      expect.objectContaining({ model: 'gpt-4o' }),
    );
  });
});

describe('exec — failure handling', () => {
  it('exits 1 when a phase agent fails', async () => {
    mockRunAgentTask.mockResolvedValue(failResult('agent exploded'));

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(1);
    expect(mockShutdown).toHaveBeenCalled();
  });

  it('exits 1 and does not run downstream phases after a failure', async () => {
    mockRunAgentTask
      .mockResolvedValueOnce(failResult('A failed'))
      .mockResolvedValue(successResult('should not reach'));

    const planFile = writePlan(tmpDir, [
      { id: 'a', description: 'Do A', type: 'agent', agentType: 'analyst' },
      { id: 'b', description: 'Do B', type: 'agent', agentType: 'analyst', dependsOn: ['a'] },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(1);
    expect(mockRunAgentTask).toHaveBeenCalledTimes(1);
    expect(existsSync(join(tmpDir, 'phase-b.md'))).toBe(false);
  });

  it('exits 1 on deadlock (unsatisfiable dependency)', async () => {
    // B depends on C and C depends on B — neither can run first
    const planFile = join(tmpDir, 'deadlock.yaml');
    writeFileSync(
      planFile,
      `version: "1.0.0"\nspec: ""\nphases:\n` +
      `  -\n    id: "b"\n    description: "B"\n    type: "agent"\n    agentType: "analyst"\n    dependsOn:\n      - "c"\n` +
      `  -\n    id: "c"\n    description: "C"\n    type: "agent"\n    agentType: "analyst"\n    dependsOn:\n      - "b"\n`,
      'utf-8',
    );

    const code = await runExec(planFile);

    expect(code).toBe(1);
    expect(mockRunAgentTask).not.toHaveBeenCalled();
    expect(mockShutdown).toHaveBeenCalled();
  });
});

describe('exec — acceptance criteria', () => {
  it('passes when reviewer returns PASS', async () => {
    mockRunAgentTask
      .mockResolvedValueOnce(successResult('Good output'))  // phase agent
      .mockResolvedValueOnce(successResult('PASS\nLooks good')); // reviewer

    const planFile = writePlan(tmpDir, [
      {
        id: 'a',
        description: 'Do A',
        type: 'agent',
        agentType: 'analyst',
        acceptanceCriteria: 'Must be good',
      },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(0);
    expect(mockRunAgentTask).toHaveBeenCalledTimes(2);
    // Second call is the reviewer
    expect(mockRunAgentTask.mock.calls[1][0]).toBe('reviewer');
  });

  it('retries phase when reviewer returns FAIL, then passes', async () => {
    mockRunAgentTask
      .mockResolvedValueOnce(successResult('First attempt'))   // agent attempt 1
      .mockResolvedValueOnce(successResult('FAIL\nNot good'))  // reviewer — fail
      .mockResolvedValueOnce(successResult('Second attempt'))  // agent attempt 2
      .mockResolvedValueOnce(successResult('PASS\nOK now'));   // reviewer — pass

    const planFile = writePlan(tmpDir, [
      {
        id: 'a',
        description: 'Do A',
        type: 'agent',
        agentType: 'analyst',
        acceptanceCriteria: 'Must be perfect',
        maxAcceptanceRetries: 2,
      },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(0);
    expect(mockRunAgentTask).toHaveBeenCalledTimes(4);
  });

  it('exits 1 when acceptance retries are exhausted', async () => {
    // Always fail the reviewer
    mockRunAgentTask
      .mockResolvedValueOnce(successResult('attempt 1'))
      .mockResolvedValueOnce(successResult('FAIL\nbad'))
      .mockResolvedValueOnce(successResult('attempt 2'))
      .mockResolvedValueOnce(successResult('FAIL\nbad'))
      .mockResolvedValueOnce(successResult('attempt 3'))
      .mockResolvedValueOnce(successResult('FAIL\nbad'));

    const planFile = writePlan(tmpDir, [
      {
        id: 'a',
        description: 'Do A',
        type: 'agent',
        agentType: 'analyst',
        acceptanceCriteria: 'Impossible standard',
        maxAcceptanceRetries: 2,
      },
    ]);

    const code = await runExec(planFile, ['--max-acceptance-retries', '2']);

    expect(code).toBe(1);
    expect(mockShutdown).toHaveBeenCalled();
  });

  it('reviewer uses config.agents.models["reviewer"] when set', async () => {
    mockLoadConfig.mockReturnValue({
      defaultModel: '',
      defaultTimeoutMs: 1_200_000,
      agents: { models: { reviewer: 'o1-mini' }, directories: [] },
      skills: { directories: [], disabled: [] },
      instructions: { file: '.github/copilot-instructions.md', autoLoad: false },
    });

    mockRunAgentTask
      .mockResolvedValueOnce(successResult('phase output'))
      .mockResolvedValueOnce(successResult('PASS\nOK'));

    const planFile = writePlan(tmpDir, [
      {
        id: 'a',
        description: 'Do A',
        type: 'agent',
        agentType: 'analyst',
        acceptanceCriteria: 'Must pass',
      },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(0);
    const reviewerCall = mockRunAgentTask.mock.calls[1];
    expect(reviewerCall[0]).toBe('reviewer');
    expect(reviewerCall[2]).toMatchObject({ model: 'o1-mini' });
  });
});

describe('exec — swarm phases', () => {
  it('runs a swarm-type phase using runSwarm', async () => {
    const fakeResults = new Map([
      ['a-task-1', successResult('researcher output', 'researcher')],
      ['a-task-2', successResult('coder output', 'coder')],
      ['a-task-3', successResult('final swarm output', 'reviewer')],
    ]);
    mockRunSwarm.mockResolvedValue(fakeResults);

    const planFile = writePlan(tmpDir, [
      {
        id: 'a',
        description: 'Do A with swarm',
        type: 'swarm',
        topology: 'hierarchical',
        agents: ['researcher', 'coder', 'reviewer'],
      },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(0);
    expect(mockRunSwarm).toHaveBeenCalledOnce();
    expect(mockRunAgentTask).not.toHaveBeenCalled();
    expect(existsSync(join(tmpDir, 'phase-a.md'))).toBe(true);
    expect(readFileSync(join(tmpDir, 'phase-a.md'), 'utf-8')).toContain('final swarm output');
  });

  it('exits 1 when swarm last task fails', async () => {
    const fakeResults = new Map([
      ['a-task-1', successResult('ok', 'researcher')],
      ['a-task-2', { ...failResult('swarm error'), agentType: 'reviewer' as const, agentId: 'x', sessionId: 'y', output: '', durationMs: 0, attempts: 1 }],
    ]);
    mockRunSwarm.mockResolvedValue(fakeResults);

    const planFile = writePlan(tmpDir, [
      {
        id: 'a',
        description: 'Do A with swarm',
        type: 'swarm',
        topology: 'hierarchical',
        agents: ['researcher', 'reviewer'],
      },
    ]);

    const code = await runExec(planFile);

    expect(code).toBe(1);
    expect(mockShutdown).toHaveBeenCalled();
  });
});

describe('exec — streaming', () => {
  it('prefixes chunks with [phase-id] when streaming in parallel wave', async () => {
    // Collect prefixed output by intercepting process.stdout.write directly
    const chunks: string[] = [];
    mockRunAgentTask.mockResolvedValue(successResult('output'));

    const planFile = writePlan(tmpDir, [
      { id: 'p', description: 'P', type: 'agent', agentType: 'analyst' },
      { id: 'q', description: 'Q', type: 'agent', agentType: 'analyst' },
    ]);

    const code = await runExec(planFile, ['--stream']);

    expect(code).toBe(0);
    // Both phases ran; retrieve the onChunk callbacks passed to runAgentTask
    const calls = mockRunAgentTask.mock.calls as [string, string, Record<string, unknown>][];
    const phaseIds = calls.map(([, prompt]) =>
      (prompt as string).match(/phase "([^"]+)"/)?.[1] ?? '?'
    );
    // Both p and q must have been called
    expect(phaseIds).toContain('p');
    expect(phaseIds).toContain('q');

    // The onChunk for each phase must add the "[phase-id] " prefix
    for (const [, prompt, opts] of calls) {
      const id = (prompt as string).match(/phase "([^"]+)"/)?.[1];
      if (!id) continue;
      const onChunk = opts?.onChunk as ((c: string) => void) | undefined;
      // onChunk is only defined when --stream is passed
      expect(typeof onChunk).toBe('function');
      const origWrite = process.stdout.write.bind(process.stdout);
      const written: string[] = [];
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
        written.push(String(c));
        return true;
      });
      onChunk!('test');
      spy.mockRestore();
      expect(written.join('')).toContain(`[${id}] test`);
      chunks.push(...written);
    }
  });

  it('does not prefix chunks in single-phase stream mode', async () => {
    mockRunAgentTask.mockResolvedValue(successResult('output'));

    const planFile = writePlan(tmpDir, [
      { id: 'solo', description: 'Solo', type: 'agent', agentType: 'analyst' },
    ]);

    const code = await runExec(planFile, ['--stream']);

    expect(code).toBe(0);
    const calls = mockRunAgentTask.mock.calls as [string, string, Record<string, unknown>][];
    expect(calls.length).toBe(1);

    const onChunk = calls[0][2]?.onChunk as ((c: string) => void) | undefined;
    expect(typeof onChunk).toBe('function');

    const written: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
      written.push(String(c));
      return true;
    });
    onChunk!('hello');
    spy.mockRestore();

    // Single phase — chunk must NOT be prefixed with [phase-id]
    const out = written.join('');
    expect(out).toContain('hello');
    expect(out).not.toContain('[solo] ');
  });
});
