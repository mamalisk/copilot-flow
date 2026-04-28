import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { getTelemetryStore } from '../../telemetry/store.js';
import type { TelemetrySummary, TelemetryRun } from '../../types.js';
import type { RouterApi } from '../router.js';

const MAX_VISIBLE = 12;

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function fmtPct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function fmtKB(chars: number): string {
  return chars >= 1024 ? `${(chars / 1024).toFixed(1)}KB` : `${chars}B`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

interface TelemetryProps {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  router: RouterApi;
}

export function TelemetryScreen({ router: _router }: TelemetryProps) {
  const [summary, setSummary] = useState<TelemetrySummary | null>(null);
  const [runs, setRuns]       = useState<TelemetryRun[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [lastCleared, setLastCleared]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(() => {
    try {
      const store = getTelemetryStore();
      setSummary(store.summary());
      setRuns(store.list({ limit: 50 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useInput((char: string, key: Key) => {
    if (clearConfirm) {
      if (char === 'y' || char === 'Y') {
        try { getTelemetryStore().clear(); } catch { /* ignore */ }
        setLastCleared(true);
        setClearConfirm(false);
        load();
      } else {
        setClearConfirm(false);
      }
      return;
    }

    if (key.upArrow)   { setSelectedIdx(i => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setSelectedIdx(i => Math.min(runs.length - 1, i + 1)); return; }
    if (char === 'r')  { setLoading(true); setLastCleared(false); load(); return; }
    if (char === 'c')  { setClearConfirm(true); return; }
  });

  if (loading) return <Text dimColor>Loading…</Text>;

  if (error) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="red">Telemetry store error: {error}</Text>
      </Box>
    );
  }

  if (!summary || summary.totalRuns === 0) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text>No telemetry data yet.</Text>
        <Text dimColor>Run agents with any command to start recording metrics.</Text>
        <Text dimColor>[r] refresh  [esc] back</Text>
      </Box>
    );
  }

  // Windowed slice for the run list
  const windowStart = Math.max(
    0,
    Math.min(selectedIdx - Math.floor(MAX_VISIBLE / 2), runs.length - MAX_VISIBLE),
  );
  const visibleRuns = runs.slice(windowStart, windowStart + MAX_VISIBLE);

  const agentEntries = Object.entries(summary.byAgentType);

  return (
    <Box flexDirection="column" gap={1}>

      {/* ── Summary stats row ─────────────────────────────────────────── */}
      <Box gap={4}>
        <Box flexDirection="column">
          <Text dimColor>Runs</Text>
          <Text bold color="cyan">{summary.totalRuns}</Text>
        </Box>
        <Box flexDirection="column">
          <Text dimColor>Success</Text>
          <Text bold color={summary.successRate >= 0.9 ? 'green' : 'yellow'}>
            {fmtPct(summary.successRate)}
          </Text>
        </Box>
        <Box flexDirection="column">
          <Text dimColor>Avg latency</Text>
          <Text bold>{fmtDuration(summary.avgDurationMs)}</Text>
        </Box>
        <Box flexDirection="column">
          <Text dimColor>Avg prompt</Text>
          <Text bold>{fmtKB(summary.avgPromptChars)}</Text>
        </Box>
        <Box flexDirection="column">
          <Text dimColor>Avg response</Text>
          <Text bold>{fmtKB(summary.avgResponseChars)}</Text>
        </Box>
        {(summary.totalInputTokens ?? 0) > 0 && (
          <>
            <Box flexDirection="column">
              <Text dimColor>Total in</Text>
              <Text bold>{fmtTokens(summary.totalInputTokens ?? 0)}</Text>
            </Box>
            <Box flexDirection="column">
              <Text dimColor>Total out</Text>
              <Text bold>{fmtTokens(summary.totalOutputTokens ?? 0)}</Text>
            </Box>
            <Box flexDirection="column">
              <Text dimColor>Avg in</Text>
              <Text bold>{fmtTokens(Math.round(summary.avgInputTokens ?? 0))}</Text>
            </Box>
            <Box flexDirection="column">
              <Text dimColor>Avg out</Text>
              <Text bold>{fmtTokens(Math.round(summary.avgOutputTokens ?? 0))}</Text>
            </Box>
          </>
        )}
      </Box>

      {/* ── Two-pane breakdown ────────────────────────────────────────── */}
      <Box flexDirection="row" gap={4}>

        {/* Left: per-agent-type breakdown */}
        <Box flexDirection="column" width={52}>
          <Text bold dimColor>Agent breakdown</Text>
          {agentEntries.map(([type, stat]) => (
            <Box key={type} gap={1}>
              <Text color="cyan">{type.padEnd(22)}</Text>
              <Text dimColor>{String(stat.runs).padStart(4)} runs</Text>
              <Text dimColor>{fmtPct(stat.successRate).padStart(4)}</Text>
              <Text dimColor>{fmtDuration(stat.avgDurationMs).padStart(7)}</Text>
            </Box>
          ))}
        </Box>

        {/* Right: top tools */}
        {summary.topTools.length > 0 && (
          <Box flexDirection="column">
            <Text bold dimColor>Top tools</Text>
            {summary.topTools.slice(0, 8).map(({ tool, count }) => (
              <Box key={tool} gap={1}>
                <Text color="cyan">{tool.padEnd(26)}</Text>
                <Text dimColor>{String(count).padStart(5)} calls</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* ── Recent runs list ──────────────────────────────────────────── */}
      <Box flexDirection="column">
        <Text bold dimColor>Recent runs</Text>
        {visibleRuns.map((r, i) => {
          const abs    = windowStart + i;
          const active = abs === selectedIdx;
          const status = r.success ? '✓' : '✗';
          const tools  = r.toolsInvoked.length > 0 ? ` [${r.toolsInvoked.length}t]` : '';
          const tokens = (r.inputTokens ?? 0) > 0
            ? `  ${fmtTokens(r.inputTokens ?? 0)}↑${fmtTokens(r.outputTokens ?? 0)}↓`
            : '';
          return (
            <Box key={r.id}>
              <Text color={active ? 'cyan' : undefined}>
                {active ? '❯ ' : '  '}
                <Text color={r.success ? 'green' : 'red'}>{status}</Text>
                {'  '}
                <Text dimColor>{fmtDate(r.createdAt)}</Text>
                {'  '}
                <Text>{r.agentType.padEnd(20)}</Text>
                {'  '}
                <Text dimColor>{fmtDuration(r.durationMs).padStart(7)}</Text>
                <Text dimColor>{tools}</Text>
                <Text dimColor>{tokens}</Text>
                {!r.success && r.error && (
                  <Text color="red">{'  '}{r.error.slice(0, 40)}</Text>
                )}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* ── Status bar ───────────────────────────────────────────────── */}
      {clearConfirm ? (
        <Box gap={1}>
          <Text color="yellow">Clear all telemetry records?</Text>
          <Text dimColor>[y] confirm  [any other] cancel</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {lastCleared && <Text color="green">✓ Telemetry cleared</Text>}
          <Text dimColor>[↑↓] navigate  [r] refresh  [c] clear  [esc] back</Text>
        </Box>
      )}

    </Box>
  );
}
