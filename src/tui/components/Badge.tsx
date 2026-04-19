import { Text } from 'ink';
import { agentColor } from '../theme.js';

interface BadgeProps {
  type: string;
}

/** Coloured agent-type chip, e.g. [coder] in blue. */
export function Badge({ type }: BadgeProps) {
  return <Text color={agentColor(type)}>[{type}]</Text>;
}
