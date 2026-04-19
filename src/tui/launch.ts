/**
 * TUI launcher — esbuild entry point.
 *
 * This file (and all TUI files it imports) are compiled by esbuild into an
 * ESM bundle at `dist/tui/bundle.mjs`.  The rest of the project is compiled
 * by TypeScript to CJS.  The two compilation contexts never mix: tui.ts
 * loads this bundle via a real dynamic import() (using new Function() so
 * TypeScript doesn't transpile it to require()).
 */

import { createElement } from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { setLogLevel } from '../output.js';
import type { ScreenName } from './router.js';

export async function launch(initialScreen: ScreenName): Promise<void> {
  // Suppress all console output from the package so ink's rendering is not
  // interrupted by chalk/ora writes from runAgentTask, runSwarm, etc.
  setLogLevel('silent');

  const { waitUntilExit } = render(
    createElement(App, { initialScreen }),
  );
  await waitUntilExit();
}
