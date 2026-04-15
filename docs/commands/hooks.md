# `copilot-flow hooks` — Lifecycle Hooks

← [Back to README](../../README.md)

---

Hooks let you run your own code at specific points in the agent/swarm lifecycle —
logging results, sending notifications, writing audit trails, updating dashboards,
or anything else that should happen automatically around an agent run.

---

## Events reference

| Event | When it fires | Data shape |
|-------|--------------|------------|
| `swarm-start` | Before the first agent in a swarm starts | `{ topology, taskCount }` |
| `swarm-end` | After all agents in a swarm have finished | `{ topology, results }` |
| `session-start` | When a Copilot session is created | `{ agentType, sessionId }` |
| `session-end` | When a session disconnects | `{ agentType, sessionId, durationMs }` |
| `agent-spawn` | When an agent begins executing a task | `{ agentType, agentId, task }` |
| `agent-terminate` | When an agent finishes or fails | `{ agentType, agentId, success, durationMs }` |
| `pre-task` | Before `runAgentTask()` sends the prompt | `{ agentType, task }` |
| `post-task` | After `runAgentTask()` returns a result | `{ agentType, result: AgentResult }` |

> **Currently wired:** `swarm-start` and `swarm-end` are emitted by `runSwarm()`.
> The `pre-task` / `post-task` / `session-*` / `agent-*` events can be emitted in your
> own wrappers around `runAgentTask()` or used with `hooks fire` manually.

---

## How hooks work

1. **Priority** — multiple handlers for the same event run in descending priority order
   (highest first). Default priority is `50`.
2. **Timeout** — each handler has a timeout (default `5000ms`, configurable in
   `.copilot-flow/config.json`). A timed-out handler logs a warning but does not
   block the next handler or abort the run.
3. **Error isolation** — if a handler throws, the error is logged and execution
   continues with the next handler. Set `continueOnError: false` in `emit()` to
   make errors propagate instead.

---

## Programmatic API

This is the primary way to use hooks — register handlers in a script or wrapper
module and use that as your entry point instead of calling `copilot-flow` directly.

```typescript
import {
  globalHooks,
  emit,
  runAgentTask,
  runSwarm,
} from 'copilot-flow';
import type { HookContext } from 'copilot-flow';

// Register a handler
const unsubscribe = globalHooks.on('swarm-end', async (ctx: HookContext) => {
  console.log('Swarm finished:', ctx.data);
});

// Unregister when done
unsubscribe();

// Or use the typed convenience wrappers from hooks executor
import { hooks } from 'copilot-flow';

await hooks.swarmStart({ topology: 'hierarchical', taskCount: 3 });
await hooks.swarmEnd({ topology: 'hierarchical', results: {} });
```

### Registration options

```typescript
// Higher priority runs first (default 50)
globalHooks.on('post-task', myHandler, 90);

// List all registered hooks
globalHooks.list(); // [{ id, event, priority }, ...]

// Emit manually with custom timeout and error behaviour
await emit('post-task', { agentType: 'coder', result }, {
  timeoutMs: 10_000,    // override the 5s default
  continueOnError: false, // propagate errors instead of swallowing them
});
```

---

## CLI commands

### `hooks list`

Show all handlers currently registered in the process:

```bash
copilot-flow hooks list
```

### `hooks fire <event>`

Manually trigger any event — useful for testing handlers or CI/CD pipelines:

```bash
copilot-flow hooks fire post-task
copilot-flow hooks fire post-task --data '{"agentType":"coder","success":true}'
```

### Shorthand commands

```bash
copilot-flow hooks pre-task
copilot-flow hooks post-task --data '{"agentType":"reviewer"}'
copilot-flow hooks session-start
copilot-flow hooks session-end
```

---

## Configuration

In `.copilot-flow/config.json`:

```json
{
  "hooks": {
    "enabled": true,
    "timeoutMs": 5000
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `enabled` | `true` | Globally enable/disable all hook execution |
| `timeoutMs` | `5000` | Per-handler timeout in milliseconds |

---

## Practical example — audit log + Slack notifications

This worked example adds two behaviours to every swarm run without touching
the orchestration code itself:

1. **Audit log** — appends a JSON record to `.copilot-flow/audit.jsonl` after
   every swarm, so you have a durable history of what ran, when, and whether it succeeded.
2. **Slack notification** — posts a Slack message when a swarm finishes, great for
   long-running overnight jobs where you want to be notified when results are ready.

### Step 1 — create the hook script

Create `.copilot/hooks/swarm-hooks.ts` (or `.js` if you prefer no build step):

```typescript
// .copilot/hooks/swarm-hooks.ts
import { globalHooks, runSwarm } from 'copilot-flow';
import type { HookContext } from 'copilot-flow';
import { appendFileSync } from 'fs';

const AUDIT_FILE = '.copilot-flow/audit.jsonl';
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL; // set in your shell or CI env

// ── Audit log ────────────────────────────────────────────────────────────────

globalHooks.on('swarm-start', async (ctx: HookContext) => {
  const entry = {
    event: 'swarm-start',
    timestamp: new Date(ctx.timestamp).toISOString(),
    ...ctx.data as object,
  };
  appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
});

globalHooks.on('swarm-end', async (ctx: HookContext) => {
  const data = ctx.data as { topology: string; results: Record<string, unknown> };
  const tasks = Object.values(data.results ?? {});
  const succeeded = tasks.filter((r: any) => r.success).length;

  const entry = {
    event:     'swarm-end',
    timestamp: new Date(ctx.timestamp).toISOString(),
    topology:  data.topology,
    total:     tasks.length,
    succeeded,
    failed:    tasks.length - succeeded,
  };
  appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n');
});

