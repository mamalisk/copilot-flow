import { Box, Text } from 'ink';
import { barColor } from '../theme.js';

interface HBarProps {
  /** 0–100 */
  value: number;
  width?: number;
  label?: string;
  showPct?: boolean;
}

/** Unicode gradient progress bar: █████░░░░░ */
export function HBar({ value, width = 20, label, showPct = true }: HBarProps) {
  const pct    = Math.max(0, Math.min(100, value));
  const ratio  = pct / 100;
  const filled = Math.round(ratio * width);
  const bar    = '█'.repeat(filled) + '░'.repeat(width - filled);
  const color  = barColor(ratio);

  return (
    <Box>
      {label != null && <Text>{label} </Text>}
      <Text color={color}>{bar}</Text>
      {showPct && <Text dimColor> {pct}%</Text>}
    </Box>
  );
}
