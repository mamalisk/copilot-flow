import { useState, useEffect } from 'react';
import { Text } from 'ink';

// Matches Claude Code's spinner frames exactly — ping-pong through the sequence
// so the animation breathes forward then back (· → ✢ → * → ✶ → ✻ → ✽ → ✻ → …)
const BASE = process.platform === 'darwin'
  ? ['·', '✢', '✳', '✶', '✻', '✽']
  : ['·', '✢', '*', '✶', '✻', '✽'];

const FRAMES = [...BASE, ...[...BASE].reverse()];
const INTERVAL_MS = 120;

interface SpinnerProps {
  color?: string;
}

export function Spinner({ color = 'cyan' }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % FRAMES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return <Text color={color}>{FRAMES[frame]}</Text>;
}
