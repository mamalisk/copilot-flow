/**
 * ESM build script for the TUI bundle.
 *
 * The TUI imports ink, which uses top-level await and is ESM-only.
 * We bundle it with esbuild into dist/tui/bundle.mjs (ESM) so it can be
 * loaded via a real dynamic import() from the CJS entry point.
 *
 * react-devtools-core is an optional ink dependency designed for browser
 * environments (it references `self`).  We stub it out with a no-op export
 * so it never gets loaded in Node.js.
 */

import { build } from 'esbuild';

await build({
  entryPoints: ['src/tui/launch.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/tui/bundle.mjs',
  // CJS packages bundled into ESM output can call require() for Node.js
  // built-ins (assert, path, etc.) inside function bodies — esbuild can't
  // hoist those to static imports, so it wraps them with a __require shim.
  // In ESM, 'require' is not a global, so the shim throws.  This banner
  // injects a real require via createRequire so those calls work.
  // CJS packages bundled into ESM output call require() for Node.js built-ins
  // inside function bodies.  esbuild wraps those with a __require shim that
  // checks `typeof require !== "undefined"`.  In ESM, require is not a global,
  // so the shim throws.  The banner injects a real require() at the top of the
  // bundle.  We alias the import to __createRequire__ to avoid colliding with
  // esbuild's own `import { createRequire } from "node:module"` emission.
  banner: {
    js: [
      `import { createRequire as __createRequire__ } from 'module';`,
      `const require = __createRequire__(import.meta.url);`,
    ].join('\n'),
  },
  plugins: [stubReactDevtools()],
});

/** Replace react-devtools-core with a no-op so browser globals aren't hit. */
function stubReactDevtools() {
  return {
    name: 'stub-react-devtools-core',
    setup(build) {
      build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
        path: 'react-devtools-core',
        namespace: 'stub',
      }));
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'export default null;',
        loader: 'js',
      }));
    },
  };
}
