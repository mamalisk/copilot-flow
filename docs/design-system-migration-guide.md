# Design System Migration with copilot-flow

A step-by-step guide for migrating a Next.js project from one design system to another using copilot-flow's multi-agent swarm — fully spec-driven, no copy-paste required.

---

## How it works

Each phase reads a markdown spec file and writes a markdown output file. The output of one phase becomes the spec for the next. All inter-agent context within a phase is handled automatically via SQLite.

```
migration-spec.md
      │  --spec
      ▼
  Phase 1 — mesh (parallel discovery)
      │  --output
      ▼
phase1-audit.md
      │  --spec
      ▼
  Phase 2 — sequential (mapping + gap analysis)
      │  --output
      ▼
phase2-mapping.md
      │  --spec
      ▼
  Phase 3 — hierarchical (implementation)
      │  --output
      ▼
phase3-impl.md
      │  --spec
      ▼
  Phase 4 — sequential (validation)
      │  --output
      ▼
phase4-validation.md
```

Each output file is plain markdown — human-readable, git-committable, and editable before passing to the next phase.

---

## Prerequisites

```bash
npm install -g copilot-flow
cd /path/to/your-nextjs-app
copilot-flow init
copilot-flow doctor   # verify GitHub Copilot CLI is connected
```

---

## Step 0 — Write your spec

Create `migration-spec.md` in your project root describing the migration:

```markdown
# Design System Migration Spec

## Project
Next.js 14 app using Material UI v5. Migrating to shadcn/ui + Tailwind CSS.

## Old design system
Package: @mui/material
Theme file: src/theme/index.ts

## New design system
Package: shadcn/ui components in src/components/ui/
Tailwind config: tailwind.config.ts

## Goals
1. Map all MUI design tokens (colours, spacing, typography) to Tailwind tokens
2. Replace all MUI component imports with shadcn/ui equivalents
3. Identify components with no shadcn/ui equivalent (custom build required)
4. Ensure zero TypeScript errors and all tests pass after migration
```

---

## Phase 1 — Discover: Audit tokens and components

Two researcher agents run in parallel — one for CSS/tokens, one for component imports.

```bash
copilot-flow swarm start \
  --spec migration-spec.md \
  --output phase1-audit.md \
  --topology mesh \
  --agents researcher,researcher \
  --stream
```

**What the agents produce in `phase1-audit.md`:**
- A JSON-style token inventory: every colour, spacing, and typography token in use
- A component usage report: every MUI component imported, grouped by category, with file counts

---

## Phase 2 — Map: Token mapping and gap analysis

The analyst maps tokens first; the architect uses that to map components and flag gaps. Each step gets the previous step's output automatically.

```bash
copilot-flow swarm start \
  --spec phase1-audit.md \
  --output phase2-mapping.md \
  --topology sequential \
  --agents analyst,architect \
  --stream
```

**What the agents produce in `phase2-mapping.md`:**
- Token mapping table: `old-token → new-token → change-type` (rename / value-change / MISSING)
- Component migration map: `OldComponent → NewComponent → props-changes`
- Gap list: components with no equivalent in the new DS, in priority order

---

## Phase 3 — Implement: Apply changes

Token changes land first (Task 1). Three component groups migrate in parallel once tokens are done (Tasks 2a/2b/2c). Missing custom components are built last (Task 3).

```bash
copilot-flow swarm start \
  --spec phase2-mapping.md \
  --output phase3-impl.md \
  --topology hierarchical \
  --agents coder,coder,coder,coder,coder \
  --stream
```

> **Tip:** You can review and edit `phase2-mapping.md` before running this phase. If the analyst missed a token or the gap list looks wrong, fix it in the file — no need to re-run Phase 2.

---

## Phase 4 — Validate: Test, review, document

Tester → reviewer → documenter run in strict order, each building on the previous output.

```bash
copilot-flow swarm start \
  --spec phase3-impl.md \
  --output phase4-validation.md \
  --topology sequential \
  --agents tester,reviewer,documenter \
  --stream
```

**What the agents produce in `phase4-validation.md`:**
- Test coverage report and any failing tests
- Review issues with `file:line` references (leftover imports, hard-coded values, TS errors)
- A `MIGRATION.md` draft covering what was migrated, the token mapping table, and known breaking changes

---

## Phase 5 — Spot-fix: On-demand targeted fixes

For any issue in `phase4-validation.md`, spawn a single targeted agent:

```bash
# Auto-route (copilot-flow picks the best agent type)
copilot-flow agent spawn \
  --task "Fix TypeScript error in src/components/Button.tsx line 42: Property 'variant' does not exist on ButtonProps"

# Or read a fix spec from a file
copilot-flow agent spawn \
  --spec phase4-validation.md \
  --type debugger \
  --output phase5-fixes.md
```

---

## Running all phases as a script

Save as `migrate.sh` and run with `bash migrate.sh`:

```bash
#!/usr/bin/env bash
set -e

SPEC=${1:-migration-spec.md}

echo "=== Phase 1: Discovery ==="
copilot-flow swarm start --spec "$SPEC" --output phase1-audit.md --topology mesh --agents researcher,researcher

echo "=== Phase 2: Mapping ==="
copilot-flow swarm start --spec phase1-audit.md --output phase2-mapping.md --topology sequential --agents analyst,architect

echo "=== Phase 3: Implementation ==="
copilot-flow swarm start --spec phase2-mapping.md --output phase3-impl.md --topology hierarchical --agents coder,coder,coder,coder,coder

echo "=== Phase 4: Validation ==="
copilot-flow swarm start --spec phase3-impl.md --output phase4-validation.md --topology sequential --agents tester,reviewer,documenter

echo "Done. Review phase4-validation.md for any remaining issues."
```

Run it:
```bash
bash migrate.sh migration-spec.md
```

---

## Topology quick reference

| Phase | Topology | Why |
|---|---|---|
| 1 — Discovery | `mesh` | Token scan and component scan are independent |
| 2 — Mapping | `sequential` | Component mapping needs token mapping output first |
| 3 — Implementation | `hierarchical` | Token changes first; component groups then parallelise |
| 4 — Validation | `sequential` | Test → review → document is a strict order |

---

## Final verification

```bash
npm run build          # TypeScript must compile clean
npm test               # All tests green
npx tsc --noEmit       # Zero type errors
grep -r "old-package-name" src/   # Should return nothing
```
