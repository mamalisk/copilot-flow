import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { Spinner } from '../components/Spinner.js';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { generatePlan } from '../../lib/planner.js';
import { AGENT_TYPE_LIST } from '../../types.js';
import type { PlanPhase, Plan, SwarmTopology } from '../../types.js';
import type { RouterApi } from '../router.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const TOPOLOGIES: SwarmTopology[] = ['hierarchical', 'mesh', 'sequential'];
const MAX_STREAM = 6;

// ── Types ─────────────────────────────────────────────────────────────────────

type PlanSubView = 'input' | 'generating' | 'studio';
type StudioFocus = 'list' | 'edit';
type EditField   = 'description' | 'type' | 'agentType' | 'topology' | 'model';

// ── Pure helpers ──────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function phaseLabel(p: PlanPhase): string {
  return p.type === 'swarm'
    ? `swarm/${p.topology ?? 'hierarchical'}`
    : `agent/${p.agentType ?? '?'}`;
}

function getEditFields(p: PlanPhase): EditField[] {
  const fields: EditField[] = ['description', 'type'];
  fields.push(p.type === 'agent' ? 'agentType' : 'topology');
  fields.push('model');
  return fields;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface PlanProps { router: RouterApi; }

export function PlanScreen({ router }: PlanProps) {
  const routerArgs = router.current.args?.args as string[] | undefined;
  const initSpec   = routerArgs?.[0] ?? '';

  // Generation state
  const [subView,      setSubView]      = useState<PlanSubView>(initSpec ? 'generating' : 'input');
  const [specInput,    setSpecInput]    = useState(initSpec);
  const [streamLines,  setStreamLines]  = useState<string[]>([]);
  const [genStatus,    setGenStatus]    = useState<'idle'|'running'|'done'|'error'>('idle');
  const [genError,     setGenError]     = useState('');
  const [startedAt,    setStartedAt]    = useState(0);
  const [now,          setNow]          = useState(() => Date.now());

  // Studio state
  const [phases,        setPhases]        = useState<PlanPhase[]>([]);
  const [selectedPhase, setSelectedPhase] = useState(0);
  const [focus,         setFocus]         = useState<StudioFocus>('list');
  const [editField,     setEditField]     = useState<EditField>('description');
  const [agentCursor,   setAgentCursor]   = useState(0);
  const [topoCursor,    setTopoCursor]    = useState(0);
  const [saveMsg,       setSaveMsg]       = useState('');

  const liveRef = useRef(true);
  useEffect(() => () => { liveRef.current = false; }, []);

  // Tick while generating
  useEffect(() => {
    if (genStatus !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [genStatus]);

  const startGeneration = useCallback(async (spec: string) => {
    setSubView('generating');
    setGenStatus('running');
    setStreamLines([]);
    const t0 = Date.now();
    setStartedAt(t0);
    setNow(t0);

    const result = await generatePlan(spec, {
      onChunk: (chunk: string) => {
        if (!liveRef.current) return;
        setStreamLines(prev =>
          [...prev, ...chunk.split('\n').filter(l => l.trim())].slice(-MAX_STREAM),
        );
      },
    });

    if (!liveRef.current) return;

    if (!result.success || !result.plan) {
      setGenError(result.error ?? 'Generation failed');
      setGenStatus('error');
      return;
    }

    result.plan.spec = spec;
    setPhases(result.plan.phases);
    setSelectedPhase(0);
    setGenStatus('done');
    setSubView('studio');
  }, []);

  // Auto-start if spec came from router args
  useEffect(() => {
    if (initSpec && genStatus === 'idle') {
      void startGeneration(initSpec);
    }
  }, [initSpec, genStatus, startGeneration]);

  // ── Studio helpers ────────────────────────────────────────────────────────

  const writePlan = (filePath: string) => {
    const plan: Plan = { version: '1', spec: specInput, phases };
    mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    writeFileSync(filePath, yaml.dump(plan, { lineWidth: 100 }), 'utf-8');
  };

  const enterEdit = () => {
    const p = phases[selectedPhase];
    if (!p) return;
    setFocus('edit');
    setEditField('description');
    setAgentCursor(AGENT_TYPE_LIST.findIndex(at => at === (p.agentType ?? 'analyst')) || 0);
    setTopoCursor(TOPOLOGIES.indexOf(p.topology ?? 'hierarchical'));
  };

  const updatePhase = (updater: (p: PlanPhase) => PlanPhase) =>
    setPhases(prev => prev.map((p, i) => i === selectedPhase ? updater(p) : p));

  // ── Input handler ─────────────────────────────────────────────────────────

  useInput((char: string, key: Key) => {
    // Input sub-view
    if (subView === 'input') {
      if (key.escape) { router.pop(); return; }
      if (key.return && specInput.trim()) { void startGeneration(specInput.trim()); return; }
      if (key.backspace || key.delete)   { setSpecInput(p => p.slice(0, -1)); return; }
      if (char && !key.ctrl && !key.meta) { setSpecInput(p => p + char); return; }
      return;
    }

    // Generating sub-view
    if (subView === 'generating') {
      if (key.escape && genStatus !== 'running') { setSubView('input'); return; }
      return;
    }

    // Studio — list focus
    if (focus === 'list') {
      if (key.escape)    { router.pop(); return; }
      if (key.upArrow)   { setSelectedPhase(i => Math.max(0, i - 1)); setSaveMsg(''); return; }
      if (key.downArrow) { setSelectedPhase(i => Math.min(phases.length - 1, i + 1)); setSaveMsg(''); return; }
      if (key.return)    { enterEdit(); return; }
      if (char === 'x' && phases.length > 0) {
        const tmp = path.join('.copilot-flow', 'plans', `studio-${Date.now()}`, 'phases.yaml');
        writePlan(tmp);
        router.push('exec', { args: [tmp] });
        return;
      }
      if (char === 's' && phases.length > 0) {
        const base = path.basename(specInput, path.extname(specInput));
        const out  = path.join('.copilot-flow', 'plans', `${base}-studio`, 'phases.yaml');
        writePlan(out);
        setSaveMsg(`Saved → ${out}`);
        return;
      }
      return;
    }

    // Studio — edit focus
    const phase = phases[selectedPhase];
    if (!phase) return;

    if (key.escape) { setFocus('list'); return; }

    if (key.tab) {
      const fields = getEditFields(phase);
      const idx = fields.indexOf(editField);
      setEditField(fields[(idx + 1) % fields.length]);
      return;
    }

    if (editField === 'description') {
      if (key.backspace || key.delete)    { updatePhase(p => ({ ...p, description: p.description.slice(0, -1) })); return; }
      if (char && !key.ctrl && !key.meta) { updatePhase(p => ({ ...p, description: p.description + char })); return; }
      return;
    }

    if (editField === 'model') {
      if (key.backspace || key.delete) {
        updatePhase(p => {
          const m = (p.model ?? '').slice(0, -1);
          return { ...p, model: m || undefined };
        });
        return;
      }
      if (char && !key.ctrl && !key.meta) { updatePhase(p => ({ ...p, model: (p.model ?? '') + char })); return; }
      return;
    }

    if (editField === 'type' && (key.leftArrow || key.rightArrow)) {
      updatePhase(p => {
        const nt = p.type === 'agent' ? 'swarm' : 'agent';
        return {
          ...p,
          type:      nt,
          agentType: nt === 'agent' ? (p.agentType ?? 'analyst') : undefined,
          topology:  nt === 'swarm' ? (p.topology  ?? 'hierarchical') : undefined,
          agents:    nt === 'swarm' ? (p.agents    ?? ['researcher', 'coder', 'reviewer']) : undefined,
        };
      });
      return;
    }

    if (editField === 'agentType' && phase.type === 'agent') {
      const delta = key.rightArrow ? 1 : key.leftArrow ? -1 : 0;
      if (delta !== 0) {
        const nc = (agentCursor + delta + AGENT_TYPE_LIST.length) % AGENT_TYPE_LIST.length;
        setAgentCursor(nc);
        updatePhase(p => ({ ...p, agentType: AGENT_TYPE_LIST[nc] }));
      }
      return;
    }

    if (editField === 'topology' && phase.type === 'swarm') {
      const delta = key.rightArrow ? 1 : key.leftArrow ? -1 : 0;
      if (delta !== 0) {
        const nc = (topoCursor + delta + TOPOLOGIES.length) % TOPOLOGIES.length;
        setTopoCursor(nc);
        updatePhase(p => ({ ...p, topology: TOPOLOGIES[nc] }));
      }
      return;
    }
  });

  // ── Input view ────────────────────────────────────────────────────────────

  if (subView === 'input') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Plan — generate</Text>
        <Box>
          <Text dimColor>{'Spec file  ['}</Text>
          <Text>{specInput}</Text>
          <Text color="cyan" bold>▌</Text>
          <Text dimColor>]</Text>
        </Box>
        <Text dimColor>[enter] start  [esc] back</Text>
      </Box>
    );
  }

  // ── Generating view ───────────────────────────────────────────────────────

  if (subView === 'generating') {
    const totalMs = startedAt > 0 ? now - startedAt : 0;
    return (
      <Box flexDirection="column" gap={1}>
        <Box justifyContent="space-between">
          <Text bold>Plan — generating {path.basename(specInput)}</Text>
          {startedAt > 0 && <Text dimColor>{fmtMs(totalMs)}</Text>}
        </Box>
        <Box>
          {genStatus === 'running' && <><Spinner /><Text>{' '}</Text></>}
          {genStatus === 'error'   && <Text color="red">{'✗ '}</Text>}
          <Text dimColor>
            {genStatus === 'running' ? 'analyst agent running…' : genError}
          </Text>
        </Box>
        {streamLines.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>{'─── streaming ──────────────────────────────'}</Text>
            {streamLines.map((line, i) => (
              <Text key={i} dimColor>{line.slice(0, 80)}</Text>
            ))}
          </Box>
        )}
        <Text dimColor>
          {genStatus === 'running' ? '[ctrl+c] abort' : '[esc] back'}
        </Text>
      </Box>
    );
  }

  // ── Studio view ───────────────────────────────────────────────────────────

  const phase = phases[selectedPhase];

  return (
    <Box flexDirection="column" gap={1}>

      {/* Header */}
      <Box>
        <Text bold>{'Plan Studio — '}{path.basename(specInput)}{'  '}</Text>
        <Text dimColor>[{phases.length} phase{phases.length !== 1 ? 's' : ''}]</Text>
      </Box>

      {/* Phase list */}
      <Box flexDirection="column">
        {phases.map((p, i) => {
          const active = i === selectedPhase;
          return (
            <Box key={p.id}>
              <Text color={active ? 'cyan' : undefined} bold={active}>{active ? '❯ ' : '  '}</Text>
              <Text color={active ? 'cyan' : undefined} bold={active}>{p.id.padEnd(18)}</Text>
              <Text dimColor>{phaseLabel(p).padEnd(22)}</Text>
              <Text dimColor>
                {p.description.length > 34 ? p.description.slice(0, 34) + '…' : p.description}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Edit panel */}
      {focus === 'edit' && phase && (
        <Box flexDirection="column">
          <Text dimColor>{'── edit: '}{phase.id}{' ─────────────────────────────────────'}</Text>

          <Box>
            <Text bold color={editField === 'description' ? 'cyan' : undefined}>{'  Description  '}</Text>
            <Text dimColor>[</Text>
            <Text>{phase.description}</Text>
            {editField === 'description' && <Text color="cyan" bold>▌</Text>}
            <Text dimColor>]</Text>
          </Box>

          <Box>
            <Text bold color={editField === 'type' ? 'cyan' : undefined}>{'  Type         '}</Text>
            {(['agent', 'swarm'] as const).map(t => (
              <Text key={t} color={t === phase.type ? 'cyan' : 'gray'} bold={t === phase.type}>
                {editField === 'type' && t === phase.type ? `❯ ${t}` : t}{'   '}
              </Text>
            ))}
          </Box>

          {phase.type === 'agent' && (
            <Box>
              <Text bold color={editField === 'agentType' ? 'cyan' : undefined}>{'  Agent        '}</Text>
              {AGENT_TYPE_LIST.slice(Math.max(0, agentCursor - 3), agentCursor + 4).map((at, j) => {
                const abs = Math.max(0, agentCursor - 3) + j;
                const sel = abs === agentCursor;
                return (
                  <Text key={at} color={sel ? 'cyan' : 'gray'} bold={sel}>
                    {editField === 'agentType' && sel ? `❯ ${at}` : at}{'   '}
                  </Text>
                );
              })}
            </Box>
          )}

          {phase.type === 'swarm' && (
            <Box>
              <Text bold color={editField === 'topology' ? 'cyan' : undefined}>{'  Topology     '}</Text>
              {TOPOLOGIES.map((t, i) => (
                <Text key={t} color={i === topoCursor ? 'cyan' : 'gray'} bold={i === topoCursor}>
                  {editField === 'topology' && i === topoCursor ? `❯ ${t}` : t}{'   '}
                </Text>
              ))}
            </Box>
          )}

          <Box>
            <Text bold color={editField === 'model' ? 'cyan' : undefined}>{'  Model        '}</Text>
            <Text dimColor>[</Text>
            <Text>{phase.model ?? (editField === 'model' ? '' : '(default)')}</Text>
            {editField === 'model' && <Text color="cyan" bold>▌</Text>}
            <Text dimColor>]</Text>
          </Box>
        </Box>
      )}

      {saveMsg && <Text color="green">{saveMsg}</Text>}

      <Text dimColor>
        {focus === 'edit'
          ? '[tab] next field  [←→] cycle  [esc] done editing'
          : '[↑↓] select  [enter] edit  [x] exec  [s] save  [esc] back'}
      </Text>

    </Box>
  );
}
