import { useState, useCallback } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { SCREEN_COMMANDS, ScreenName } from './router.js';

interface ShellProps {
  onNavigate: (screen: ScreenName, args: string[]) => void;
  onPop: () => void;
  canPop: boolean;
  onQuit: () => void;
}

const HINTS = '[tab] complete  [↑↓] history  [esc] back  [ctrl+c] quit';

/**
 * Persistent bottom input bar.
 * Accepts /command [args] and dispatches to the router.
 */
export function Shell({ onNavigate, onPop, canPop, onQuit }: ShellProps) {
  const [input, setInput]       = useState('');
  const [history, setHistory]   = useState<string[]>([]);
  const [histIdx, setHistIdx]   = useState(-1);

  const submit = useCallback((raw: string) => {
    const cmd = raw.trim();
    if (!cmd) return;

    setHistory(prev => [cmd, ...prev].slice(0, 50));
    setHistIdx(-1);

    if (!cmd.startsWith('/')) return;

    const parts  = cmd.slice(1).split(/\s+/);
    const name   = parts[0].toLowerCase();
    const args   = parts.slice(1);

    if (name === 'back') { onPop(); return; }
    if (name === 'quit' || name === 'q') { onQuit(); return; }

    const screen = SCREEN_COMMANDS[name];
    if (screen) onNavigate(screen, args);
  }, [onNavigate, onPop, onQuit]);

  useInput((char: string, key: Key) => {
    if (key.ctrl && char === 'c') { onQuit(); return; }

    if (key.return) {
      submit(input);
      setInput('');
      return;
    }

    if (key.escape) {
      if (input) { setInput(''); setHistIdx(-1); }
      else if (canPop) onPop();
      return;
    }

    if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1));
      setHistIdx(-1);
      return;
    }

    if (key.upArrow) {
      const next = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(next);
      if (history[next] != null) setInput(history[next]);
      return;
    }

    if (key.downArrow) {
      const next = histIdx - 1;
      if (next < 0) { setHistIdx(-1); setInput(''); return; }
      setHistIdx(next);
      if (history[next] != null) setInput(history[next]);
      return;
    }

    // Tab: complete /command prefix
    if (key.tab && input.startsWith('/')) {
      const partial = input.slice(1).toLowerCase();
      const match = Object.keys(SCREEN_COMMANDS).find(k => k.startsWith(partial));
      if (match) setInput(`/${match} `);
      return;
    }

    if (char && !key.ctrl && !key.meta) {
      setInput(prev => prev + char);
      setHistIdx(-1);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold color="cyan">{'> '}</Text>
        <Text>{input}</Text>
        <Text color="cyan" bold>{'▌'}</Text>
      </Box>
      <Text dimColor>{HINTS}</Text>
    </Box>
  );
}
