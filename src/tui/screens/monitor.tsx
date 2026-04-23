import { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { globalHooks } from '../../hooks/registry.js';
import type { HookEvent } from '../../types.js';
import type { RouterApi } from '../router.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const VISIBLE_ROWS = 15;

const ALL_HOOK_EVENTS: HookEvent[] = [
  'pre-task', 'post-task',
  'session-start', 'session-end',
  'agent-spawn', 'agent-terminate',
  'swarm-start', 'swarm-end',
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface MonitorEvent {
  id:     number;
  ts:     number;
  event:  HookEvent;
  data?:  unknown;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':');
}

function fmtMs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

// ── Event display helpers ─────────────────────────────────────────────────────

type D = Record<string, unknown>;

function isError(event: HookEvent, data: unknown): boolean {
  const d = data as D | undefined;
  return (event === 'post-task' || event === 'agent-terminate' || event === 'session-end') &&
    d?.success === false;
}

function eventColor(event: HookEvent): string | undefined {
  switch (event) {
    case 'swarm-start':
    case 'swarm-end':       return 'cyan';
    case 'agent-spawn':
    case 'agent-terminate': return 'blue';
    case 'pre-task':        return 'green';
    case 'post-task':       return 'green'; // overridden per-row when error
    default:                return undefined;
  }
}

function eventGlyph(event: HookEvent, data: unknown): string {
  const d = data as D | undefined;
  switch (event) {
    case 'post-task':
    case 'agent-terminate':
    case 'session-end':
      return d?.success === false ? '✗' : '✓';
    case 'swarm-end': {
      const rs = d?.results as Record<string, { success: boolean }> | undefined;
      return rs && Object.values(rs).every(r => r.success) ? '✓' : '✗';
    }
    default: return ' ';
  }
}

function summarize(event: HookEvent, data: unknown): string {
  const d = data as D | undefined;
  if (!d) return '';
  switch (event) {
    case 'swarm-start':
      return `${d.topology} · ${d.taskCount} task${d.taskCount === 1 ? '' : 's'}`;
    case 'swarm-end': {
      const rs = d.results as Record<string, { success: boolean }> | undefined;
      const total = rs ? Object.keys(rs).length : 0;
      const ok    = rs ? Object.values(rs).filter(r => r.success).length : 0;
      return `${ok}/${total} succeeded`;
    }
    case 'agent-spawn':
    case 'pre-task':
      return `[${d.agentType}]  ${d.label}`;
    case 'agent-terminate':
    case 'post-task': {
      const base = `[${d.agentType}]  ${d.label}`;
      const dur  = typeof d.durationMs === 'number' ? `  ${fmtMs(d.durationMs)}` : '';
      const err  = d.success === false && d.error ? `  ${String(d.error).slice(0, 40)}` : '';
      return base + dur + err;
    }
    case 'session-start':
      return `[${d.agentType}]  ${d.label}  (${d.model})`;
    case 'session-end':
      return `[${d.agentType}]  ${d.label}`;
    default:
      return JSON.stringify(data).slice(0, 60);
  }
}

// Short display name for event labels (padded to 14 chars)
const EVENT_LABEL: Record<HookEvent, string> = {
  'pre-task':        'pre-task',
  'post-task':       'post-task',
  'session-start':   'session-start',
  'session-end':     'session-end',
  'agent-spawn':     'agent-spawn',
  'agent-terminate': 'agent-term',
  'swarm-start':     'swarm-start',
  'swarm-end':       'swarm-end',
};

// ── Component ─────────────────────────────────────────────────────────────────

interface MonitorProps { router: RouterApi; }

export function MonitorScreen({ router }: MonitorProps) {
  const [events,  setEvents]  = useState<MonitorEvent[]>([]);
  const [frozen,  setFrozen]  = useState(false);
  const [filter,  setFilter]  = useState<'all' | 'errors'>('all');
  const [scroll,  setScroll]  = useState(0);

  const idRef     = useRef(0);
  const frozenRef = useRef(false);

  // Register on all hook events — use a ref so the closure never goes stale
  useEffect(() => {
    const unsubs = ALL_HOOK_EVENTS.map(evt =>
      globalHooks.on(evt, async (ctx) => {
        if (frozenRef.current) return;
        setEvents(prev => [
          ...prev,
          { id: idRef.current++, ts: ctx.timestamp, event: evt, data: ctx.data },
        ].slice(-500));
        setScroll(0); // jump to tail on new event
      }),
    );
    return () => unsubs.forEach(fn => fn());
  }, []);

  useInput((char: string, key: Key) => {
    if (key.escape)    { router.pop(); return; }
    if (key.upArrow) {
      setScroll(s => {
        const max = Math.max(0, events.length - VISIBLE_ROWS);
        return Math.min(s + 1, max);
      });
      return;
    }
    if (key.downArrow) {
      setScroll(s => Math.max(0, s - 1));
      return;
    }
    if (char === 'f') {
      frozenRef.current = !frozenRef.current;
      setFrozen(frozenRef.current);
      return;
    }
    if (char === 'a') { setFilter('all');    return; }
    if (char === 'e') { setFilter('errors'); return; }
  });

  // ── Derived display ───────────────────────────────────────────────────────

  const filtered = filter === 'errors'
    ? events.filter(e => isError(e.event, e.data))
    : events;

  const total  = filtered.length;
  const endIdx = total - scroll;
  const startIdx = Math.max(0, endIdx - VISIBLE_ROWS);
  const visible  = filtered.slice(startIdx, endIdx);

  // ── Empty state ───────────────────────────────────────────────────────────

  if (events.length === 0) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Monitor — live event feed</Text>
        <Text dimColor>No events yet. Start an exec, swarm, or agent run to see activity here.</Text>
        <Text dimColor>[esc] back</Text>
      </Box>
    );
  }

  // ── Feed ──────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" gap={1}>

      {/* Header */}
      <Box justifyContent="space-between">
        <Text bold>Monitor — live event feed</Text>
        <Box gap={2}>
          {frozen && <Text color="yellow" bold>FROZEN</Text>}
          {filter === 'errors' && <Text color="red">errors only</Text>}
          <Text dimColor>{total} event{total !== 1 ? 's' : ''}</Text>
        </Box>
      </Box>

      {/* Event rows */}
      <Box flexDirection="column">
        {visible.length === 0 && (
          <Text dimColor>No matching events.</Text>
        )}
        {visible.map(ev => {
          const error  = isError(ev.event, ev.data);
          const color  = error ? 'red' : eventColor(ev.event);
          const glyph  = eventGlyph(ev.event, ev.data);
          const label  = EVENT_LABEL[ev.event] ?? ev.event;
          const summary = summarize(ev.event, ev.data);
          return (
            <Box key={ev.id}>
              <Text dimColor>{fmtTime(ev.ts)}{'  '}</Text>
              <Text color={color} bold={!!color}>{label.padEnd(15)}</Text>
              <Text color={glyph === '✓' ? 'green' : glyph === '✗' ? 'red' : undefined}>
                {glyph}{'  '}
              </Text>
              <Text dimColor={!color}>{summary}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Scroll indicator */}
      {scroll > 0 && (
        <Text dimColor>↑ {scroll} line{scroll !== 1 ? 's' : ''} above  ↓ to tail</Text>
      )}

      {/* Footer */}
      <Text dimColor>
        {filter === 'all' ? '[a] all  ' : '[a] all  '}
        {filter === 'errors' ? '[e] errors✓  ' : '[e] errors  '}
        {frozen ? '[f] unfreeze  ' : '[f] freeze  '}
        {'[↑↓] scroll  [esc] back'}
      </Text>

    </Box>
  );
}
