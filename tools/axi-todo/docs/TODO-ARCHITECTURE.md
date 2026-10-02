# Todo System Architecture

## Project Identity

**axi-todo is NOT a standalone workspace project.** It is a component of `axi-agent` located at:

```
/Volumes/code/workspace/agent-cluster/axi-agent/tools/axi-todo/
```

It lives under `tools/` rather than `projects/` because it is local developer automation: a CLI, MCP server, and LaunchAgent-backed daemon for Codex task handling.

## Todo System Landscape

The workspace contains multiple independent todo/task systems with different ownership and purposes:

| System | Location | Owner | Purpose |
|--------|----------|-------|---------|
| **axi-todo** | `agent-cluster/axi-agent/tools/axi-todo/` | axi-agent | Primary canonical local task ledger; CLI + MCP server + LaunchAgent daemon for Codex execution |
| **workflow-todo** | `foundation/axi-ui/gallery/test/gallery-todo.test.mjs` | axi-ui/gallery | Gallery-specific test artifact, not a production todo system |
| **feiyu-agentflow todo** | `foundation/axi-notify/donors/feiyu-agentflow/` | feiyu-agentflow donor | Imported agentflow backend; part of axi-notify donor code |
| **axi-soul-world todo** | `products/axi-soul-world/apps/android/` | axiom-soul-world | Android application todo; separate product domain |
| **minimax-axi-todo-loop** | `~/.claude/skills/minimax-axi-todo-loop/` | skills | Orchestration skill for MiniMax quota-aware todo scheduling |

### axi-todo (Primary Canonical System)

axi-todo is the workspace's primary task execution system:

- **Type**: Local persistent task ledger + Codex runner
- **Runtime store**: `~/.axi-todo/tasks.json` (configurable via `AXI_TODO_HOME`)
- **Components**:
  - CLI (`bin/axi-todo.mjs`) for add/list/schedule/run operations
  - MCP server (`bin/axi-todo-mcp.mjs`) for Codex CLI integration
  - Daemon (`bin/axi-todo-daemon.mjs`) with configurable tick interval
  - Desktop app (macOS WebView shell via Axi UI)
  - PG migrator (`bin/axi-todo-migrate-postgres.mjs`) for the opt-in Postgres backend
  - PG importer (`bin/axi-todo-import-postgres.mjs`) — reentrant PG → JSON consolidation
- **Task model**: Supports `agent` execution tasks and `personal` Todos with lifecycle management
- **Verification**: Optional `verifyCommand` per task with idempotent writeback to `<cwd>/VERIFICATION.md`

#### Storage backends and `AXI_TODO_STORE`

JSON is canonical because the Swift desktop bridge (`Sources/AxiTodoKit/AxiTodoStore.swift`)
reads/writes `tasks.json` directly. Postgres is opt-in for environments that
prefer a relational backend; data only enters the JSON ledger via the importer
when an operator chooses to consolidate.

`AXI_TODO_STORE` values:

| Value      | Behaviour                                                                                       |
|------------|-------------------------------------------------------------------------------------------------|
| `json`     | Always use `AXI_TODO_HOME` or `~/.axi-todo/tasks.json`.                                          |
| `postgres` | Always use Postgres; requires `DATABASE_URL` or `AXI_TODO_DATABASE_URL` to be set.              |
| `auto`     | Use Postgres when `DATABASE_URL` / `AXI_TODO_DATABASE_URL` is set, otherwise JSON.             |

Default behaviour (no `AXI_TODO_STORE` set) is JSON. This preserves the
cross-surface canonical store used by the Swift bridge. PostgreSQL requires an
explicit `AXI_TODO_STORE=postgres` selection; `auto` is the only mode that
selects PostgreSQL from the presence of a database URL.

When the CLI, daemon, or MCP server starts and finds both stores non-empty,
`warnIfDualPopulated()` prints one stderr line and points at
`bin/axi-todo-import-postgres.mjs` for consolidation. The importer is
idempotent: imported PG ids are tracked in
`$AXI_TODO_HOME/.imported-pg-ids.json` and skipped on re-run.

