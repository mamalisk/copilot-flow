import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { Spinner } from '../components/Spinner.js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { runAgentTask } from '../../agents/executor.js';
import { runSwarm } from '../../swarm/coordinator.js';
import { loadConfig } from '../../config.js';
import type { Plan, PlanPhase, AgentType, SwarmTask } from '../../types.js';
import type { RouterApi } from '../router.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type PhaseStatus = 'waiting' | 'running' | 'done' | 'failed' | 'skipped';

interface PhaseRow {
  id: string;
  agentType: string;
  status: PhaseStatus;
  startedAt?: number;
  doneAt?: number;
  snippet: string;
  outFile?: string;
  error?: string;
}

// ── Status display ────────────────────────────────────────────────────────────

const STATUS_ICON: Record<PhaseStatus, string> = {
  waiting: '○', running: '●', done: '✓', failed: '✗', skipped: '⊘',
};

const STATUS_COLOR: Record<PhaseStatus, string | undefined> = {
  waiting: undefined, running: 'cyan', done: 'green', failed: 'red', skipped: 'yellow',
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

function topoSort(phases: PlanPhase[]): PlanPhase[] {
  const byId   = new Map(phases.map(p => [p.id, p]));
  const result: PlanPhase[] = [];
  const visited = new Set<string>();
  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const p = byId.get(id);
    if (!p) throw new Error(`Unknown phase id in dependsOn: "${id}"`);
    for (const dep of p.dependsOn ?? []) visit(dep);
    result.push(p);
  }
  for (const p of phases) visit(p.id);
  return result;
}

function phaseOutputFile(phase: PlanPhase, planDir: string): string {
  return path.join(planDir, phase.output ?? `phase-${phase.id}.md`);
}

function buildPhasePrompt(
  phase: PlanPhase,
  plan: Plan,
  results: ReadonlyMap<string, string>,
  planDir: string,
): string {
  const parts: string[] = [];
  if (plan.spec && existsSync(plan.spec)) {
    parts.push(`## Original specification (${plan.spec})\n\n${readFileSync(plan.spec, 'utf-8').trim()}`);
  }
  for (const depId of phase.dependsOn ?? []) {
    const depPhase = plan.phases.find(p => p.id === depId);
    if (!depPhase) continue;
    const depFile = phaseOutputFile(depPhase, planDir);
    const content = results.get(depId) ??
      (existsSync(depFile) ? readFileSync(depFile, 'utf-8').trim() : null);
    if (content) parts.push(`## Output from phase "${depId}"\n\n${content}`);
  }
  parts.push(`## Your task — phase "${phase.id}"\n\n${phase.description}`);
  return parts.join('\n\n---\n\n');
}

/** Build a one-line dependency graph string: research → [design + spec] → implement */
function buildWaveGraph(phases: PlanPhase[]): string {
  try {
    const sorted    = topoSort(phases);
    const completed = new Set<string>();
    const remaining = new Set(sorted.map(p => p.id));
    const parts: string[] = [];
    while (remaining.size > 0) {
      const wave = sorted.filter(p =>
        remaining.has(p.id) && (p.dependsOn ?? []).every(d => completed.has(d))
      );
      if (wave.length === 0) break;
      parts.push(wave.length > 1 ? `[${wave.map(p => p.id).join(' + ')}]` : wave[0].id);
      for (const p of wave) { completed.add(p.id); remaining.delete(p.id); }
    }
    return parts.join(' → ');
  } catch { return ''; }
}

function fmtMs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ExecProps { router: RouterApi; }

const MAX_STREAM = 6;