// ── Slack notification ───────────────────────────────────────────────────────

globalHooks.on('swarm-end', async (ctx: HookContext) => {
  if (!SLACK_WEBHOOK) return; // skip if not configured

  const data = ctx.data as { topology: string; results: Record<string, unknown> };
  const tasks = Object.values(data.results ?? {});
  const succeeded = tasks.filter((r: any) => r.success).length;
  const failed    = tasks.length - succeeded;
  const icon      = failed === 0 ? ':white_check_mark:' : ':x:';

  const body = {
    text: `${icon} copilot-flow swarm finished`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*${icon} Swarm complete* — \`${data.topology}\` topology`,
            `>  Tasks: ${tasks.length}   Succeeded: ${succeeded}   Failed: ${failed}`,
            `> Finished at <!date^${Math.floor(ctx.timestamp / 1000)}^{time}|${new Date(ctx.timestamp).toISOString()}>`,
          ].join('\n'),
        },
      },
    ],
  };

  await fetch(SLACK_WEBHOOK, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}, 90); // higher priority — runs before the default audit log
```

### Step 2 — register hooks before running

Create a thin wrapper script that imports your hooks and then runs the swarm:

```typescript
// run-with-hooks.ts
import './swarm-hooks.js';            // registers all handlers
import { runSwarm, clientManager } from 'copilot-flow';

const results = await runSwarm(
  [
    { id: 'research',  agentType: 'researcher', prompt: 'Research the topic…' },
    { id: 'implement', agentType: 'coder',       prompt: 'Implement the feature…', dependsOn: ['research'] },
    { id: 'review',    agentType: 'reviewer',    prompt: 'Review the implementation…', dependsOn: ['implement'] },
  ],
  'hierarchical',
);

await clientManager.shutdown();
```

Run it with `tsx` (no build needed):

```bash
# Install tsx if you don't have it
npm install -D tsx

# Run with your Slack webhook
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... npx tsx run-with-hooks.ts
```

### Step 3 — inspect the audit log

```bash
# View the last 5 runs
tail -5 .copilot-flow/audit.jsonl | jq .

# Filter for failures only
grep '"succeeded":0' .copilot-flow/audit.jsonl | jq .

# Count total runs this week
grep -c "swarm-end" .copilot-flow/audit.jsonl
```

Example output:
```json
{"event":"swarm-start","timestamp":"2026-04-15T09:12:00.000Z","topology":"hierarchical","taskCount":3}
{"event":"swarm-end","timestamp":"2026-04-15T09-14:32.000Z","topology":"hierarchical","total":3,"succeeded":3,"failed":0}
```

---

## More hook patterns

### Notify on failure only

```typescript
globalHooks.on('swarm-end', async (ctx: HookContext) => {
  const data = ctx.data as { results: Record<string, { success: boolean }> };
  const anyFailed = Object.values(data.results).some(r => !r.success);
  if (!anyFailed) return;

  // Only page on-call if something failed
  await fetch(process.env.PAGERDUTY_WEBHOOK!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'copilot-flow swarm had failures', ...ctx.data }),
  });
});
```

### Time-box a long phase and warn if it exceeds a threshold

```typescript
const startTimes = new Map<string, number>();

globalHooks.on('agent-spawn', async (ctx: HookContext) => {
  const data = ctx.data as { agentId: string };
  startTimes.set(data.agentId, ctx.timestamp);
});

globalHooks.on('agent-terminate', async (ctx: HookContext) => {
  const data = ctx.data as { agentId: string; success: boolean; durationMs: number };
  if (data.durationMs > 5 * 60_000) {
    console.warn(`Agent ${data.agentId} took ${Math.round(data.durationMs / 60_000)} minutes`);
  }
  startTimes.delete(data.agentId);
});
```

### Write phase results to a database

```typescript
import Database from 'better-sqlite3';
const db = new Database('.copilot-flow/runs.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY,
    event TEXT,
    topology TEXT,
    succeeded INTEGER,
    failed INTEGER,
    ran_at TEXT
  )
`);

const insert = db.prepare(
  'INSERT INTO runs (event, topology, succeeded, failed, ran_at) VALUES (?, ?, ?, ?, ?)'
);

globalHooks.on('swarm-end', async (ctx: HookContext) => {
  const data = ctx.data as { topology: string; results: Record<string, { success: boolean }> };
  const tasks = Object.values(data.results ?? {});
  insert.run(
    'swarm-end',
    data.topology,
    tasks.filter(r => r.success).length,
    tasks.filter(r => !r.success).length,
    new Date(ctx.timestamp).toISOString(),
  );
});
```

---

## Testing a hook handler

Because `globalHooks.on()` returns an unsubscribe function, handlers are easy to test
in isolation without running real agents:

```typescript
import { globalHooks, emit } from 'copilot-flow';
import { describe, it, expect, vi } from 'vitest';

describe('swarm-end hook', () => {
  it('appends to the audit log on swarm-end', async () => {
    const written: string[] = [];
    vi.mock('fs', () => ({
      appendFileSync: (_path: string, data: string) => written.push(data),
    }));

    // Register the handler under test
    const unsub = globalHooks.on('swarm-end', myAuditHandler);

    // Fire the event directly — no real agents needed
    await emit('swarm-end', {
      topology: 'hierarchical',
      results: {
        'task-1': { success: true },
        'task-2': { success: false },
      },
    });

    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0])).toMatchObject({
      event:     'swarm-end',
      succeeded: 1,
      failed:    1,
    });

    unsub();
  });
});
```
