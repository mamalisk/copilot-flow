import { Box, Text } from 'ink';

interface Phase {
  id: string;
  dependsOn?: string[];
}

interface PhaseGraphProps {
  phases: Phase[];
}

/** One-liner phase dependency summary: research → [design + spec] → implement */
export function PhaseGraph({ phases }: PhaseGraphProps) {
  const waves = buildWaves(phases);
  const parts = waves.map(wave =>
    wave.length > 1 ? `[${wave.join(' + ')}]` : wave[0],
  );

  return (
    <Box>
      <Text dimColor>{parts.join(' → ')}</Text>
    </Box>
  );
}

function buildWaves(phases: Phase[]): string[][] {
  const waves: string[][] = [];
  const done = new Set<string>();
  let remaining = [...phases];

  while (remaining.length > 0) {
    const wave = remaining.filter(
      p => !p.dependsOn || p.dependsOn.every(d => done.has(d)),
    );
    if (wave.length === 0) break; // cycle / deadlock guard
    waves.push(wave.map(p => p.id));
    wave.forEach(p => done.add(p.id));
    remaining = remaining.filter(p => !done.has(p.id));
  }

  return waves;
}
