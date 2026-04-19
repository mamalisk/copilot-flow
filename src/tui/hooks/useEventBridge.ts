import { useEffect } from 'react';
import type { EventEmitter } from 'events';

/**
 * Subscribe to a Node.js EventEmitter event inside a React/Ink component.
 * Automatically removes the listener on unmount.
 */
export function useEventBridge(
  emitter: EventEmitter,
  event: string,
  handler: (...args: unknown[]) => void,
): void {
  useEffect(() => {
    emitter.on(event, handler);
    return () => { emitter.off(event, handler); };
  }, [emitter, event, handler]);
}
