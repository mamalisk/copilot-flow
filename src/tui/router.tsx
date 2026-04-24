import { useReducer, useCallback } from 'react';

export type ScreenName =
  | 'home'
  | 'init'
  | 'plan'
  | 'exec'
  | 'swarm'
  | 'agent'
  | 'memory'
  | 'monitor'
  | 'doctor'
  | 'help'
  | 'telemetry'
  | 'spec';

export interface ScreenEntry {
  screen: ScreenName;
  args?: Record<string, unknown>;
}

interface RouterState {
  stack: ScreenEntry[];
}

type RouterAction =
  | { type: 'push'; screen: ScreenName; args?: Record<string, unknown> }
  | { type: 'pop' };

function reducer(state: RouterState, action: RouterAction): RouterState {
  switch (action.type) {
    case 'push':
      return { stack: [...state.stack, { screen: action.screen, args: action.args }] };
    case 'pop':
      return state.stack.length <= 1
        ? state
        : { stack: state.stack.slice(0, -1) };
    default:
      return state;
  }
}

export interface RouterApi {
  current: ScreenEntry;
  push: (screen: ScreenName, args?: Record<string, unknown>) => void;
  pop: () => void;
  canPop: boolean;
}

export function useRouter(initial: ScreenName = 'home'): RouterApi {
  const [state, dispatch] = useReducer(reducer, { stack: [{ screen: initial }] });

  const push = useCallback(
    (screen: ScreenName, args?: Record<string, unknown>) =>
      dispatch({ type: 'push', screen, args }),
    [],
  );

  const pop = useCallback(() => dispatch({ type: 'pop' }), []);

  return {
    current: state.stack[state.stack.length - 1],
    push,
    pop,
    canPop: state.stack.length > 1,
  };
}

/** Maps slash-command names to ScreenName values. */
export const SCREEN_COMMANDS: Partial<Record<string, ScreenName>> = {
  home:      'home',
  init:      'init',
  plan:      'plan',
  exec:      'exec',
  swarm:     'swarm',
  agent:     'agent',
  memory:    'memory',
  monitor:   'monitor',
  doctor:    'doctor',
  help:      'help',
  telemetry: 'telemetry',
  spec:      'spec',
};
