import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { execSync } from 'child_process';
import { isInitialised, loadConfig, saveConfig } from '../../config.js';
import { clientManager } from '../../core/client-manager.js';
import type { RouterApi } from '../router.js';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

interface ModelEntry {
  id: string;
  name: string;
}

interface DoctorProps {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  router: RouterApi;
}

export function DoctorScreen({ router: _router }: DoctorProps) {
  const [checks, setChecks]                   = useState<Check[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [models, setModels]                   = useState<ModelEntry[]>([]);
  const [configuredDefault, setConfiguredDefault] = useState('');
  const [selectedIdx, setSelectedIdx]         = useState(0);
  const [saved, setSaved]                     = useState(false);

  const pushCheck = useCallback((check: Check, prev: Check[]) => {
    const next = [...prev, check];
    setChecks(next);
    return next;
  }, []);

  useEffect(() => {
    let live = true;

    async function run() {
      let acc: Check[] = [];

      // ── Node.js version ─────────────────────────────────────────────────
      const ver = process.version;
      const [major, minor] = ver.slice(1).split('.').map(Number);
      const nodeOk = major > 22 || (major === 22 && minor >= 5);
      acc = pushCheck({ name: 'Node.js >= 22.5', ok: nodeOk, detail: ver }, acc);

      // ── copilot CLI installed ────────────────────────────────────────────
      let cliVersion = '';
      let cliOk = false;
      try {
        cliVersion = execSync('copilot version', { stdio: 'pipe' }).toString().trim();
        cliOk = true;
      } catch {
        try {
          cliVersion = execSync('gh copilot --version', { stdio: 'pipe' }).toString().trim();
          cliOk = true;
        } catch { /* not found */ }
      }
      acc = pushCheck({
        name: 'copilot CLI installed',
        ok: cliOk,
        detail: cliOk ? cliVersion : 'Not found — install from github.com/github/copilot',
      }, acc);

      // ── copilot authenticated ────────────────────────────────────────────
      let sdkOk = false;
      let sdkDetail = 'Skipped (copilot CLI not found)';
      if (cliOk) {
        try {
          sdkOk = await clientManager.ping();
          await clientManager.shutdown();
          sdkDetail = 'OK';
        } catch (err) {
          const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
          sdkDetail = msg.includes('auth') || msg.includes('session was not created')
            ? 'Not authenticated — run: copilot login'
            : `Failed — ${(err instanceof Error ? err.message : '').slice(0, 50)}`;
        }
      }
      acc = pushCheck({ name: 'copilot authenticated', ok: sdkOk, detail: sdkDetail }, acc);

      // ── copilot-flow initialised ─────────────────────────────────────────
      const initOk = isInitialised();
      acc = pushCheck({
        name: 'copilot-flow initialised',
        ok: initOk,
        detail: initOk ? '.copilot-flow/config.json found' : 'Run: copilot-flow init',
      }, acc);

      // ── node:sqlite available ────────────────────────────────────────────
      let sqliteOk = false;
      try { require('node:sqlite'); sqliteOk = true; } catch { /* unavailable */ }
      acc = pushCheck({
        name: 'node:sqlite available',
        ok: sqliteOk,
        detail: sqliteOk ? 'OK' : `Requires Node >= 22.5 (current: ${ver})`,
      }, acc);

      if (!live) return;
      setLoading(false);

      // ── Fetch models if authenticated ────────────────────────────────────
      if (sdkOk) {
        try {
          const config = loadConfig();
          if (live) setConfiguredDefault(config.defaultModel ?? '');

          const client = await clientManager.getClient();
          const list = await client.listModels() as ModelEntry[];
          await clientManager.shutdown();

          if (!live) return;
          setModels(list);
          const defIdx = list.findIndex(m => m.id === config.defaultModel);
          if (defIdx >= 0) setSelectedIdx(defIdx);
        } catch { /* non-fatal — checks already displayed */ }
      }
    }

    run();
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInput((_char: string, key: Key) => {
    if (models.length === 0) return;

    if (key.upArrow) {
      setSelectedIdx(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIdx(i => Math.min(models.length - 1, i + 1));
      return;
    }
    if (key.return) {
      const model = models[selectedIdx];
      if (!model) return;
      const config = loadConfig();
      saveConfig({ ...config, defaultModel: model.id });
      setConfiguredDefault(model.id);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  });

  const failed = checks.filter(c => !c.ok);

  return (
    <Box flexDirection="column" gap={1}>

      {/* Health checks */}
      <Box flexDirection="column">
        <Text bold>Health checks</Text>
        <Box flexDirection="column" marginTop={1}>
          {checks.map(c => (
            <Box key={c.name}>
              <Text color={c.ok ? 'green' : 'red'}>{c.ok ? '✓' : '✗'} </Text>
              <Text>{c.name.padEnd(32)}</Text>
              <Text dimColor>{c.detail}</Text>
            </Box>
          ))}
          {loading && <Text dimColor>  checking…</Text>}
        </Box>
      </Box>

      {/* Summary */}
      {!loading && (
        failed.length === 0
          ? <Text color="green">All checks passed!</Text>
          : <Text color="yellow">{failed.length} check(s) failed — see above.</Text>
      )}

      {/* Model picker */}
      {models.length > 0 && (
        <Box flexDirection="column">
          <Text bold>Available models</Text>
          <Box flexDirection="column" marginTop={1}>
            {models.map((m, i) => {
              const active  = i === selectedIdx;
              const isDefault = m.id === configuredDefault;
              return (
                <Box key={m.id}>
                  <Text color={active ? 'cyan' : undefined}>{active ? '❯ ' : '  '}</Text>
                  <Text color={active ? 'cyan' : undefined}>{m.id.padEnd(26)}</Text>
                  {isDefault && <Text dimColor> ← default</Text>}
                </Box>
              );
            })}
          </Box>
          {saved
            ? <Text color="green">✓ Default model saved!</Text>
            : <Text dimColor>[↑↓] navigate  [enter] set as default</Text>
          }
        </Box>
      )}

    </Box>
  );
}
