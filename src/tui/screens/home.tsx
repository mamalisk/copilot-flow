import { Box, Text } from 'ink';
import type { RouterApi } from '../router.js';

const COMMANDS: [string, string][] = [
  ['/plan <spec>',  'Generate and review a phase plan'],
  ['/exec <plan>',  'Execute a plan with live phase dashboard'],
  ['/swarm',        'Configure and monitor a multi-agent swarm'],
  ['/agent',        'Run a single agent task with streaming output'],
  ['/memory',       'Browse and manage stored facts'],
  ['/spec',         'Write and preview a spec, then generate a plan'],
  ['/telemetry',    'Run metrics and agent performance dashboard'],
  ['/monitor',      'Live agent activity feed'],
  ['/doctor',       'System health check and model picker'],
  ['/init',         'Guided setup wizard'],
  ['/help',         'Show all keybindings'],
];

interface HomeProps {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  router: RouterApi;
}

export function HomeScreen({ router: _router }: HomeProps) {
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text dimColor>Adaptive multi-agent orchestration — getting smarter with every run.</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Available screens</Text>
        <Box flexDirection="column" marginTop={1}>
          {COMMANDS.map(([cmd, desc]) => (
            <Box key={cmd}>
              <Text color="cyan">{cmd.padEnd(22)}</Text>
              <Text dimColor>{desc}</Text>
            </Box>
          ))}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Type a slash command in the input bar below to navigate.</Text>
      </Box>
    </Box>
  );
}