export function ExecScreen({ router }: ExecProps) {
  const routerArgs = router.current.args?.args as string[] | undefined;
  const initFile   = routerArgs?.[0] ?? '';

  const [inputFile, setInputFile]     = useState(initFile);
  const [inputMode, setInputMode]     = useState(!initFile);

  const [rows, setRows]               = useState<PhaseRow[]>([]);
  const [graph, setGraph]             = useState('');
  const [streamLines, setStreamLines] = useState<string[]>([]);
  const [runStatus, setRunStatus]     = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [runError, setRunError]       = useState('');
  const [startedAt, setStartedAt]     = useState(0);
  const [now, setNow]                 = useState(() => Date.now());
  const [selectedRow, setSelectedRow] = useState(0);

  const liveRef = useRef(true);
  useEffect(() => () => { liveRef.current = false; }, []);

  // Tick `now` every second while running to drive elapsed time display
  useEffect(() => {
    if (runStatus !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [runStatus]);

  // Core execution: loads plan, runs waves, updates phase rows reactively
  const startExecution = useCallback(async (file: string) => {
    if (!existsSync(file)) {
      setRunStatus('error');
      setRunError(`Plan file not found: ${file}`);
      return;
    }

    let plan: Plan;
    try {
      plan = yaml.load(readFileSync(file, 'utf-8')) as Plan;
      if (!Array.isArray(plan?.phases) || plan.phases.length === 0)
        throw new Error('No phases found in plan');
    } catch (err) {
      setRunStatus('error');
      setRunError(err instanceof Error ? err.message : String(err));
      return;
    }

    const config  = loadConfig();
    const planDir = path.dirname(path.resolve(file));
    mkdirSync(planDir, { recursive: true });

    let sorted: PlanPhase[];
    try { sorted = topoSort(plan.phases); }
    catch (err) {
      setRunStatus('error');
      setRunError(err instanceof Error ? err.message : String(err));
      return;
    }

    setGraph(buildWaveGraph(plan.phases));
    setRows(sorted.map(p => ({
      id:        p.id,
      agentType: p.type === 'swarm'
        ? (p.agents ?? ['swarm']).join('+')
        : (p.agentType ?? 'analyst'),
      status:  'waiting',
      snippet: '',
    })));

    const phaseResults = new Map<string, string>();
    const completed    = new Set<string>();
    const remaining    = new Set(sorted.map(p => p.id));

    while (remaining.size > 0 && liveRef.current) {
      const wave = sorted.filter(p =>
        remaining.has(p.id) && (p.dependsOn ?? []).every(d => completed.has(d))
      );
      if (wave.length === 0) {
        setRunStatus('error');
        setRunError('Deadlock — dependency cycle or unresolvable dependsOn in plan');
        return;
      }

      const waveIds = wave.map(p => p.id);
      setRows(prev => prev.map(r =>
        waveIds.includes(r.id) ? { ...r, status: 'running', startedAt: Date.now() } : r
      ));
      setStreamLines([]);

      let waveResults: Array<{ id: string; output: string }>;
      try {
        waveResults = await Promise.all(wave.map(async (phase) => {
          const outFile = phaseOutputFile(phase, planDir);

          // Skip if output already exists
          if (existsSync(outFile)) {
            const existing = readFileSync(outFile, 'utf-8').trim();
            if (liveRef.current)
              setRows(prev => prev.map(r =>
                r.id === phase.id
                  ? { ...r, status: 'skipped', outFile, doneAt: Date.now() }
                  : r
              ));
            return { id: phase.id, output: existing };
          }

          const model     = phase.model ?? config.defaultModel;
          const timeoutMs = phase.timeoutMs ?? config.defaultTimeoutMs;

          // Append stream chunks to state for the active phase pane
          const addChunk = (chunk: string) => {
            if (!liveRef.current) return;
            setRows(prev => prev.map(r => {
              if (r.id !== phase.id) return r;
              const lines = (r.snippet + chunk).split('\n');
              return { ...r, snippet: lines.slice(-2).join(' ').slice(0, 50) };
            }));
            setStreamLines(prev =>
              [...prev, ...chunk.split('\n').filter(l => l.trim())]
                .slice(-MAX_STREAM)
            );
          };

          let phaseOutput = '';

          if (phase.type === 'swarm') {
            const topology   = phase.topology ?? 'hierarchical';
            const agentTypes = phase.agents ?? ['researcher', 'coder', 'reviewer'];
            const tasks: SwarmTask[] = agentTypes.map((at, i) => ({
              id:         `${phase.id}-task-${i + 1}`,
              agentType:  at,
              prompt:     buildPhasePrompt(phase, plan, phaseResults, planDir),
              dependsOn:  topology !== 'mesh' && i > 0
                ? [`${phase.id}-task-${i}`] : undefined,
              sessionOptions: { model, timeoutMs },
            }));
            const results = await runSwarm(tasks, topology, {
              onProgress: (_id, _at, chunk) => addChunk(chunk),
            });
            const last = results.get(tasks[tasks.length - 1].id);
            if (!last?.success)
              throw new Error(`Phase "${phase.id}" failed: ${last?.error ?? 'swarm error'}`);
            phaseOutput = last.output;
          } else {
            const agentType = (phase.agentType ?? 'analyst') as AgentType;
            const prompt    = buildPhasePrompt(phase, plan, phaseResults, planDir);
            const result    = await runAgentTask(agentType, prompt, {
              model, timeoutMs, onChunk: addChunk,
            });
            if (!result.success)
              throw new Error(result.error ?? `Phase "${phase.id}" failed`);
            phaseOutput = result.output;
          }

          if (!liveRef.current) return { id: phase.id, output: phaseOutput };

          writeFileSync(outFile, `# Phase: ${phase.id}\n\n${phaseOutput}\n`, 'utf-8');
          setRows(prev => prev.map(r =>
            r.id === phase.id
              ? { ...r, status: 'done', outFile, snippet: '', doneAt: Date.now() }
              : r
          ));
          return { id: phase.id, output: phaseOutput };
        }));
      } catch (err) {
        if (!liveRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setRows(prev => prev.map(r =>
          r.status === 'running'
            ? { ...r, status: 'failed', error: msg, doneAt: Date.now() }
            : r
        ));
        setRunStatus('error');
        setRunError(msg);
        return;
      }

      for (const r of waveResults) {
        phaseResults.set(r.id, r.output);
        completed.add(r.id);
        remaining.delete(r.id);
      }
    }

    if (liveRef.current) setRunStatus('done');
  }, []);

  // Kick off execution once we leave input mode and have a file
  useEffect(() => {
    if (!inputMode && inputFile && runStatus === 'idle') {
      setRunStatus('running');
      const t = Date.now();
      setStartedAt(t);
      setNow(t);
      void startExecution(inputFile);
    }
  }, [inputMode, inputFile, runStatus, startExecution]);

  useInput((char: string, key: Key) => {
    if (inputMode) {
      if (key.return && inputFile.trim()) { setInputMode(false); return; }
      if (key.escape) { router.pop(); return; }
      if (key.backspace || key.delete) { setInputFile(p => p.slice(0, -1)); return; }
      if (char && !key.ctrl && !key.meta) { setInputFile(p => p + char); return; }
      return;
    }
    if (key.upArrow)   { setSelectedRow(i => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setSelectedRow(i => Math.min(rows.length - 1, i + 1)); return; }
    if (key.escape && runStatus !== 'running') router.pop();
  });

  // ── Input mode ─────────────────────────────────────────────────────────────

  if (inputMode) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Exec — run a plan</Text>
        <Box>
          <Text dimColor>Plan file: </Text>
          <Text>{inputFile}</Text>
          <Text color="cyan" bold>▌</Text>
        </Box>
        <Text dimColor>[enter] start  [esc] back</Text>
      </Box>
    );
  }

  // ── Execution view ──────────────────────────────────────────────────────────

  const totalMs     = startedAt > 0 ? now - startedAt : 0;
  const activePhase = rows.find(r => r.status === 'running');

  return (
    <Box flexDirection="column" gap={1}>

      {/* Header */}
      <Box justifyContent="space-between">
        <Text bold>Exec — {path.basename(inputFile)}</Text>
        {startedAt > 0 && <Text dimColor>{fmtMs(totalMs)} total</Text>}
      </Box>

      {/* Dependency graph */}
      {graph && <Text dimColor>{graph}</Text>}

      {/* Phase rows */}
      <Box flexDirection="column">
        {rows.map((row, i) => {
          const elapsed = row.startedAt != null
            ? (row.doneAt ?? now) - row.startedAt
            : null;
          const active = i === selectedRow;
          return (
            <Box key={row.id}>
              {row.status === 'running'
                ? <><Spinner /><Text>{' '}</Text></>
                : <Text color={STATUS_COLOR[row.status]}>{STATUS_ICON[row.status]}{' '}</Text>
              }
              <Text color={active ? 'cyan' : undefined} bold={active}>
                {row.id.padEnd(16)}
              </Text>
              <Text dimColor>{row.agentType.padEnd(14)}</Text>
              <Text dimColor>
                {elapsed != null ? fmtMs(elapsed) : '—     '}
                {'  '}
              </Text>
              {row.status === 'running' && row.snippet ? (
                <Text dimColor>{row.snippet}</Text>
              ) : row.status === 'failed' && row.error ? (
                <Text color="red">{row.error.slice(0, 48)}</Text>
              ) : row.outFile ? (
                <Text dimColor>{path.basename(row.outFile)}</Text>
              ) : null}
            </Box>
          );
        })}
      </Box>

      {/* Stream pane — last N lines from the currently active phase */}
      {streamLines.length > 0 && activePhase && (
        <Box flexDirection="column">
          <Text dimColor>{'─── '}{activePhase.id}{' ─────────────────────────'}</Text>
          {streamLines.map((line, i) => (
            <Text key={i} dimColor>{line.slice(0, 80)}</Text>
          ))}
        </Box>
      )}

      {/* Footer */}
      {runStatus === 'done' && (
        <Text color="green">✓ All {rows.length} phase{rows.length !== 1 ? 's' : ''} complete.</Text>
      )}
      {runStatus === 'error' && (
        <Text color="red">✗ {runError}</Text>
      )}
      <Text dimColor>
        {runStatus === 'running'
          ? '[↑↓] scroll  [ctrl+c] abort'
          : '[esc] back  [↑↓] scroll'}
      </Text>

    </Box>
  );
}
