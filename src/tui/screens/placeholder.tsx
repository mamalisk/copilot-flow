import { Box, Text } from 'ink';
import type { RouterApi, ScreenName } from '../router.js';

interface PlaceholderProps {
  screen: ScreenName;
  router: RouterApi;
}

/**
 * Temporary stand-in for screens not yet implemented.
 * Replaced screen-by-screen as each phase ships.
 */
export function PlaceholderScreen({ screen, router: _router }: PlaceholderProps) {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color="cyan">/{screen}</Text>
      <Text>This screen is coming in a future implementation phase.</Text>
      <Text dimColor>Type /back or press [esc] to return to the previous screen.</Text>
    </Box>
  );
}
