import { useState, useMemo } from 'react';
import { Box, Text, useInput, useWindowSize, useApp, type Key } from 'ink';
import { marked } from 'marked';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { markedTerminal } from 'marked-terminal';
import type { RouterApi } from '../router.js';

// Configure marked-terminal once for this ESM bundle
// eslint-disable-next-line @typescript-eslint/no-explicit-any
marked.use(markedTerminal() as any);

interface SpecProps {
  router: RouterApi;
}

export function SpecScreen({ router }: SpecProps) {
  const { exit }          = useApp();
  const { columns, rows } = useWindowSize();

  const routerArgs = router.current.args?.args as string[] | undefined;
  const initText   = routerArgs ? routerArgs.join(' ') : '';

  const [lines, setLines]         = useState<string[]>(
    initText ? initText.split('\n') : [''],
  );
  const [cursor, setCursor]       = useState({ ln: 0, col: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  const editorWidth  = Math.max(20, Math.floor(columns * 0.58));
  const previewWidth = Math.max(10, columns - editorWidth - 4);
  const editorHeight = Math.max(5, rows - 8);

  /** Keep cursor line within the viewport. */
  const adjustScroll = (newLn: number, prevTop: number): number => {
    if (newLn < prevTop) return newLn;
    if (newLn >= prevTop + editorHeight) return newLn - editorHeight + 1;
    return prevTop;
  };

  /** Live markdown preview — recomputed on every edit. */
  const preview = useMemo(() => {
    try { return marked(lines.join('\n')) as string; }
    catch { return lines.join('\n'); }
  }, [lines]);

  useInput((char: string, key: Key) => {
    // Quit
    if (key.ctrl && char === 'c') { exit(); return; }

    // Ctrl+P — proceed to plan with current spec
    if (key.ctrl && char === 'p') {
      router.push('plan', { args: [lines.join('\n')] });
      return;
    }

    // Cursor navigation
    if (key.upArrow) {
      const newLn  = Math.max(0, cursor.ln - 1);
      const newCol = Math.min(cursor.col, (lines[newLn] ?? '').length);
      setCursor({ ln: newLn, col: newCol });
      setScrollTop(s => adjustScroll(newLn, s));
      return;
    }
    if (key.downArrow) {
      const newLn  = Math.min(lines.length - 1, cursor.ln + 1);
      const newCol = Math.min(cursor.col, (lines[newLn] ?? '').length);
      setCursor({ ln: newLn, col: newCol });
      setScrollTop(s => adjustScroll(newLn, s));
      return;
    }
    if (key.leftArrow) {
      if (cursor.col > 0) {
        setCursor(c => ({ ...c, col: c.col - 1 }));
      } else if (cursor.ln > 0) {
        const newLn  = cursor.ln - 1;
        const newCol = (lines[newLn] ?? '').length;
        setCursor({ ln: newLn, col: newCol });
        setScrollTop(s => adjustScroll(newLn, s));
      }
      return;
    }
    if (key.rightArrow) {
      const lineLen = (lines[cursor.ln] ?? '').length;
      if (cursor.col < lineLen) {
        setCursor(c => ({ ...c, col: c.col + 1 }));
      } else if (cursor.ln < lines.length - 1) {
        const newLn = cursor.ln + 1;
        setCursor({ ln: newLn, col: 0 });
        setScrollTop(s => adjustScroll(newLn, s));
      }
      return;
    }

    // Enter — split line at cursor
    if (key.return) {
      const line   = lines[cursor.ln] ?? '';
      const before = line.slice(0, cursor.col);
      const after  = line.slice(cursor.col);
      setLines(prev => {
        const next = [...prev];
        next.splice(cursor.ln, 1, before, after);
        return next;
      });
      const newLn = cursor.ln + 1;
      setCursor({ ln: newLn, col: 0 });
      setScrollTop(s => adjustScroll(newLn, s));
      return;
    }

    // Backspace — delete char or merge lines
    if (key.backspace || key.delete) {
      if (cursor.col > 0) {
        const line = lines[cursor.ln] ?? '';
        setLines(prev => {
          const next    = [...prev];
          next[cursor.ln] = line.slice(0, cursor.col - 1) + line.slice(cursor.col);
          return next;
        });
        setCursor(c => ({ ...c, col: c.col - 1 }));
      } else if (cursor.ln > 0) {
        const prevLine = lines[cursor.ln - 1] ?? '';
        const currLine = lines[cursor.ln] ?? '';
        const newCol   = prevLine.length;
        const newLn    = cursor.ln - 1;
        setLines(prev => {
          const next = [...prev];
          next.splice(cursor.ln - 1, 2, prevLine + currLine);
          return next;
        });
        setCursor({ ln: newLn, col: newCol });
        setScrollTop(s => adjustScroll(newLn, s));
      }
      return;
    }

    // Printable character — insert at cursor
    if (char && !key.ctrl && !key.meta) {
      const line = lines[cursor.ln] ?? '';
      setLines(prev => {
        const next    = [...prev];
        next[cursor.ln] = line.slice(0, cursor.col) + char + line.slice(cursor.col);
        return next;
      });
      setCursor(c => ({ ...c, col: c.col + 1 }));
    }
  });

  // Viewport: only render lines visible in the editor pane
  const visibleLines = lines.slice(scrollTop, scrollTop + editorHeight);

  /** Render one editor line, injecting the block cursor on the active line. */
  const renderLine = (line: string, absIdx: number) => {
    if (absIdx !== cursor.ln) {
      return (
        <Box key={absIdx}>
          <Text>{line !== '' ? line : ' '}</Text>
        </Box>
      );
    }
    const before     = line.slice(0, cursor.col);
    const cursorChar = line[cursor.col] ?? ' ';
    const after      = line.slice(cursor.col + 1);
    return (
      <Box key={absIdx} flexDirection="row">
        {before.length > 0 && <Text>{before}</Text>}
        <Text inverse>{cursorChar}</Text>
        {after.length > 0 && <Text>{after}</Text>}
      </Box>
    );
  };

  return (
    <Box flexDirection="column">

      {/* Split panes */}
      <Box flexDirection="row">

        {/* Left — editor */}
        <Box
          flexDirection="column"
          width={editorWidth}
          borderStyle="single"
          borderColor="cyan"
          paddingX={1}
        >
          <Text bold color="cyan">Spec (markdown)</Text>
          <Box flexDirection="column" marginTop={1}>
            {visibleLines.map((line, i) => renderLine(line, i + scrollTop))}
          </Box>
        </Box>

        {/* Right — live preview */}
        <Box
          flexDirection="column"
          width={previewWidth}
          borderStyle="single"
          borderColor="green"
          paddingX={1}
          marginLeft={1}
        >
          <Text bold color="green">Preview</Text>
          <Box marginTop={1}>
            <Text wrap="wrap">{preview}</Text>
          </Box>
        </Box>

      </Box>

      {/* Status bar */}
      <Box marginTop={1}>
        <Text dimColor>
          {`Ln ${cursor.ln + 1}  Col ${cursor.col + 1}  |  Ctrl+P → generate plan  |  Esc → back  |  Ctrl+C → quit`}
        </Text>
      </Box>

    </Box>
  );
}
