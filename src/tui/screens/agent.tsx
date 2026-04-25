import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { Spinner } from '../components/Spinner.js';
import { writeFileSync } from 'fs';
import { runAgentTask } from '../../agents/executor.js';
import { getMemoryStore } from '../../memory/store.js';
import { generateAgentName } from '../../output.js';
import { clientManager } from '../../core/client-manager.js';
import { loadConfig } from '../../config.js';
import { AGENT_TYPE_LIST } from '../../types.js';
import type { AgentType } from '../../types.js';
import type { RouterApi } from '../router.js';

interface ModelEntry { id: string; name: string; }

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_STREAM = 6;

// ── Types ─────────────────────────────────────────────────────────────────────

type ConfigField  = 'task' | 'agent' | 'model';
type RunStatus    = 'idle' | 'running' | 'done' | 'error';
type PostAction   = 'none' | 'memory-ns' | 'memory-key' | 'save-file';

// ── Pure helpers ──────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

/** Render a slice of agent types around the cursor, with ❯ on the selected one. */
function renderAgentSelector(cursor: number, active: boolean): string {
  const SHOW = 4; // agents to show on each side
  const start = Math.max(0, cursor - SHOW);
  const end   = Math.min(AGENT_TYPE_LIST.length - 1, cursor + SHOW);
  const parts: string[] = [];
  if (start > 0) parts.push('…');
  for (let i = start; i <= end; i++) {
    const name = AGENT_TYPE_LIST[i];
    if (i === cursor) {
      parts.push(active ? `❯ ${name}` : name);
    } else {
      parts.push(name);
    }
  }
  if (end < AGENT_TYPE_LIST.length - 1) parts.push('…');
  return parts.join('   ');
}

// ── Component ─────────────────────────────────────────────────────────────────

interface AgentProps { router: RouterApi; }

