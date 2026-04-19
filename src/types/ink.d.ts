/**
 * Ambient module declaration for `ink`.
 *
 * ink v7 ships only an `exports` field in package.json (no top-level `main`
 * or `types`).  TypeScript's `"moduleResolution": "node"` does not read
 * `exports`, so the types cannot be resolved automatically.
 *
 * NOTE: This file must NOT have any top-level import/export statements —
 * that would make TypeScript treat it as a module augmentation (which requires
 * the module to already resolve) rather than an ambient declaration (which
 * overrides resolution entirely).
 */

declare module 'ink' {
  // ── Keyboard ─────────────────────────────────────────────────────────────

  interface Key {
    upArrow: boolean;
    downArrow: boolean;
    leftArrow: boolean;
    rightArrow: boolean;
    pageDown: boolean;
    pageUp: boolean;
    home: boolean;
    end: boolean;
    return: boolean;
    escape: boolean;
    ctrl: boolean;
    shift: boolean;
    tab: boolean;
    backspace: boolean;
    delete: boolean;
    meta: boolean;
    super: boolean;
    hyper: boolean;
    capsLock: boolean;
    numLock: boolean;
    eventType?: 'press' | 'repeat' | 'release';
  }

  // ── Layout ───────────────────────────────────────────────────────────────

  interface BoxProps {
    children?: import('react').ReactNode;
    flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
    flexGrow?: number;
    flexShrink?: number;
    flexBasis?: number | string;
    flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
    alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline';
    alignSelf?: 'auto' | 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline';
    justifyContent?:
      | 'flex-start'
      | 'flex-end'
      | 'center'
      | 'space-between'
      | 'space-around'
      | 'space-evenly';
    width?: number | string;
    height?: number | string;
    minWidth?: number | string;
    minHeight?: number | string;
    maxWidth?: number | string;
    maxHeight?: number | string;
    margin?: number;
    marginX?: number;
    marginY?: number;
    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
    padding?: number;
    paddingX?: number;
    paddingY?: number;
    paddingTop?: number;
    paddingBottom?: number;
    paddingLeft?: number;
    paddingRight?: number;
    gap?: number;
    columnGap?: number;
    rowGap?: number;
    borderStyle?:
      | 'single'
      | 'double'
      | 'round'
      | 'bold'
      | 'singleDouble'
      | 'doubleSingle'
      | 'classic'
      | 'arrow'
      | string;
    borderTop?: boolean;
    borderBottom?: boolean;
    borderLeft?: boolean;
    borderRight?: boolean;
    borderColor?: string;
    display?: 'flex' | 'none';
    overflowX?: 'visible' | 'hidden';
    overflowY?: 'visible' | 'hidden';
    position?: 'absolute' | 'relative' | 'static';
    top?: number | string;
    right?: number | string;
    bottom?: number | string;
    left?: number | string;
    key?: string | number;
  }

  // ── Text ─────────────────────────────────────────────────────────────────

  interface TextProps {
    children?: import('react').ReactNode;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    inverse?: boolean;
    color?: string;
    backgroundColor?: string;
    dimColor?: boolean;
    wrap?: 'wrap' | 'truncate' | 'truncate-start' | 'truncate-middle' | 'truncate-end';
    key?: string | number;
  }

  // ── Components ───────────────────────────────────────────────────────────

  const Box: import('react').FC<BoxProps>;
  const Text: import('react').FC<TextProps>;

  // ── Hooks ────────────────────────────────────────────────────────────────

  function useInput(
    handler: (input: string, key: Key) => void,
    options?: { isActive?: boolean },
  ): void;

  function useApp(): {
    exit: (error?: Error) => void;
    waitUntilRenderFlush: () => Promise<void>;
  };

  interface WindowSize {
    readonly columns: number;
    readonly rows: number;
  }

  function useWindowSize(): WindowSize;

  // ── Render ───────────────────────────────────────────────────────────────

  interface RenderOptions {
    stdout?: NodeJS.WriteStream;
    stdin?: NodeJS.ReadStream;
    stderr?: NodeJS.WriteStream;
    debug?: boolean;
    exitOnCtrlC?: boolean;
    patchConsole?: boolean;
    alternateScreen?: boolean;
    concurrent?: boolean;
  }

  interface Instance {
    rerender: (node: import('react').ReactNode) => void;
    unmount: () => void;
    waitUntilExit: () => Promise<void>;
    waitUntilRenderFlush: () => Promise<void>;
    cleanup: () => void;
    clear: () => void;
  }

  function render(
    node: import('react').ReactNode,
    options?: NodeJS.WriteStream | RenderOptions,
  ): Instance;

  // Re-export types so consumers can use `import type { Key } from 'ink'` etc.
  export { Key, BoxProps, TextProps, WindowSize, RenderOptions, Instance, Box, Text };
  export { useInput, useApp, useWindowSize, render };
}
