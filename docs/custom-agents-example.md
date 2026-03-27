# Custom Agents Example: SaaS Billing Platform

This example shows how a team building a multi-tenant SaaS billing platform uses
copilot-flow with custom agents, repo skills, and a shared instructions file to
accelerate their day-to-day development.

---

## Project layout

```
my-billing-app/
├── .github/
│   ├── copilot-instructions.md    ← repo-wide rules injected into every session
│   └── SKILL.md                   ← billing domain knowledge skill
├── .copilot/
│   └── agents/
│       ├── billing-expert.md      ← knows Stripe, webhooks, idempotency
│       ├── compliance-auditor.md  ← PCI-DSS / SOC 2 specialist
│       └── migration-writer.md   ← writes safe Postgres migrations
└── src/
    ├── billing/
    ├── subscriptions/
    └── webhooks/
```

---

## Step 1 — Repo instructions

`.github/copilot-instructions.md` is auto-loaded into every copilot-flow session:

```markdown
# Billing Platform — Copilot Instructions

## Stack
- Node.js 22, TypeScript 5, Fastify, Prisma ORM, PostgreSQL 16
- Stripe for payments (API version 2024-06-20)
- All monetary values stored as integers (cents)

## Rules
- Never store raw card numbers or CVVs — reference Stripe customer/payment-method IDs only
- All Stripe webhook handlers must verify the signature before processing
- Database migrations must be backwards-compatible (additive only, no column drops)
- Use Prisma transactions for any operation touching more than one table
- Every public API route requires authentication middleware
```

This is injected automatically — no flags needed.

---

## Step 2 — Domain skill

`.github/SKILL.md` teaches the model the billing domain:

```markdown
# Billing Domain Knowledge

## Subscription states
- `trialing` → `active` → `past_due` → `canceled`
- Grace period: 7 days after first failed payment before suspension

## Idempotency
All Stripe API calls use idempotency keys: `${customerId}-${action}-${timestamp-day}`

## Webhook events we handle
- `invoice.payment_succeeded` — activate/renew subscription
- `invoice.payment_failed` — start grace period
- `customer.subscription.deleted` — immediate cancellation

## Pricing tiers
- Starter: $29/mo (up to 3 seats)
- Growth: $99/mo (up to 20 seats)
- Enterprise: custom
```

---

## Step 3 — Custom agent definitions

Agent files live in `.copilot/agents/`. Each is a markdown file: **YAML frontmatter**
for metadata, **markdown body** for the agent's system prompt.

**`.copilot/agents/billing-expert.md`**
```markdown
---
name: billing-expert
displayName: Billing Expert
description: Specialises in Stripe integration, subscription lifecycle, and payment flows
tools:
  - read_file
  - write_file
  - run_command
  - search_files
---

You are a senior engineer specialising in Stripe integrations and SaaS billing.
You know the Stripe API deeply, understand idempotency requirements, webhook
reliability, and subscription state machines. When writing code, always handle
failed payments gracefully, use idempotency keys, and verify webhook signatures.
```

**`.copilot/agents/compliance-auditor.md`**
```markdown
---
name: compliance-auditor
displayName: Compliance Auditor
description: Reviews code for PCI-DSS compliance, SOC 2 controls, and security vulnerabilities
tools:
  - read_file
  - search_files
---

You are a compliance engineer specialising in PCI-DSS and SOC 2. You review code
for: exposure of cardholder data, insecure logging (no card numbers in logs),
missing input validation on payment amounts, SQL injection risks, and missing
audit trails. You output a structured list of findings with severity
(critical/high/medium/low) and remediation steps.
```

**`.copilot/agents/migration-writer.md`**
```markdown
---
name: migration-writer
displayName: Migration Writer
description: Writes safe, backwards-compatible Prisma migrations
tools:
  - read_file
  - write_file
---

You are a database engineer who writes Prisma migrations for a production
PostgreSQL database. You follow these rules strictly: migrations are always
additive (never drop columns or tables in the same migration as data changes),
new columns always have defaults or are nullable, indexes are created CONCURRENTLY
where possible, and every migration includes a comment explaining the business
reason for the change.
```

---

## Usage examples

### Implement a new feature with the billing expert

```bash
copilot-flow agent spawn \
  --type coder \
  --agent-dir .copilot/agents \
  --agent billing-expert \
  --skill-dir .github \
  --task "Add support for annual billing: allow users to switch from monthly to annual plans.
          Prorate the remaining monthly days as a credit applied to the annual invoice.
          Use Stripe's subscription update API with proration behaviour set to 'create_prorations'."
```

The session uses:
- The `billing-expert` agent's system prompt (from the markdown body)
- The `.github/SKILL.md` domain knowledge
- `.github/copilot-instructions.md` repo rules (auto-loaded)

---

### Run a compliance audit before a release

```bash
copilot-flow agent spawn \
  --type reviewer \
  --agent-dir .copilot/agents \
  --agent compliance-auditor \
  --task "Audit all files changed in the last sprint (git diff main...HEAD) for PCI-DSS compliance issues."
```

---

### Multi-phase feature delivery swarm

Write a spec file `add-usage-billing.md`:

```markdown
# Feature: Usage-Based Billing

Add metered billing for API calls. Each customer's API usage is counted per month
and billed via Stripe metered subscriptions.

## Requirements
1. Track API calls per customer in Redis (increment on each request)
2. Sync usage to Stripe every hour via a cron job using `stripe.subscriptionItems.createUsageRecord()`
3. Display current usage and estimated bill in the customer dashboard
4. Write a Prisma migration to add a `usage_records` audit table
```

Run the full pipeline:

```bash
# Phase 1: research + architecture
copilot-flow swarm start \
  --spec add-usage-billing.md \
  --output phase1-design.md \
  --topology sequential \
  --agents architect,analyst \
  --skill-dir .github \
  --agent-dir .copilot/agents

# Phase 2: implementation (billing expert writes the code)
copilot-flow swarm start \
  --spec phase1-design.md \
  --output phase2-impl.md \
  --topology hierarchical \
  --agents coder,coder,coder \
  --agent billing-expert \
  --agent-dir .copilot/agents \
  --skill-dir .github

# Phase 3: compliance audit + migration
copilot-flow swarm start \
  --spec phase2-impl.md \
  --output phase3-review.md \
  --topology sequential \
  --agents reviewer,tester \
  --agent-dir .copilot/agents
```

---

## Persisting defaults in config

To avoid repeating flags on every command, add defaults to `.copilot-flow/config.json`:

```json
{
  "instructions": {
    "file": ".github/copilot-instructions.md",
    "autoLoad": true
  },
  "skills": {
    "directories": [".github"],
    "disabled": []
  },
  "agents": {
    "directories": [".copilot/agents"]
  }
}
```

After this, skill and agent dirs are picked up automatically on every run:

```bash
# This now uses .github/SKILL.md and .copilot/agents/ automatically
copilot-flow agent spawn \
  --agent billing-expert \
  --task "Fix the webhook retry logic for failed invoice payments."
```
