import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

interface PanelProps {
  title?: string;
  children: ReactNode;
  width?: number | string;
  borderColor?: string;
}

/** A rounded-border panel with an optional title row. */
export function Panel({ title, children, width, borderColor = 'gray' }: PanelProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      width={width}
      paddingX={1}
    >
      {title != null && (
        <Text bold color="cyan"> {title} </Text>
      )}
      {children}
    </Box>
  );
}
