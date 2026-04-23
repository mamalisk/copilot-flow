import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { runSwarm } from '../../swarm/coordinator.js';
import { generateAgentName } from '../../output.js';
import type { AgentType, SwarmTask, SwarmTopology } from '../../types.js';
import type { RouterApi } from '../router.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const AVAILABLE_AGENTS: AgentType[] = [
  'researcher', 'coder', 'tester', 'reviewer', 'architect', 'analyst', 'debugger',
];

const TOPOLOGIES: SwarmTopology[] = ['hierarchical', 'mesh', 'sequential'];

const MAX_STREAM = 6;

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskStatus = 'waiting' | 'running' | 'done' | 'failed';
type ConfigField = 'task' | 'topology' | 'agents';

const STATUS_ICON: Record<TaskStatus, string> = {
  waiting: '○', running: '●', done: '✓', failed: '✗',
};

const STATUS_COLOR: Record<TaskStatus, string | undefined> = {
  waiting: undefined, running: 'cyan', done: 'green', failed: 'red',
};

interface TaskRow {
  id: string;
  agentType: string;
  label: string;
  status: TaskStatus;
  startedAt?: number;
  doneAt?: number;
  snippet: string;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

/**
 * Build SwarmTask[] with topology-appropriate dependencies.
 * - mesh: all tasks run in parallel (no dependsOn)
 * - sequential: linear chain (each depends on previous)
 * - hierarchical: first → [middle…] → last (3-wave pattern)
 */
function buildTasks(prompt: string, topology: SwarmTopology, agents: AgentType[]): SwarmTask[] {
  if (topology === 'mesh') {
    return agents.map((at, i) => ({ id: `task-${i + 1}`, agentType: at, prompt }));
  }
  if (topology === 'sequential') {
    return agents.map((at, i) => ({
      id: `task-${i + 1}`, agentType: at, prompt,
      dependsOn: i > 0 ? [`task-${i}`] : undefined,
    }));
  }
  // hierarchical: first → [middle] → last
  if (agents.length <= 2) {
    return agents.map((at, i) => ({
      id: `task-${i + 1}`, agentType: at, prompt,
      dependsOn: i > 0 ? ['task-1'] : undefined,
    }));
  }
  const tasks: SwarmTask[] = [{ id: 'task-1', agentType: agents[0], prompt }];
  for (let i = 1; i < agents.length - 1; i++) {
    tasks.push({ id: `task-${i + 1}`, agentType: agents[i], prompt, dependsOn: ['task-1'] });
  }
  const last   = agents.length;
  const midIds = agents.slice(1, -1).map((_, i) => `task-${i + 2}`);
  tasks.push({
    id: `task-${last}`, agentType: agents[last - 1], prompt,
    dependsOn: midIds.length > 0 ? midIds : ['task-1'],
  });
  return tasks;
}

/** Group tasks into execution waves based on dependsOn. */
function computeWaves(tasks: SwarmTask[]): string[][] {
  const done = new Set<string>();
  const rem  = new Set(tasks.map(t => t.id));
  const waves: string[][] = [];
  while (rem.size > 0) {
    const w = tasks.filter(t => rem.has(t.id) && (t.dependsOn ?? []).every(d => done.has(d)));
    if (w.length === 0) break;
    waves.push(w.map(t => t.id));
    for (const t of w) { done.add(t.id); rem.delete(t.id); }
  }
  return waves;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface SwarmProps { router: RouterApi; }

export function SwarmScreen({ router }: SwarmProps) {
  // Configure state
  const [taskPrompt,  setTaskPrompt]  = useState('');
  const [topoIdx,     setTopoIdx]     = useState(0);
  const [agentToggle, setAgentToggle] = useState<boolean[]>(
    AVAILABLE_AGENTS.map((_, i) => i < 3),  // researcher, coder, tester on by default
  );
  const [agentCursor, setAgentCursor] = useState(0);
  const [configField, setConfigField] = useState<ConfigField>('task');

  // Monitor state
  const [subView,     setSubView]     = useState<'configure' | 'monitor'>('configure');
  const [rows,        setRows]        = useState<TaskRow[]>([]);
  const [waves,       setWaves]       = useState<string[][]>([]);
  const [streamLines, setStreamLines] = useState<string[]>([]);
  const [runStatus,   setRunStatus]   = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [runError,    setRunError]    = useState('');
  const [startedAt,   setStartedAt]   = useState(0);
  const [now,         setNow]         = useState(() => Date.now());

  const liveRef = useRef(true);
  useEffect(() => () => { liveRef.current = false; }, []);

  const topology = TOPOLOGIES[topoIdx];

  // Tick every second while running for elapsed time display
  useEffect(() => {
    if (runStatus !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [runStatus]);

  const startSwarm = useCallback(async () => {
    const selected = AVAILABLE_AGENTS.filter((_, i) => agentToggle[i]);
    if (!taskPrompt.trim() || selected.length === 0) return;

    const tasks = buildTasks(taskPrompt.trim(), topology, selected);
    setWaves(computeWaves(tasks));
    setRows(tasks.map(t => ({
      id: t.id, agentType: t.agentType,
      label: generateAgentName(t.agentType),
      status: 'waiting', snippet: '',
    })));
    setSubView('monitor');
    const t0 = Date.now();
    setStartedAt(t0);
    setNow(t0);
    setRunStatus('running');

    try {
      await runSwarm(tasks, topology, {
        onProgress: (taskId, _at, chunk) => {
          if (!liveRef.current) return;
          setRows(prev => prev.map(r => {
            if (r.id !== taskId) return r;
            const lines = (r.snippet + chunk).split('\n');
            return {
              ...r,
              status: r.status === 'waiting' ? 'running' : r.status,
              startedAt: r.startedAt ?? Date.now(),
              snippet: lines.slice(-2).join(' ').slice(0, 50),
            };
          }));
          setStreamLines(prev =>
            [...prev, ...chunk.split('\n').filter(l => l.trim())].slice(-MAX_STREAM),
          );
        },
      });
      if (!liveRef.current) return;
      setRows(prev => prev.map(r =>
        r.status !== 'failed' ? { ...r, status: 'done', doneAt: Date.now() } : r,
      ));
      setRunStatus('done');
    } catch (err) {
      if (!liveRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setRows(prev => prev.map(r =>
        r.status === 'running' ? { ...r, status: 'failed', doneAt: Date.now() } : r,
      ));
      setRunError(msg);
      setRunStatus('error');
    }
  }, [taskPrompt, topology, agentToggle]);

  useInput((char: string, key: Key) => {
    if (subView === 'monitor') {
      if (key.escape && runStatus !== 'running') router.pop();
      return;
    }
    if (configField === 'task') {
      if (key.escape)                     { router.pop(); return; }
      if (key.tab || key.return)          { setConfigField('topology'); return; }
      if (key.backspace || key.delete)    { setTaskPrompt(p => p.slice(0, -1)); return; }
      if (char && !key.ctrl && !key.meta) { setTaskPrompt(p => p + char); return; }
      return;
    }
    if (configField === 'topology') {
      if (key.escape)             { setConfigField('task'); return; }
      if (key.tab || key.return)  { setConfigField('agents'); return; }
      if (key.leftArrow)          { setTopoIdx(i => (i - 1 + TOPOLOGIES.length) % TOPOLOGIES.length); return; }
      if (key.rightArrow)         { setTopoIdx(i => (i + 1) % TOPOLOGIES.length); return; }
      return;
    }
    // agents field
    if (key.escape)    { setConfigField('topology'); return; }
    if (key.leftArrow) { setAgentCursor(i => Math.max(0, i - 1)); return; }
    if (key.rightArrow){ setAgentCursor(i => Math.min(AVAILABLE_AGENTS.length - 1, i + 1)); return; }
    if (char === ' ')  { setAgentToggle(prev => prev.map((v, i) => i === agentCursor ? !v : v)); return; }
    if (key.tab)       { setConfigField('task'); return; }
    if (key.return && taskPrompt.trim() && agentToggle.some(Boolean)) { void startSwarm(); return; }
  });

  // ── Configure view ────────────────────────────────────────────────────────

  if (subView === 'configure') {
    const canStart = taskPrompt.trim().length > 0 && agentToggle.some(Boolean);
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Swarm — configure</Text>

        {/* Task prompt input */}
        <Box>
          <Text bold color={configField === 'task' ? 'cyan' : undefined}>{'Task      '}</Text>
          <Text dimColor>[</Text>
          <Text>{taskPrompt}</Text>
          {configField === 'task' && <Text color="cyan" bold>▌</Text>}
          <Text dimColor>]</Text>
        </Box>

        {/* Topology selector */}
        <Box>
          <Text bold color={configField === 'topology' ? 'cyan' : undefined}>{'Topology  '}</Text>
          {TOPOLOGIES.map((t, i) => (
            <Text key={t} color={i === topoIdx ? 'cyan' : undefined} bold={i === topoIdx}>
              {i === topoIdx && configField === 'topology' ? `❯ ${t}` : t}
              {i < TOPOLOGIES.length - 1 ? '   ' : ''}
            </Text>
          ))}
        </Box>

        {/* Agent type toggles */}
        <Box>
          <Text bold color={configField === 'agents' ? 'cyan' : undefined}>{'Agents    '}</Text>
          {AVAILABLE_AGENTS.map((at, i) => {
            const on       = agentToggle[i];
            const isCursor = configField === 'agents' && i === agentCursor;
            return (
              <Text key={at} color={isCursor ? 'cyan' : on ? undefined : 'gray'} bold={isCursor}>
                {on ? '✓' : '○'} {at}{'   '}
              </Text>
            );
          })}
        </Box>

        <Text dimColor>
          {configField === 'task'
            ? '[tab/enter] next field  [esc] back'
            : configField === 'topology'
            ? '[←→] cycle  [tab/enter] next  [esc] back'
            : canStart
            ? '[←→] navigate  [space] toggle  [enter] start  [tab] wrap'
            : '[←→] navigate  [space] toggle  (type a task + select at least 1 agent)'}
        </Text>
      </Box>
    );
  }

  // ── Monitor view ──────────────────────────────────────────────────────────

  const totalMs    = startedAt > 0 ? now - startedAt : 0;
  const activeTask = rows.find(r => r.status === 'running');
  const byId       = new Map(rows.map(r => [r.id, r]));

  const renderTaskRow = (row: TaskRow) => {
    const elapsed = row.startedAt != null ? (row.doneAt ?? now) - row.startedAt : null;
    return (
      <Box key={row.id}>
        <Text color={STATUS_COLOR[row.status]}>{STATUS_ICON[row.status]}{' '}</Text>
        <Text dimColor>{`[${row.agentType}]`.padEnd(14)}</Text>
        <Text>{row.label.padEnd(18)}</Text>
        <Text dimColor>{elapsed != null ? fmtMs(elapsed) : '—     '}{'  '}</Text>
        {row.status === 'running' && row.snippet
          ? <Text dimColor>{row.snippet}</Text>
          : row.status === 'failed'
          ? <Text color="red">failed</Text>
          : null}
      </Box>
    );
  };

  const renderRows = () => {
    if (topology === 'hierarchical') {
      return waves.flatMap((wave, wi) => {
        const divider = wi > 0
          ? [<Text key={`div-${wi}`} dimColor>{'─────────────────────────────────────────────'}</Text>]
          : [];
        const taskEls = wave.flatMap((id, ti) => {
          const row = byId.get(id);
          if (!row) return [];
          const elapsed = row.startedAt != null ? (row.doneAt ?? now) - row.startedAt : null;
          return [(
            <Box key={id}>
              <Text dimColor>{ti === 0 ? `Wave ${wi + 1}  ` : '         '}</Text>
              <Text color={STATUS_COLOR[row.status]}>{STATUS_ICON[row.status]}{' '}</Text>
              <Text dimColor>{`[${row.agentType}]`.padEnd(14)}</Text>
              <Text>{row.label.padEnd(18)}</Text>
              <Text dimColor>{elapsed != null ? fmtMs(elapsed) : '—     '}{'  '}</Text>
              {row.status === 'running' && row.snippet ? <Text dimColor>{row.snippet}</Text> : null}
              {row.status === 'failed' ? <Text color="red">failed</Text> : null}
            </Box>
          )];
        });
        return [...divider, ...taskEls];
      });
    }
    if (topology === 'sequential') {
      return rows.map((row, i) => (
        <Box key={row.id} flexDirection="column">
          {i > 0 && <Text dimColor>  ↓</Text>}
          {renderTaskRow(row)}
        </Box>
      ));
    }
    // mesh: flat list, no dividers
    return rows.map(row => renderTaskRow(row));
  };

  return (
    <Box flexDirection="column" gap={1}>

      {/* Header */}
      <Box justifyContent="space-between">
        <Text bold>
          Swarm — {topology} — {taskPrompt.length > 40 ? taskPrompt.slice(0, 40) + '…' : taskPrompt}
        </Text>
        {startedAt > 0 && <Text dimColor>{fmtMs(totalMs)} total</Text>}
      </Box>

      {/* Task rows */}
      <Box flexDirection="column">
        {renderRows()}
      </Box>

      {/* Stream pane — last N lines from the currently active task */}
      {streamLines.length > 0 && activeTask && (
        <Box flexDirection="column">
          <Text dimColor>{'─── '}{activeTask.label}{' ──────────────────────────'}</Text>
          {streamLines.map((line, i) => (
            <Text key={i} dimColor>{line.slice(0, 80)}</Text>
          ))}
        </Box>
      )}

      {/* Footer */}
      {runStatus === 'done' && (
        <Text color="green">✓ All {rows.length} task{rows.length !== 1 ? 's' : ''} complete.</Text>
      )}
      {runStatus === 'error' && <Text color="red">✗ {runError}</Text>}
      <Text dimColor>
        {runStatus === 'running' ? '[ctrl+c] abort' : '[esc] back'}
      </Text>

    </Box>
  );
}
