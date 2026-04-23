import { useApp, useInput, useWindowSize, Box, Text, type Key } from 'ink';
import { useRouter, ScreenName } from './router.js';
import { Shell } from './shell.js';
import { HomeScreen } from './screens/home.js';
import { DoctorScreen } from './screens/doctor.js';
import { ExecScreen } from './screens/exec.js';
import { MemoryScreen } from './screens/memory.js';
import { SwarmScreen } from './screens/swarm.js';
import { PlaceholderScreen } from './screens/placeholder.js';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../../package.json') as { version: string };

interface AppProps {
  initialScreen?: ScreenName;
}

export function App({ initialScreen = 'home' }: AppProps) {
  const { exit }     = useApp();
  const { columns }  = useWindowSize();
  const router       = useRouter(initialScreen);
  const { current }  = router;

  // Global: Escape pops the stack
  useInput((_char: string, key: Key) => {
    if (key.escape && router.canPop) router.pop();
  });

  const handleNavigate = (screen: ScreenName, args: string[]) =>
    router.push(screen, args.length > 0 ? { args } : undefined);

  const divider = '─'.repeat(Math.max(1, columns));

  const renderScreen = () => {
    switch (current.screen) {
      case 'home':    return <HomeScreen router={router} />;
      case 'doctor':  return <DoctorScreen router={router} />;
      case 'exec':    return <ExecScreen router={router} />;
      case 'memory':  return <MemoryScreen router={router} />;
      case 'swarm':   return <SwarmScreen router={router} />;
      default:        return <PlaceholderScreen screen={current.screen} router={router} />;
    }
  };

  // Breadcrumb trail: home > memory
  const breadcrumb = current.screen !== 'home'
    ? `home > ${current.screen}`
    : 'home';

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box justifyContent="space-between" paddingX={1}>
        <Text bold color="cyan">copilot-flow</Text>
        <Text dimColor>{breadcrumb}  v{version}</Text>
      </Box>

      <Text dimColor>{divider}</Text>

      {/* Main viewport */}
      <Box paddingX={2} paddingTop={1} paddingBottom={1} flexDirection="column">
        {renderScreen()}
      </Box>

      <Text dimColor>{divider}</Text>

      {/* Shell input bar */}
      <Shell
        onNavigate={handleNavigate}
        onPop={router.pop}
        canPop={router.canPop}
        onQuit={() => exit()}
      />
    </Box>
  );
}