As of M4, `warnIfDualPopulated()` is gated behind `AXI_TODO_DUAL_PROBE=1`.
By default the cross-store probe is skipped — the chosen side already trusts
the caller to have picked the right store. Set `AXI_TODO_DUAL_PROBE=1` to
restore the M2 dual-probe behaviour (useful when investigating divergent
JSON + PG state). The Swift `AxiTodoStore.swift` reader continues to see
`source` / `importedAt` through the `payload` jsonb column, which is
reverse-synced on every `upsertTask` from the canonical `tasks.source` /
`tasks.imported_at` columns (sticky provenance — original import timestamp
preserved across re-upserts).

### Provenance columns (`tasks.source` / `tasks.imported_at`)

Added in M4 via `migrations/003_task_provenance.sql`. Every task row carries:

- `source` (text NOT NULL DEFAULT 'native') — the origin of the row.
  `'import-postgres'` for rows brought in by `bin/axi-todo-import-postgres.mjs`;
  `'native'` for rows created directly on the PG side.
- `imported_at` (timestamptz) — original import time, written once on the
  first `INSERT` and never overwritten by later `upsertTask` calls (sticky
  semantics).

Both columns are reverse-synced into the `payload` jsonb column so JSON-side
consumers (e.g. the Swift `AxiTodoStore` reading `$AXI_TODO_HOME/tasks.json`)
continue to see `source` / `importedAt` without code changes.

### Provenance columns on the four auxiliary collections (M6)

M6 extends the M4 mirror to the four planning-memory collections the ledger
carries alongside `tasks`: `completion_summaries`, `failure_analyses`,
`planning_records`, and `memory_cards`. The migration is
`tools/axi-todo/migrations/004_collection_provenance.sql` and follows the
exact same ADD-COLUMN / COALESCE-backfill / payload reverse-sync / source-index
template as M4 — 20 statements total, idempotent on re-run.

`lib/postgres-store.mjs` `insertCompletionSummary`, `insertFailureAnalysis`,
and `insertMemoryCard` now use `INSERT … ON CONFLICT (id) DO UPDATE` with
sticky provenance semantics: the first `INSERT` writes `source` /
`imported_at`; the `ON CONFLICT DO UPDATE SET` list deliberately omits both
columns so re-upserts (e.g. `memory_cards.sync_status` flips from `pending`
to `synced`) preserve the original import marker. `payload` is rebuilt from the
canonical column values on every conflict, mirroring the M4 reverse-sync shape
that keeps the Swift JSON bridge seeing `source` / `importedAt` without code
changes.

The per-record `createCompletionSummaryRecord`, `createFailureAnalysisRecord`,
and `normalizeMemoryCards` helpers in both `lib/store.mjs` (JSON-side) and
`lib/postgres-store.mjs` (PG-side) inherit `source` / `importedAt` from the
parent task so an imported task keeps a fully-provenance-tagged child-record
trail. `planning_records` currently has no PG write path — the migration
still mirrors the JSON-side provenance into PG so future PG writers can
inherit the same shape without needing a separate migration.

Both `bin/axi-todo-migrate-postgres.mjs` and `bin/axi-todo-import-postgres.mjs`
require an explicit `DATABASE_URL` or `AXI_TODO_DATABASE_URL`; if both are
missing they exit 1 with a clear stderr message instead of silently defaulting
to `postgresql:///axi_todo` (the previous behaviour caused real "looks
connected, actually empty DB" incidents; see the M2 ledger
`outOfScopeButFlagged`).

### PG → JSON reverse sync tool (M6)

The importer above is one-way (PG → JSON). When a JSON-only Swift install
runs without it, PG data stays orphaned in the Swift install's stale JSON.
The reverse direction is closed by `bin/axi-todo-sync-pg-to-json.mjs`
(M6 track-4 / S4 evidence):

```bash
node bin/axi-todo-sync-pg-to-json.mjs                              # dry-run (default)
node bin/axi-todo-sync-pg-to-json.mjs --apply --confirm-apply
node bin/axi-todo-sync-pg-to-json.mjs --apply --confirm-apply \
  --only-collections=tasks,completion_summaries
```

Strict rules:

