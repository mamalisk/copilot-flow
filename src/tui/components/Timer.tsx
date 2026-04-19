import { useState, useEffect } from 'react';
import { Text } from 'ink';

interface TimerProps {
  startedAt: number;
  stopped?: boolean;
  stoppedAt?: number;
}

function format(ms: number): string {
  const mm = String(Math.floor(ms / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((ms % 60_000) / 1_000)).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** Live mm:ss elapsed counter. Freezes when stopped=true. */
export function Timer({ startedAt, stopped, stoppedAt }: TimerProps) {
  const [elapsed, setElapsed] = useState(
    stopped ? (stoppedAt ?? Date.now()) - startedAt : Date.now() - startedAt,
  );

  useEffect(() => {
    if (stopped) return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 1_000);
    return () => clearInterval(id);
  }, [startedAt, stopped]);

  return <Text dimColor>{format(elapsed)}</Text>;
}
