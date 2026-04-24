import { Command } from 'commander';
import { output } from '../output.js';
import type { ScreenName } from '../tui/router.js';

const VALID_SCREENS: ScreenName[] = [
  'home', 'init', 'plan', 'exec', 'swarm',
  'agent', 'memory', 'monitor', 'doctor', 'help', 'telemetry', 'spec',
];

export function registerTui(program: Command): void {
  program
    .command('tui')
    .description('Launch the interactive terminal UI')
    .option(
      '--screen <screen>',
      `Open a specific screen on launch (${VALID_SCREENS.join(', ')})`,
      'home',
    )
    .action(async (opts: { screen: string }) => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        output.error('The TUI requires an interactive terminal (TTY).');
        output.print('Use individual CLI commands for piped / non-interactive output.');
        process.exit(1);
      }

      const screen: ScreenName = (VALID_SCREENS as string[]).includes(opts.screen)
        ? (opts.screen as ScreenName)
        : 'home';

      // The TUI bundle is ESM (ink uses top-level await — require() can't load
      // it).  TypeScript compiles `await import()` to `require()` in CJS mode,
      // so we use `new Function()` to bypass that transformation.
      // On Windows, dynamic import() requires a file:// URL, not a raw path,
      // so we convert with pathToFileURL from Node's built-in 'url' module.
      const { pathToFileURL } = require('url') as typeof import('url');
      const bundleUrl = pathToFileURL(require.resolve('../tui/bundle.mjs')).href;
      type Bundle = { launch: (screen: ScreenName) => Promise<void> };
      const { launch } = await (new Function('p', 'return import(p)')(bundleUrl) as Promise<Bundle>);
      await launch(screen);
    });
}
