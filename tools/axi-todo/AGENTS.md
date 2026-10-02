# Axi Todo Agent Guide

## Scope

- This repository owns the local `axi-todo` task ledger, MCP server, and Codex runner.
- **axi-todo is part of the `axi-agent` project** (`/Volumes/code/workspace/agent-cluster/axi-agent/tools/axi-todo/`). It is NOT a standalone workspace project.
- Keep v1 local-first: no external database, no web UI, and no network dependency unless a task explicitly asks for it.
- Runtime data belongs under `AXI_TODO_HOME` or `~/.axi-todo`; do not commit task stores, run outputs, logs, or lock files.

## Todo System Landscape

See [docs/TODO-ARCHITECTURE.md](./docs/TODO-ARCHITECTURE.md) for the full landscape including:

- **axi-todo** (primary canonical system in `agent-cluster/axi-agent/tools/axi-todo/`)
- **workflow-todo** (gallery-specific test artifact, not production)
- **feiyu-agentflow todo** (in `foundation/axi-notify/donors/feiyu-agentflow/`)
- **axi-soul-world todo** (in `products/axi-soul-world/apps/android/`)
- **minimax-axi-todo-loop** (orchestration skill in `~/.claude/skills/`)

## Safety

- Treat task prompts, Codex output, and verification logs as local user data.
- Do not print secrets from task prompts, environment variables, or Codex output.
- Keep daemon execution single-worker by default unless concurrency is deliberately designed and tested.

## Verification

- Run `pnpm verify` after source changes.
- For daemon or runner changes, include a test that avoids invoking real Codex by using a fake command.

## Milestone Ledger Conventions (M-series bookkeeping)

Per-M-series work is recorded in `.m1-snapshot/ledger/m{N}-entries.json` files (M1-M12+). These ledgers are pure human/agent metadata (verified by M12 Track A: zero automated readers across `lib/`, `bin/`, `test/`, `scripts/`, `Sources/`, `src/`).

**Authoritative references** (added in M12):
- [`docs/LEDGER_TEMPLATE.md`](./docs/LEDGER_TEMPLATE.md) — formal schema for all 13 top-level ledger keys; minimum-required-fields + intentional form-transition boundaries (loreTrail / newFindings / ownerDecisionsRequired / subTasks deps); M13+ ledgers MUST follow this template
- [`OWNER_DECISIONS.md`](./OWNER_DECISIONS.md) — canonical owner-decision index; the M12 Track B "Decision Eviction Policy" section defines mandatory S99 eviction-check + 4-value vocabulary (`closed` / `superseded` / `owner-no-action` / `out-of-scope`) + linked-doc invariant (≤1-milestone lag between canonical-doc changes and originating-ledger updates)

**Mandatory M{N}.S99 step** (per Decision Eviction Policy):
Every milestone close MUST apply exactly one of `refresh` / `evict` / `cross-reference-only` to every entry in the current milestone's `ownerDecisionsRequired[]`. See OWNER_DECISIONS.md §"Decision Eviction Policy" for the full rule.

**Pre-existing dirty tree constraint**: the workspace governance directive "keep pre-existing dirty tree intact" applies to every M-series commit body. Do NOT stage files outside the M{N} scope.

**Owner-gated mutations**: any irreversible status flip, status reclassification, or destructive JSON store mutation MUST be owner-gated via `--apply --confirm-apply` double-flag pattern (see `bin/axi-todo-recheck-completed.mjs` + `bin/axi-todo-sync-pg-to-json.mjs`).
