import { Text } from 'ink';
import { importanceStars } from '../theme.js';

interface ImportanceStarsProps {
  /** 1–5 */
  value: number;
}

/** Renders ★★★☆☆ for a 1–5 importance score. */
export function ImportanceStars({ value }: ImportanceStarsProps) {
  return <Text color="yellow">{importanceStars(value)}</Text>;
}
