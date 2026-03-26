# copilot-flow — Claude Code Configuration

> Multi-agent orchestration framework for GitHub Copilot CLI.
> Inspired by Ruflo (claude-flow) at `c:\Users\kosta\dev\ruflo\`.
> Remote repo: `git@github.com:mamalisk/copilot-flow.git`

## Project Overview

copilot-flow controls the **`copilot` CLI** (standalone binary, not `gh copilot`) programmatically via `@github/copilot-sdk` (JSON-RPC). Each "agent" is a `CopilotSession`. This is analogous to how claude-flow/Ruflo uses `claude -p` headless instances.

**Reference docs**: https://github.com/github/copilot-sdk/tree/main/nodejs
**CLI reference**: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference

## Package Structure (single package, not a monorepo)

```
src/
├── core/
│   ├── retry.ts          # Retry engine (exponential/linear/constant/fibonacci + jitter)
│   ├── error-handler.ts  # Error classification (9 categories, retryable flags)
│   └── client-manager.ts # CopilotClient singleton
├── agents/
│   ├── registry.ts       # 12 agent types + keyword-based task router
│   ├── executor.ts       # runAgentTask() — creates session, sends prompt, retries
│   └── pool.ts           # Agent state persistence (.copilot-flow/agents/*.json)
├── swarm/
│   └── coordinator.ts    # runSwarm() — hierarchical/mesh/sequential topologies
├── memory/
│   └── store.ts          # SQLite namespaced key-value (better-sqlite3)
├── hooks/
│   ├── registry.ts       # Priority-ordered pub/sub
│   └── executor.ts       # emit() with timeout protection
├── commands/             # commander.js CLI (init, agent, swarm, memory, hooks, route, status, doctor)
├── config.ts             # .copilot-flow/config.json load/save
├── types.ts              # Shared TypeScript types
├── output.ts             # chalk/ora output utilities
└── index.ts              # Public package API exports
tests/
├── core/retry.test.ts
├── core/error-handler.test.ts
└── agents/executor.test.ts   # Mocks @github/copilot-sdk
```

## Key Patterns

- **Retry**: `withRetry(fn, { maxAttempts, backoffStrategy, jitter })` in `src/core/retry.ts`
- **Error classification**: `classifyError(err)` returns `{ category, retryable, retryAfterMs }`
- **Agent execution**: `runAgentTask(agentType, task, options)` in `src/agents/executor.ts`
- **Swarm**: `runSwarm(tasks, topology)` in `src/swarm/coordinator.ts`
- **Memory**: `getMemoryStore().store/retrieve/search/list/delete/clear(namespace, key, ...)`
- **Hooks**: `globalHooks.on(event, handler)` + `emit(event, data)` in `src/hooks/`

## Development Commands

```bash
npm run build     # tsc compile → dist/
npm test          # vitest run
npm run dev       # ts-node src/index.ts (dev mode)
```

## Behavioral Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary
- ALWAYS prefer editing an existing file to creating a new one
- ALWAYS read a file before editing it
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Never commit secrets or .env files
- NEVER save working files to the root — use src/, tests/, docs/

## File Organization

- Source code → `src/`
- Tests → `tests/`
- Documentation → `docs/`
- Config files → root or `config/`

## SDK Key Facts

```typescript
import { CopilotClient, approveAll } from "@github/copilot-sdk";

const client = new CopilotClient();   // uses installed 'copilot' CLI
await client.start();

const session = await client.createSession({
  model: "gpt-4o",
  onPermissionRequest: approveAll,   // required
  systemMessage: { content: "..." }, // optional system prompt
});

// Streaming
session.on("assistant.message_delta", (e) => process.stdout.write(e.data.deltaContent));
session.on("session.idle", () => { /* done */ });

// Or wait for full response
const result = await session.sendAndWait({ prompt: "..." }, 120_000);
// result.data.content

await session.disconnect();
await client.stop();
```

## Error Categories

`copilot_not_installed` | `authentication` | `authorization` | `not_found` | `rate_limit` | `timeout` | `session_error` | `network` | `validation` | `unknown`

Retryable: `rate_limit`, `timeout`, `session_error`, `network`
Not retryable: `authentication`, `authorization`, `not_found`, `validation`, `copilot_not_installed`
