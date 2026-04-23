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

/** All navigable slash-command names, in display order. */
const ALL_COMMANDS = Object.keys(SCREEN_COMMANDS) as string[];

/** Names that are valid but not screens (suppress "invalid" colouring). */
const META_COMMANDS = new Set(['back', 'quit', 'q']);

/**
 * Persistent bottom input bar.
 * Accepts /command [args] and dispatches to the router.
 */
export function Shell({ onNavigate, onPop, canPop, onQuit }: ShellProps) {
  const [input, setInput]     = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

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

    // History navigation — only when shell already has input (avoids hijacking
    // screen arrow-key navigation while the prompt is idle).
    if (key.upArrow) {
      if (input.length > 0) {
        const next = Math.min(histIdx + 1, history.length - 1);
        setHistIdx(next);
        if (history[next] != null) setInput(history[next]);
      }
      return;
    }

    if (key.downArrow) {
      if (input.length > 0) {
        const next = histIdx - 1;
        if (next < 0) { setHistIdx(-1); setInput(''); return; }
        setHistIdx(next);
        if (history[next] != null) setInput(history[next]);
      }
      return;
    }

    // Tab: complete /command prefix
    if (key.tab && input.startsWith('/')) {
      const partial = input.slice(1).toLowerCase();
      const match = ALL_COMMANDS.find(k => k.startsWith(partial));
      if (match) setInput(`/${match} `);
      return;
    }

    // Character capture — only accumulate when already in command-entry mode
    // OR the user explicitly starts a command with '/'.  This prevents screen
    // shortcuts (d, n, m, s, …) from leaking into the shell prompt.
    if (char && !key.ctrl && !key.meta) {
      if (input.length > 0 || char === '/') {
        setInput(prev => prev + char);
        setHistIdx(-1);
      }
    }
  });

  // ── Derived display state ────────────────────────────────────────────────

  // Show suggestions when typing a /command (before the first space)
  const inCommandPhase = input.startsWith('/') && !input.includes(' ');
  const partial        = inCommandPhase ? input.slice(1).toLowerCase() : '';

  // Parse input into styled parts: /command + args
  const slashMatch  = /^(\/[a-z-]*)(.*)$/.exec(input);
  const cmdPart     = slashMatch ? slashMatch[1] : '';           // e.g. '/exec'
  const restPart    = slashMatch ? slashMatch[2] : input;        // e.g. ' plan.yaml'
  const cmdName     = cmdPart.slice(1).toLowerCase();
  const isValidCmd  = cmdName.length > 0 &&
    (cmdName in SCREEN_COMMANDS || META_COMMANDS.has(cmdName));

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" paddingX={1}>

      {/* Autocomplete suggestions — shown while typing /command */}
      {inCommandPhase && (
        <Box gap={2}>
          {ALL_COMMANDS.map(cmd => {
            const matches = partial === '' || cmd.startsWith(partial);
            return (
              <Text
                key={cmd}
                bold={matches}
                color={matches ? 'cyan' : undefined}
                dimColor={!matches}
              >
                {'/'}{cmd}
              </Text>
            );
          })}
        </Box>
      )}

      {/* Input line */}
      <Box>
        <Text bold color="cyan">{'> '}</Text>
        {/* /command part — bold cyan when recognized */}
        <Text bold={isValidCmd} color={isValidCmd ? 'cyan' : undefined}>{cmdPart}</Text>
        {/* args / plain text part */}
        <Text>{restPart}</Text>
        <Text color="cyan" bold>{'▌'}</Text>
      </Box>

      <Text dimColor>{HINTS}</Text>
    </Box>
  );
}
