import { Box, Text } from 'ink';

export interface KeyHint {
  key: string;
  label: string;
}

interface StatusBarProps {
  hints: KeyHint[];
}

/** Bottom strip showing keyboard shortcuts. */
export function StatusBar({ hints }: StatusBarProps) {
  return (
    <Box>
      {hints.map((h, i) => (
        <Box key={i} marginRight={2}>
          <Text bold color="cyan">[{h.key}]</Text>
          <Text dimColor> {h.label}</Text>
        </Box>
      ))}
    </Box>
  );
}
