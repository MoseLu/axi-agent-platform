# Axi Todo

`axi-todo` is a local persistent task ledger plus Codex runner. It is the Axi Todo / assistant surface for unfinished-task checks. Day-to-day task maintenance is handled by the macOS desktop app; the CLI, MCP server, and LaunchAgent stay behind it as the automation backend.

Canonical workspace path: `/Volumes/code/workspace/agent-cluster/axi-agent-platform/tools/axi-todo`.

It lives under `tools/` rather than `projects/` because it is local developer automation: a CLI, MCP server, and LaunchAgent-backed daemon for Codex task handling. Product applications remain under `/Volumes/code/workspace/projects`.

## Runtime Model

- Task store: JSON file at `~/.axi-todo/tasks.json` by default, or `AXI_TODO_HOME/tasks.json`. JSON is the canonical store because the Swift desktop bridge reads/writes it directly; the optional PostgreSQL backend is opt-in via env vars (see [PostgreSQL as an opt-in backend](#postgresql-as-an-opt-in-backend)).
- Desktop app: macOS WebView shell with shared `@axi/core`, `@axi/shell`, `@axi/crud`, `@axi/settings`, `@axi/widgets`, and `@axi/vite-plugin` layers for creating, editing, filtering, deleting, building, and re-queuing tasks against the same JSON store.
- MCP server: stdio JSON-RPC server exposing Agent task operations plus personal
  Todo completion, restore, snooze, and activity-history tools.
- Daemon: single-worker loop; default interval is `300000` ms.
- Executor: local `codex exec --output-last-message ... -C <task.cwd> <prompt>`.
- Verification: optional `verifyCommand` runs in the task `cwd`. A failed verification moves a completed task back to `pending` when retries remain, otherwise `failed`.
- Verification writeback: when `verifyCommand` runs, the daemon appends a one-line bullet to an existing `<task.cwd>/VERIFICATION.md` under `## Axi Todo Verify Activity`. Idempotent on `<taskId>@<checkedAt>` so re-runs do not duplicate. Set `AXI_TODO_VERIFY_LOG_CREATE=1` only when first-write creation is intended. Paths under `references/` are skipped. Use `node bin/axi-todo.mjs verify-log --project <path>` to query entries.
- Task graph: optional `parentId`, `dependsOn`, `resourceKeys`, `taskKind`, `estimatedCostPercent`, `riskLevel`, `plannerConfidence`, `evidenceContract`, and OMO-style routing fields let external loops schedule safe parallel work without losing the local JSON ledger model.
- Unified task model: `taskDomain` separates `agent` execution tasks from
  `personal` Todos. Personal tasks use `lifecycleStatus` and
  `executionStatus`, support optional `body`, `dueDate`, `dueAt`, `remindAt`,
  `reminderState`, and retain bounded activity history without entering the
  Codex daemon scheduler.
- PRD continuity design: long-running PRD discussions should resume from local evidence packs instead of model memory. See `../../docs/axi-todo-prd-continuity-design.md` for the planned `prd` ledger, claim provenance, checkpoint, audit, resume, and export model.

## Desktop App

The desktop app owns the normal user workflow as a single Axi UI editable table. It consumes the shared `@axi/*` runtime boundary instead of copying shell logic:

- click `+` to open a local draft, then click `提交` to create the task.
- edit title, prompt, directory, verification command, due time, and status inline.
- existing task edits autosave shortly after you stop typing or changing a field.
- the `个人待办` route provides Today, Active, and Completed history views;
  completed rows can be restored and every row exposes its activity history.
- filter active, pending, running, blocked, failed, completed, cancelled, or all rows.
- write through the same `tasks.json` lock file used by the daemon.

Build the app bundle:

```bash
pnpm desktop:bundle
```

The bundle is generated at:

```text
/Volumes/code/workspace/agent-cluster/axi-agent-platform/tools/axi-todo/dist/Axi Todo.app
```

Install it into `Applications`:

```bash
pnpm desktop:install
```

Then launch it from Launchpad, Spotlight, or:

```bash
open "/Applications/Axi Todo.app"
```

The LaunchAgent can keep running in the background; new pending desktop tasks are picked up on the next daemon tick after their due time.

## Backend Quick Start

```bash
pnpm verify

node bin/axi-todo.mjs add \
  --title "Check README" \
  --prompt "Inspect this project and improve README wording if needed." \
  --cwd /Volumes/code/workspace/agent-cluster/axi-agent-platform/tools/axi-todo \
  --verify-command "pnpm verify"

node bin/axi-todo.mjs list
node bin/axi-todo.mjs ready --limit 16
node bin/axi-todo.mjs schedule --limit 16
node bin/axi-todo.mjs run-once
node bin/axi-todo.mjs daemon --interval-ms 300000
node bin/axi-todo.mjs verify-log --project /Volumes/code/workspace/workbench/axi-image-preview --limit 16
```

## Task Splitting And Scheduling

Use `split` to turn one broad goal into a dry-run child-task plan before writing anything:

```bash
node bin/axi-todo.mjs split \
  --goal "Improve MiniMax five-hour quota scheduling" \
  --cwd /Volumes/code/workspace/agent-cluster/axi-agent-platform/tools/axi-todo \
  --target-ready 24 \
  --verify-command "pnpm test"
```

Add `--apply` only after reviewing the generated plan:

```bash
node bin/axi-todo.mjs split \
  --from <parent-task-id> \
  --target-ready 24 \
  --verify-command "pnpm test" \
  --apply
```

`ready` returns pending tasks whose dependencies are complete, whose due time has passed, whose resource keys are not locked by running work, and whose OMO-style parallel group has capacity. `schedule` returns the same selected batch plus blocked-task reasons such as `waiting_on:<id>`, `resource_locked:<key>`, or `parallel_group_limited:<group>`.

The built-in splitter is deterministic and local. It creates graph-ready slices with evidence contracts, resource keys, and routing metadata inspired by oh-my-openagent: `agentRole`, `agentCategory`, `executionMode`, `parallelGroup`, and `maxParallelGroup`. Higher-level planners such as Hermes/CrewAI/LangGraph-style agents can replace the planning step as long as they write the same task fields.

Useful OMO-aligned task fields:

- `agentRole`: `explore`, `sisyphus-junior`, `atlas`, `librarian`, `oracle`, and related OMO roles.
- `agentCategory`: `quick`, `deep`, `ultrabrain`, `visual-engineering`, `writing`, `artistry`, `unspecified-low`, or `unspecified-high`.
- `executionMode`: `inspect`, `worker`, `verify`, `plan`, `consult`, or `write`.
- `modelHint` / `fallbackModels`: preferred model routing hints for loops such as the MiniMax quota drainer.
- `parallelGroup` / `maxParallelGroup`: cap concurrent workers for a category or team lane without serializing unrelated resource keys.
- `notepadPath`, `mailboxThreadId`, `worktreePath`: optional coordination anchors for team-style executors.

## Codex MCP Setup

Register the stdio MCP server with the local Codex CLI:

```bash
codex mcp add axi-todo -- node /Volumes/code/workspace/agent-cluster/axi-agent-platform/tools/axi-todo/bin/axi-todo-mcp.mjs
```

Useful MCP tools:

- `axi_todo_add_task`
- `axi_todo_list_tasks`
- `axi_todo_complete_task`
- `axi_todo_reopen_task`
- `axi_todo_snooze_task`
- `axi_todo_get_task_activity`
- `axi_todo_get_task`
- `axi_todo_update_task`
- `axi_todo_delete_task`
- `axi_todo_run_once`
- `axi_todo_ready_tasks`
- `axi_todo_schedule_tasks`
- `axi_todo_split_task`

## LaunchAgent

Generate or install the user LaunchAgent:

```bash
node bin/axi-todo-launchd.mjs print
node bin/axi-todo-launchd.mjs install
node bin/axi-todo-launchd.mjs status
node bin/axi-todo-launchd.mjs uninstall
```

The LaunchAgent runs:

```text
node /Volumes/code/workspace/agent-cluster/axi-agent-platform/tools/axi-todo/bin/axi-todo-daemon.mjs --interval-ms 300000
```

## Task Statuses

- `pending`: unfinished and eligible for execution when `dueAt` has passed.
- `running`: claimed by a daemon tick and protected from deletion until the run finishes.
- `completed`: Codex exited successfully and verification passed or was not configured.
- `failed`: execution failed, or verification failed after attempts were exhausted.
- `blocked`: manually paused by a user or agent.
- `cancelled`: terminal cancellation.

Personal Todos keep `status` for compatibility with the shared store, but the
user-facing lifecycle is `open`, `completed`, `cancelled`, or `archived`.

## PostgreSQL as an opt-in backend

JSON is canonical, but operators who want a Postgres-backed store can run the
PG schema (`bin/axi-todo-migrate-postgres.mjs`) and switch the runtime via
`AXI_TODO_STORE`. The PG store is not the desktop app's source of truth — the
Swift bridge is structurally bound to JSON — so the importer
(`bin/axi-todo-import-postgres.mjs`) is the only sanctioned path for PG data
to enter the canonical JSON ledger.

### `AXI_TODO_STORE` values

| Value      | Behaviour                                                                                                  |
|------------|------------------------------------------------------------------------------------------------------------|
| `json`     | Always use the local JSON store (`AXI_TODO_HOME` or `~/.axi-todo/tasks.json`).                              |
| `postgres` | Always use Postgres; requires `DATABASE_URL` or `AXI_TODO_DATABASE_URL` to be set.                        |
| `auto`     | Use Postgres when `DATABASE_URL` / `AXI_TODO_DATABASE_URL` is set, otherwise JSON.                        |

`AXI_TODO_STORE` defaults to `json`. PostgreSQL remains available as an
explicit opt-in. To select it, run:

```bash
export AXI_TODO_STORE=postgres
export DATABASE_URL=postgresql://...
```

Use `AXI_TODO_STORE=auto` only when you intentionally want the presence of a
database URL to select PostgreSQL; otherwise JSON remains the safe canonical
choice.

### Provenance fields available to Swift consumers

As of M6 the canonical JSON exposes two top-level provenance fields per task
that the Swift bridge (`AxiTodoTask`) reads directly:

- `source` (optional string): set to `"import-postgres"` for rows that
  arrived via `bin/axi-todo-import-postgres.mjs`; missing/`null` for
  natively-created rows.
- `importedAt` (optional ISO 8601 string): the timestamp captured when the
  importer wrote the row. Absent for native rows.

The Swift `AxiTodoTask` mirrors the same names — `var source: String?` and
`var importedAt: Date?` (parsed via `.iso8601`). Older store files without
these keys still decode cleanly with `source = nil` / `importedAt = nil`,
so the bridge stays backward-compatible.

### Dual-store startup warning

When the CLI, daemon, or MCP server boots and finds **both** stores
populated, it prints one line to stderr:

```text
axi-todo: detected populated JSON + PG stores; using <chosen>. Run bin/axi-todo-import-postgres.mjs to consolidate (other=<kind> tasks=<count>).
```

This is informational only; it never blocks startup. Run
`bin/axi-todo-import-postgres.mjs` (with `--dry-run` first) to bring PG rows
into JSON. The importer is reentrant: it tracks imported PG ids in
`$AXI_TODO_HOME/.imported-pg-ids.json` and skips them on the next run.

As of M4, the cross-store probe is gated behind `AXI_TODO_DUAL_PROBE=1`. By
default, the boot path trusts the chosen side (resolved from `AXI_TODO_STORE`
or its `auto` default) and skips the cross-store IO. Set
`AXI_TODO_DUAL_PROBE=1` to force the warning to fire even when only the
chosen side is populated.

### Provenance columns on the four auxiliary PG tables (M6)

M4 added `source` (`text NOT NULL DEFAULT 'native'`) and `imported_at`
(`timestamptz`) to the PG `tasks` table and bound them through `upsertTask`
with sticky `ON CONFLICT` semantics. M6 extends that mirror to the four
auxiliary tables the ledger carries alongside `tasks`:
`completion_summaries`, `failure_analyses`, `planning_records`, and
`memory_cards`. The migration is
`tools/axi-todo/migrations/004_collection_provenance.sql` — idempotent, same
ADD-COLUMN / COALESCE-backfill / payload reverse-sync pattern, 20 statements
(4 tables × 5 ops). The PG upserts in `lib/postgres-store.mjs` —
`insertCompletionSummary`, `insertFailureAnalysis`, and `insertMemoryCard` —
now bind `source` / `imported_at` on `INSERT` and deliberately omit them from
`ON CONFLICT DO UPDATE SET`, so re-imported or re-synced rows preserve their
original provenance marker. The per-record `create*Record` helpers in
`lib/store.mjs` and `lib/postgres-store.mjs` inherit provenance from the
parent task so an imported task keeps a fully-provenance-tagged child-record
trail. Planning records currently have no PG write path — the migration only
adds columns and the index, mirroring the JSON-side provenance the Swift
bridge already sees through `payload`.

### Provenance columns on the two event-trail PG tables (M7)

M7 closes the same mirror for the runtime event tables — `audit_reviews` (one
row per audit decision) and `task_events` (one row per state-transition
event: claimed, completed, audit_waiting, retry_scheduled, …). The migration
is `tools/axi-todo/migrations/005_event_provenance.sql` — same
ADD-COLUMN / COALESCE-backfill / payload reverse-sync template, 10 statements
(2 tables × 5 ops), idempotent on re-run. The PG writers in
`lib/postgres-store.mjs` — `recordTaskEvent` and `recordAuditReview` — now
bind `source` / `imported_at` on `INSERT` and use sticky `ON CONFLICT DO
UPDATE SET` (omit the two columns, reverse-sync payload from the canonical
column values). The audit_waiting `task_events` row written inside
`recordAuditReview`'s M3.S4 `withClient` transaction inherits the same
provenance so the audit trail and the history trail stay tied to a single
origin marker across re-runs.

### Migrator and importer no longer fall back silently

As of M2, `bin/axi-todo-migrate-postgres.mjs` and
`bin/axi-todo-import-postgres.mjs` both require `DATABASE_URL` or
`AXI_TODO_DATABASE_URL` to be set. If both are missing they exit 1 with a
clear stderr message instead of silently defaulting to
`postgresql:///axi_todo` (the previous behaviour caused real "looks connected,
actually empty DB" incidents; see `.m1-snapshot/ledger/m2-entries.json`
`outOfScopeButFlagged`).

### PG → JSON reverse sync (M6)

The importer above is one-way (PG → JSON). When a JSON-only Swift install
runs without it, PG data stays orphaned in the Swift install. The reverse
direction is covered by `bin/axi-todo-sync-pg-to-json.mjs` (added in M6):

```bash
node bin/axi-todo-sync-pg-to-json.mjs                              # dry-run (default)
node bin/axi-todo-sync-pg-to-json.mjs --apply --confirm-apply
node bin/axi-todo-sync-pg-to-json.mjs --apply --confirm-apply \
  --only-collections=tasks,completion_summaries
```

The reverse sync is strictly owner-gated: dry-run by default; `--apply`
requires BOTH `--apply` AND `--confirm-apply` (double-flag confirmation
matching the M5.S5 pattern). `--apply` without `--confirm-apply` exits 1
with a stderr message — there is no silent fallback. The tool also
requires `DATABASE_URL` / `AXI_TODO_DATABASE_URL` to be set (no implicit
default, same as the importer).

**JSON is canonical.** When a row already exists in JSON (regardless of
which side has the newer `updatedAt`), the tool skips without
overwriting. Drift between PG and JSON is surfaced through a `warnings`
array in the summary so operators can audit divergence without the tool
silently clobbering local state.

The reverse sync is **reentrant**. Synced ids are recorded in
`$AXI_TODO_HOME/.synced-pg-to-json-ids.json` (parallel to
`.imported-pg-ids.json`); re-running skips them. Before any mutation the
tool writes a pre-sync backup snapshot to
`$AXI_TODO_HOME/.m1-snapshot/m6-audit/pre-sync-<ISO>.json` so the operator
has a recoverable point if anything goes wrong.

## CLI Reference

```bash
node bin/axi-todo.mjs add --title <title> --prompt <prompt> [--cwd <path>] [--verify-command <cmd>]
node bin/axi-todo.mjs list [--status pending] [--json]
node bin/axi-todo.mjs show <task-id>
node bin/axi-todo.mjs delete <task-id>
node bin/axi-todo.mjs update <task-id> [--status completed] [--note <text>]
node bin/axi-todo.mjs split [--goal <goal> | --from <task-id>] [--target-ready 24] [--apply]
node bin/axi-todo.mjs ready [--limit 50]
node bin/axi-todo.mjs schedule [--limit 50]
node bin/axi-todo.mjs run-once
node bin/axi-todo.mjs daemon --interval-ms 300000
node bin/axi-todo.mjs mcp
node bin/axi-todo.mjs verify-log [--project <path>] [--limit 32] [--json]
```