export function AgentScreen({ router }: AgentProps) {
  // Configure state
  const [taskPrompt,   setTaskPrompt]   = useState('');
  const [agentCursor,  setAgentCursor]  = useState(0);
  const [modelInput,   setModelInput]   = useState('');
  const [configField,  setConfigField]  = useState<ConfigField>('task');

  // Model picker state
  const [models,        setModels]       = useState<ModelEntry[]>([]);
  const [modelCursor,   setModelCursor]  = useState(0);
  const [modelsLoading, setModelsLoading] = useState(true);

  // Execution state
  const [subView,      setSubView]      = useState<'configure' | 'run'>('configure');
  const [agentLabel,   setAgentLabel]   = useState('');
  const [streamLines,  setStreamLines]  = useState<string[]>([]);
  const [snippet,      setSnippet]      = useState('');
  const [runStatus,    setRunStatus]    = useState<RunStatus>('idle');
  const [runError,     setRunError]     = useState('');
  const [result,       setResult]       = useState('');
  const [startedAt,    setStartedAt]    = useState(0);
  const [now,          setNow]          = useState(() => Date.now());

  // Post-completion overlay state
  const [postAction,   setPostAction]   = useState<PostAction>('none');
  const [memNs,        setMemNs]        = useState('');
  const [memKey,       setMemKey]       = useState('');
  const [saveFile,     setSaveFile]     = useState('');
  const [postMsg,      setPostMsg]      = useState('');

  const liveRef = useRef(true);
  useEffect(() => () => { liveRef.current = false; }, []);

  // Fetch available models once on mount
  useEffect(() => {
    let live = true;
    async function fetchModels() {
      try {
        const config = loadConfig();
        const client = await clientManager.getClient();
        const list = await client.listModels() as ModelEntry[];
        await clientManager.shutdown();
        if (!live) return;
        setModels(list);
        const defIdx = list.findIndex(m => m.id === config.defaultModel);
        if (defIdx >= 0) setModelCursor(defIdx);
      } catch { /* non-fatal — fall back to text input */ }
      finally { if (live) setModelsLoading(false); }
    }
    fetchModels();
    return () => { live = false; };
  }, []);

  const agentType = AGENT_TYPE_LIST[agentCursor] as AgentType;

  // Tick every second while running
  useEffect(() => {
    if (runStatus !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [runStatus]);

  const startAgent = useCallback(async () => {
    const label = generateAgentName(agentType);
    setAgentLabel(label);
    setSubView('run');
    const t0 = Date.now();
    setStartedAt(t0);
    setNow(t0);
    setRunStatus('running');

    const resolvedModel = models.length > 0
      ? (models[modelCursor]?.id || undefined)
      : (modelInput.trim() || undefined);

    const res = await runAgentTask(agentType, taskPrompt.trim(), {
      model: resolvedModel,
      onChunk: (chunk: string) => {
        if (!liveRef.current) return;
        setSnippet(prev => {
          const lines = (prev + chunk).split('\n');
          return lines.slice(-2).join(' ').slice(0, 60);
        });
        setStreamLines(prev =>
          [...prev, ...chunk.split('\n').filter(l => l.trim())].slice(-MAX_STREAM),
        );
      },
    });

    if (!liveRef.current) return;
    setResult(res.output);
    if (res.success) {
      setRunStatus('done');
    } else {
      setRunError(res.error ?? 'Agent failed');
      setRunStatus('error');
    }
  }, [agentType, taskPrompt, modelInput, models, modelCursor]);

  useInput((char: string, key: Key) => {
    // ── Post-action overlays ──────────────────────────────────────────────────
    if (postAction === 'memory-ns') {
      if (key.return && memNs.trim())  { setPostAction('memory-key'); return; }
      if (key.escape)                  { setPostAction('none'); return; }
      if (key.backspace || key.delete) { setMemNs(p => p.slice(0, -1)); return; }
      if (char && !key.ctrl && !key.meta) { setMemNs(p => p + char); return; }
      return;
    }
    if (postAction === 'memory-key') {
      if (key.return && memKey.trim()) {
        try {
          getMemoryStore().store(memNs.trim(), memKey.trim(), result, { type: 'fact', importance: 3 });
          setPostMsg(`Saved to memory: ${memNs.trim()}/${memKey.trim()}`);
        } catch (err) {
          setPostMsg(`Memory error: ${err instanceof Error ? err.message : String(err)}`);
        }
        setPostAction('none');
        return;
      }
      if (key.escape)                  { setPostAction('none'); return; }
      if (key.backspace || key.delete) { setMemKey(p => p.slice(0, -1)); return; }
      if (char && !key.ctrl && !key.meta) { setMemKey(p => p + char); return; }
      return;
    }
    if (postAction === 'save-file') {
      if (key.return && saveFile.trim()) {
        try {
          writeFileSync(saveFile.trim(), result, 'utf-8');
          setPostMsg(`Saved to ${saveFile.trim()}`);
        } catch (err) {
          setPostMsg(`Save error: ${err instanceof Error ? err.message : String(err)}`);
        }
        setPostAction('none');
        return;
      }
      if (key.escape)                  { setPostAction('none'); return; }
      if (key.backspace || key.delete) { setSaveFile(p => p.slice(0, -1)); return; }
      if (char && !key.ctrl && !key.meta) { setSaveFile(p => p + char); return; }
      return;
    }

    // ── Run sub-view ──────────────────────────────────────────────────────────
    if (subView === 'run') {
      if (key.escape && runStatus !== 'running') { router.pop(); return; }
      if (runStatus === 'done') {
        if (char === 'm') { setPostAction('memory-ns'); setMemNs(''); setMemKey(''); return; }
        if (char === 's') { setPostAction('save-file'); setSaveFile(''); return; }
      }
      return;
    }

    // ── Configure sub-view ────────────────────────────────────────────────────
    if (configField === 'task') {
      if (key.escape)                     { router.pop(); return; }
      if (key.tab || key.return)          { setConfigField('agent'); return; }
      if (key.backspace || key.delete)    { setTaskPrompt(p => p.slice(0, -1)); return; }
      if (char && !key.ctrl && !key.meta) { setTaskPrompt(p => p + char); return; }
      return;
    }
    if (configField === 'agent') {
      if (key.escape)    { setConfigField('task'); return; }
      if (key.tab || key.return) { setConfigField('model'); return; }
      if (key.leftArrow)  { setAgentCursor(i => (i - 1 + AGENT_TYPE_LIST.length) % AGENT_TYPE_LIST.length); return; }
      if (key.rightArrow) { setAgentCursor(i => (i + 1) % AGENT_TYPE_LIST.length); return; }
      return;
    }
    // model field
    if (key.escape) { setConfigField('agent'); return; }
    if (key.tab)    { setConfigField('task');  return; }
    if (models.length > 0) {
      if (key.upArrow)   { setModelCursor(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setModelCursor(i => Math.min(models.length - 1, i + 1)); return; }
      if (key.return && taskPrompt.trim()) { void startAgent(); return; }
    } else {
      if (key.return && taskPrompt.trim()) { void startAgent(); return; }
      if (key.backspace || key.delete)    { setModelInput(p => p.slice(0, -1)); return; }
      if (char && !key.ctrl && !key.meta) { setModelInput(p => p + char); return; }
    }
  });

  // ── Configure view ────────────────────────────────────────────────────────

  if (subView === 'configure') {
    const canStart = taskPrompt.trim().length > 0;
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>Agent — configure</Text>

        {/* Task */}
        <Box>
          <Text bold color={configField === 'task' ? 'cyan' : undefined}>{'Task      '}</Text>
          <Text dimColor>[</Text>
          <Text>{taskPrompt}</Text>
          {configField === 'task' && <Text color="cyan" bold>▌</Text>}
          <Text dimColor>]</Text>
        </Box>

        {/* Agent selector */}
        <Box>
          <Text bold color={configField === 'agent' ? 'cyan' : undefined}>{'Agent     '}</Text>
          <Text color={configField === 'agent' ? 'cyan' : undefined}>
            {renderAgentSelector(agentCursor, configField === 'agent')}
          </Text>
        </Box>

        {/* Model */}
        <Box flexDirection="column">
          <Text bold color={configField === 'model' ? 'cyan' : undefined}>{'Model'}</Text>
          {modelsLoading && (
            <Text dimColor>  loading models…</Text>
          )}
          {!modelsLoading && models.length > 0 && (() => {
            const SHOW = 3;
            const start = Math.max(0, modelCursor - SHOW);
            const end   = Math.min(models.length - 1, modelCursor + SHOW);
            const rows  = [];
            if (start > 0) rows.push(<Text key="top" dimColor>  …</Text>);
            for (let i = start; i <= end; i++) {
              const active = i === modelCursor;
              const focused = configField === 'model';
              rows.push(
                <Box key={models[i].id}>
                  <Text color={active && focused ? 'cyan' : undefined}>
                    {active ? '  ❯ ' : '    '}
                  </Text>
                  <Text color={active && focused ? 'cyan' : undefined} bold={active && focused}>
                    {models[i].id}
                  </Text>
                </Box>
              );
            }
            if (end < models.length - 1) rows.push(<Text key="bot" dimColor>  …</Text>);
            return <Box flexDirection="column">{rows}</Box>;
          })()}
          {!modelsLoading && models.length === 0 && (
            <Box>
              <Text dimColor>[</Text>
              <Text>{modelInput || (configField === 'model' ? '' : '(default)')}</Text>
              {configField === 'model' && <Text color="cyan" bold>▌</Text>}
              <Text dimColor>]</Text>
            </Box>
          )}
        </Box>

        <Text dimColor>
          {configField === 'task'
            ? '[tab/enter] next field  [esc] back'
            : configField === 'agent'
            ? '[←→] cycle agent  [tab/enter] next  [esc] back'
            : models.length > 0
            ? (canStart ? '[↑↓] pick model  [enter] start  [tab] wrap  [esc] back'
                        : '[↑↓] pick model  [tab] wrap  [esc] back  (type a task first)')
            : (canStart ? '[enter] start  [tab] wrap  [esc] back'
                        : '[type a task first]  [tab] wrap  [esc] back')}
        </Text>
      </Box>
    );
  }

  // ── Run view ──────────────────────────────────────────────────────────────

  const totalMs = startedAt > 0 ? now - startedAt : 0;

  return (
    <Box flexDirection="column" gap={1}>

      {/* Header */}
      <Box justifyContent="space-between">
        <Text bold>Agent — {agentType} — {agentLabel}</Text>
        {startedAt > 0 && <Text dimColor>{fmtMs(totalMs)}</Text>}
      </Box>

      {/* Status line */}
      <Box>
        {runStatus === 'running' && <><Spinner /><Text>{' '}</Text></>}
        {runStatus === 'done'    && <Text color="green">{'✓ '}</Text>}
        {runStatus === 'error'   && <Text color="red">{'✗ '}</Text>}
        <Text dimColor>
          {runStatus === 'running' ? 'running…' + (snippet ? '  ' + snippet : '')
            : runStatus === 'done'  ? 'complete'
            : runStatus === 'error' ? runError
            : ''}
        </Text>
      </Box>

      {/* Stream pane (while running) */}
      {runStatus === 'running' && streamLines.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>{'─── streaming ──────────────────────────────'}</Text>
          {streamLines.map((line, i) => (
            <Text key={i} dimColor>{line.slice(0, 80)}</Text>
          ))}
        </Box>
      )}

      {/* Result preview (when done) */}
      {(runStatus === 'done' || runStatus === 'error') && result && (
        <Box flexDirection="column">
          <Text dimColor>{'─── output ─────────────────────────────────'}</Text>
          {result.split('\n').slice(0, 10).map((line, i) => (
            <Text key={i} dimColor>{line.slice(0, 80)}</Text>
          ))}
          {result.split('\n').length > 10 && (
            <Text dimColor>  … {result.split('\n').length - 10} more lines</Text>
          )}
        </Box>
      )}

      {/* Post-action overlays */}
      {postAction === 'memory-ns' && (
        <Box flexDirection="column" gap={1}>
          <Text bold>Store in memory</Text>
          <Box>
            <Text dimColor>{'Namespace  ['}</Text>
            <Text>{memNs}</Text>
            <Text color="cyan" bold>▌</Text>
            <Text dimColor>]</Text>
          </Box>
          <Text dimColor>[enter] next  [esc] cancel</Text>
        </Box>
      )}
      {postAction === 'memory-key' && (
        <Box flexDirection="column" gap={1}>
          <Text bold>Store in memory</Text>
          <Box><Text dimColor>{'Namespace  '}</Text><Text>{memNs}</Text></Box>
          <Box>
            <Text dimColor>{'Key        ['}</Text>
            <Text>{memKey}</Text>
            <Text color="cyan" bold>▌</Text>
            <Text dimColor>]</Text>
          </Box>
          <Text dimColor>[enter] save  [esc] cancel</Text>
        </Box>
      )}
      {postAction === 'save-file' && (
        <Box flexDirection="column" gap={1}>
          <Text bold>Save output</Text>
          <Box>
            <Text dimColor>{'File  ['}</Text>
            <Text>{saveFile}</Text>
            <Text color="cyan" bold>▌</Text>
            <Text dimColor>]</Text>
          </Box>
          <Text dimColor>[enter] save  [esc] cancel</Text>
        </Box>
      )}

      {/* Post-action feedback message */}
      {postMsg && <Text color="green">{postMsg}</Text>}

      {/* Footer */}
      <Text dimColor>
        {runStatus === 'running'
          ? '[ctrl+c] abort'
          : postAction !== 'none'
          ? ''
          : runStatus === 'done'
          ? '[m] store in memory  [s] save to file  [esc] back'
          : '[esc] back'}
      </Text>

    </Box>
  );
}
