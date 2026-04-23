import { Box, Text } from 'ink';

interface StreamPaneProps {
  lines: string[];
  /** Number of visible rows (viewport height). */
  height?: number;
  title?: string;
}

/**
 * Append-only sticky-scroll text pane.
 * Shows the last `height` lines; older lines scroll off the top.
 */
export function StreamPane({ lines, height = 8, title }: StreamPaneProps) {
  const visible = lines.slice(-height);
  const padding = height - visible.length;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      {title != null && <Text bold dimColor>{title}</Text>}
      {Array.from({ length: padding }).map((_, i) => (
        <Text key={`pad-${i}`}> </Text>
      ))}
      {visible.map((line, i) => (
        <Text key={i} wrap="truncate-end">{line || ' '}</Text>
      ))}
    </Box>
  );
}
