# `copilot-flow doctor` & `copilot-flow status`

---

## `doctor`

Check that all prerequisites are satisfied before running agents.

```bash
copilot-flow doctor
copilot-flow doctor --verbose
```

Runs the following checks in order:

| Check | What it verifies | Fix if failing |
|-------|-----------------|----------------|
| Node.js >= 22.5 | Runtime version | Install Node 22.5+ from nodejs.org |
| copilot CLI installed | `copilot` binary found in PATH | Install from github.com/github/copilot |
| copilot authenticated | SDK can connect and ping | `copilot login` or set `GITHUB_TOKEN` / `GH_TOKEN` |
| copilot-flow initialised | `.copilot-flow/config.json` exists | `copilot-flow init` |
| node:sqlite available | Built-in SQLite module accessible | Requires Node >= 22.5 |

### Enterprise / managed Mac fix

If the authentication check fails with a keychain prompt timing out:

```bash
# Option 1 — reuse your GitHub CLI token (if gh is already authenticated)
export GH_TOKEN=$(gh auth token)

# Option 2 — use a GitHub PAT with Copilot access
export GITHUB_TOKEN=ghp_your_token_here

# Add to your shell profile to make permanent
echo 'export GH_TOKEN=$(gh auth token)' >> ~/.zshrc
```

---

## `models`

List the models available on your Copilot plan and see which one is currently configured as the default.

```bash
copilot-flow models
```

Example output:
```
Available models:

  claude-sonnet-4-5              Claude Sonnet 4.5 ← configured default
  gpt-4o                         GPT-4o
  gpt-4o-mini                    GPT-4o Mini
  o3-mini                        o3-mini

  To pin a default: export COPILOT_FLOW_DEFAULT_MODEL=<id>
                    or set "defaultModel" in .copilot-flow/config.json
```

The same list is shown at the bottom of `copilot-flow doctor --verbose`.

---

## `status`

Show the current configuration and runtime state.

```bash
copilot-flow status
```

Prints the active config values from `.copilot-flow/config.json` (or defaults if not initialised).

---

## `init`

Scaffold a `.copilot-flow/config.json` with defaults.

```bash
copilot-flow init
copilot-flow init --model gpt-4o --topology hierarchical --max-agents 6
```

### Full config reference

```json
{
  "version": "1.0.0",
  "defaultModel": "gpt-4o",
  "defaultTimeoutMs": 120000,
  "swarm": {
    "topology": "hierarchical",
    "maxAgents": 8
  },
  "memory": {
    "backend": "sqlite",
    "path": ".copilot-flow/memory.db"
  },
  "retry": {
    "maxAttempts": 3,
    "initialDelayMs": 1000,
    "maxDelayMs": 30000,
    "backoffStrategy": "exponential",
    "jitter": true
  },
  "hooks": {
    "enabled": true,
    "timeoutMs": 5000
  },
  "instructions": {
    "file": ".github/copilot-instructions.md",
    "autoLoad": true
  },
  "skills": {
    "directories": [".copilot/skills", ".github"],
    "disabled": []
  },
  "agents": {
    "directories": [".copilot/agents"]
  }
}
```

### Environment variable overrides

```bash
GITHUB_TOKEN=ghp_...                  # GitHub PAT (bypasses keychain)
GH_TOKEN=$(gh auth token)             # GitHub CLI token
COPILOT_FLOW_DEFAULT_MODEL=claude-sonnet-4-5  # Default model (omit to let Copilot CLI choose)
COPILOT_FLOW_TIMEOUT_MS=300000        # Default session timeout (ms)
COPILOT_FLOW_MAX_RETRIES=3            # Default retry attempts
COPILOT_FLOW_RETRY_DELAY_MS=1000      # Initial retry delay (ms)
COPILOT_FLOW_LOG_LEVEL=debug          # debug | info | warn | error | silent
```
