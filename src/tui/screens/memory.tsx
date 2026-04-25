import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { isInitialised } from '../../config.js';
import { getMemoryStore } from '../../memory/store.js';
import type { MemoryEntry } from '../../types.js';
import type { RouterApi } from '../router.js';

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
const MAX_VISIBLE = 12;

interface MemoryProps {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  router: RouterApi;
  onCaptureInput: (capture: boolean) => void;
}

type Mode = 'list' | 'search';

export function MemoryScreen({ router: _router, onCaptureInput }: MemoryProps) {
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [nsIdx, setNsIdx]           = useState(0);
  const [entries, setEntries]       = useState<MemoryEntry[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [mode, setMode]             = useState<Mode>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [lastDeleted, setLastDeleted] = useState('');

  // Load namespaces once on mount
  useEffect(() => {
    try {
      const store = getMemoryStore();
      const ns = store.listNamespaces();
      setNamespaces(ns);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const currentNs = namespaces[nsIdx] ?? '';

  // Reload entry list whenever namespace or search query changes
  const reload = useCallback((ns: string, query: string) => {
    if (!ns) { setEntries([]); return; }
    try {
      const store = getMemoryStore();
      const list = query
        ? store.search(ns, query)
        : store.list(ns);
      setEntries(list);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    setSelectedIdx(0);
    reload(currentNs, searchQuery);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNs]);

  // Search debounce: only fires when in search mode
  useEffect(() => {
    if (mode !== 'search') return;
    const timer = setTimeout(() => {
      reload(currentNs, searchQuery);
      setSelectedIdx(0);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery, currentNs, mode, reload]);

  useInput((char: string, key: Key) => {
    // ── Search mode ──────────────────────────────────────────────────────────
    if (mode === 'search') {
      if (key.escape) {
        setMode('list');
        setSearchQuery('');
        reload(currentNs, '');
        setSelectedIdx(0);
        onCaptureInput(false);
        return;
      }
      if (key.return) {
        setMode('list');
        onCaptureInput(false);
        return;
      }
      if (key.backspace || key.delete) {
        setSearchQuery(prev => prev.slice(0, -1));
        return;
      }
      if (char && !key.ctrl && !key.meta) {
        setSearchQuery(prev => prev + char);
        return;
      }
      return;
    }

    // ── Delete confirm prompt ─────────────────────────────────────────────────
    if (deleteConfirm) {
      if (char === 'y' || char === 'Y') {
        const entry = entries[selectedIdx];
        if (entry) {
          try {
            getMemoryStore().delete(entry.namespace, entry.key);
            setLastDeleted(entry.key);
          } catch { /* ignore */ }
          const newIdx = Math.max(0, selectedIdx - 1);
          setDeleteConfirm(false);
          reload(currentNs, searchQuery);
          setSelectedIdx(newIdx);
        }
      } else {
        setDeleteConfirm(false);
      }
      return;
    }

    // ── List navigation ───────────────────────────────────────────────────────
    if (key.upArrow) {
      setSelectedIdx(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIdx(i => Math.min(entries.length - 1, i + 1));
      return;
    }

    // [n] / [N] — cycle namespace forward / backward
    if (char === 'n') {
      setNsIdx(i => (i + 1) % Math.max(1, namespaces.length));
      setSearchQuery('');
      return;
    }
    if (char === 'N') {
      setNsIdx(i => (i - 1 + namespaces.length) % Math.max(1, namespaces.length));
      setSearchQuery('');
      return;
    }

    // [/] — enter search mode
    if (char === '/') {
      setMode('search');
      setSearchQuery('');
      onCaptureInput(true);
      return;
    }

    // [d] — delete selected
    if (char === 'd' && entries.length > 0) {
      setDeleteConfirm(true);
      setLastDeleted('');
      return;
    }
  });

  // ── Windowed slice for the entry list ──────────────────────────────────────
  const windowStart = Math.max(
    0,
    Math.min(selectedIdx - Math.floor(MAX_VISIBLE / 2), entries.length - MAX_VISIBLE),
  );
  const visibleEntries = entries.slice(windowStart, windowStart + MAX_VISIBLE);
  const selected = entries[selectedIdx];

  // ── Edge states ─────────────────────────────────────────────────────────────
  if (loading) return <Text dimColor>Loading…</Text>;

  if (error) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="red">Memory store error: {error}</Text>
        <Text dimColor>Ensure copilot-flow is initialised (run: copilot-flow init)</Text>
      </Box>
    );
  }

  if (!isInitialised() || namespaces.length === 0) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text>No memory entries found.</Text>
        <Text dimColor>
          Run agents with --memory-namespace to start storing facts.
        </Text>
      </Box>
    );
  }

  // ── Main layout ─────────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" gap={1}>

      {/* Namespace bar */}
      <Box>
        <Text bold>Namespaces: </Text>
        {namespaces.map((ns, i) => (
          <Text key={ns} color={i === nsIdx ? 'cyan' : undefined} bold={i === nsIdx}>
            {i === nsIdx ? `[${ns}]` : ns}
            {i < namespaces.length - 1 ? '  ·  ' : ''}
          </Text>
        ))}
        <Text dimColor>
          {'  '}
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          {searchQuery ? `  (filtered: "${searchQuery}")` : ''}
        </Text>
      </Box>

      {/* Two-pane content */}
      <Box flexDirection="row" gap={3}>

        {/* Left pane — entry list */}
        <Box flexDirection="column" width={42}>
          {visibleEntries.map((e, i) => {
            const abs    = windowStart + i;
            const active = abs === selectedIdx;
            const label  = e.key.length > 24 ? e.key.slice(0, 23) + '…' : e.key.padEnd(24);
            return (
              <Box key={e.id}>
                <Text color={active ? 'cyan' : undefined}>
                  {active ? '❯ ' : '  '}
                  {label}
                  {'  '}
                  {stars(e.importance)}
                </Text>
              </Box>
            );
          })}
          {entries.length === 0 && (
            <Text dimColor>
              {searchQuery ? `  No results for "${searchQuery}"` : '  (empty namespace)'}
            </Text>
          )}
        </Box>

        {/* Right pane — detail */}
        {selected && (
          <Box flexDirection="column" flexGrow={1}>
            <Box>
              <Text bold>{'Key        '}</Text>
              <Text color="cyan">{selected.key}</Text>
            </Box>
            <Box marginTop={1}>
              <Text bold>{'Value      '}</Text>
              <Text wrap="wrap">
                {selected.value.length > 200
                  ? selected.value.slice(0, 200) + '…'
                  : selected.value}
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text bold>{'Type       '}</Text>
              <Text dimColor>{selected.type}</Text>
            </Box>
            <Box>
              <Text bold>{'Importance '}</Text>
              <Text color="yellow">{stars(selected.importance)}</Text>
            </Box>
            {selected.tags.length > 0 && (
              <Box>
                <Text bold>{'Tags       '}</Text>
                <Text dimColor>{selected.tags.join(' · ')}</Text>
              </Box>
            )}
            <Box>
              <Text bold>{'Created    '}</Text>
              <Text dimColor>
                {new Date(selected.createdAt).toISOString().slice(0, 10)}
              </Text>
            </Box>
            {selected.expiresAt != null && (
              <Box>
                <Text bold>{'Expires    '}</Text>
                <Text dimColor>
                  {new Date(selected.expiresAt).toISOString().slice(0, 10)}
                </Text>
              </Box>
            )}
          </Box>
        )}
      </Box>

      {/* Bottom status / input bar */}
      {mode === 'search' ? (
        <Box>
          <Text bold color="cyan">{'/ '}</Text>
          <Text>{searchQuery}</Text>
          <Text color="cyan" bold>{'▌'}</Text>
          <Text dimColor>{'  [enter] apply  [esc] clear'}</Text>
        </Box>
      ) : deleteConfirm ? (
        <Box gap={1}>
          <Text color="yellow">Delete &quot;{selected?.key}&quot;?</Text>
          <Text dimColor>[y] confirm  [any other] cancel</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {lastDeleted !== '' && (
            <Text color="green">✓ Deleted &quot;{lastDeleted}&quot;</Text>
          )}
          <Text dimColor>
            [↑↓] navigate  [n/N] namespace  [/] search  [d] delete  [esc] back
          </Text>
        </Box>
      )}

    </Box>
  );
}