- **JSON is canonical.** A row already present in JSON is NEVER silently
  overwritten, regardless of which side has the newer `updatedAt`. Drift
  between PG and JSON is surfaced through a `warnings` array in the
  summary; the owner decides how to resolve divergence manually.
- **Owner-gated.** `--apply` requires BOTH `--apply` AND `--confirm-apply`
  (double-flag confirmation, mirroring the M5.S5 pattern). `--apply`
  without `--confirm-apply` exits 1 with stderr message — there is no
  silent fallback. The owner-gate check fires BEFORE any `pg.Client`
  connect, so a typo never burns a network round-trip.
- **Reentrant.** Synced ids are recorded in
  `$AXI_TODO_HOME/.synced-pg-to-json-ids.json` (parallel to
  `.imported-pg-ids.json`); re-running skips them. The ledger acts as a
  second-line guard: if a previously-synced row was later deleted from
  JSON, the ledger still records "we've seen this id" so a re-run will
  not silently re-import it.
- **No implicit DATABASE_URL default.** Same env-var contract as the
  importer and the migrator.
- **Pre-sync backup.** Before any mutation the tool writes a snapshot of
  the current JSON state to
  `$AXI_TODO_HOME/.m1-snapshot/m6-audit/pre-sync-<ISO>.json` so the
  operator has a recoverable point if anything goes wrong.
- **Provenance.** New tasks land in JSON with `source: 'import-postgres'`
  and `importedAt` set, matching the M2 importer convention so downstream
  reconcilers can distinguish them from native rows. Non-task collections
  (e.g. `completion_summaries`) get the same `source` / `importedAt` fields
  on the resulting JSON record.

Like the importer, the sync tool's `runSync()` orchestrator is testable
without a live PG — tests pass `pgState` directly. Coverage in
`test/sync-pg-to-json.test.mjs`:

- `--apply` without `--confirm-apply` is refused at both the CLI (exit 1)
  and `runSync()` (throws `AXI_TODO_SYNC_OWNER_GATE`).
- Dry-run on empty PG state: zero changes, no JSON mutation, no
  `.synced-pg-to-json-ids.json` ledger.
- Dry-run with new ids: lists them as `wouldAddIds` without writing.
- `--apply --confirm-apply` with new ids: writes to JSON with
  `source='import-postgres'` + `importedAt`, writes backup snapshot, writes
  reentrant ledger.
- `--apply --confirm-apply` with ids already in JSON (JSON newer than PG):
  skips with no overwrite.
- PG row newer than JSON: same skip action, with a `warnings` entry so the
  operator can audit drift.
- Reentrant: a second run (dry-run or apply) reports zero new adds because
  the synced-ledger check fires first.
- `--only-collections=tasks,...` limits the scan to one or more
  collections, leaving the rest of the plan untouched.
- Rows with missing top-level `id` are skipped with `skip-missing-id`
  rather than throwing.

### Other Systems Are Not Interchangeable

- **workflow-todo**: Test file only, not a production system
- **feiyu-agentflow**: Donor code from feiyu-agentflow project, not actively maintained as workspace todo infrastructure
- **axi-soul-world**: Android product application with its own domain-specific todo model
- **minimax-axi-todo-loop**: An orchestration skill that may interact with axi-todo but is not the primary system

## Relationships

```
minimax-axi-todo-loop (skill)
         |
         v
    axi-todo <-- MCP --> Codex CLI
         |
         +-- Desktop App (macOS)
         +-- Daemon (LaunchAgent)
         +-- CLI (bin/axi-todo.mjs)

Other todo systems are independent and not directly integrated.
```

## Verification Commands

```bash
# Verify axi-todo installation
pnpm verify

# Run daemon manually
node bin/axi-todo.mjs daemon --interval-ms 300000

# List ready tasks
node bin/axi-todo.mjs ready --limit 16

# PG → JSON reverse sync (M6 track-4 / S4 evidence)
node bin/axi-todo-sync-pg-to-json.mjs                                # dry-run
node bin/axi-todo-sync-pg-to-json.mjs --apply --confirm-apply        # apply
node --test test/sync-pg-to-json.test.mjs                            # sync orchestrator tests
```
