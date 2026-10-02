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

Default behaviour (no `AXI_TODO_STORE` set) falls back to JSON when
`AXI_TODO_HOME` is set and neither DB env var is set. The M2 milestone keeps
the default at `postgres` for backwards compatibility; flipping it to `json`
is recorded as an `ownerDecisionsRequired` item in `.m1-snapshot/ledger/m2-entries.json`.

When the CLI, daemon, or MCP server starts and finds both stores non-empty,
`warnIfDualPopulated()` prints one stderr line and points at
`bin/axi-todo-import-postgres.mjs` for consolidation. The importer is
idempotent: imported PG ids are tracked in
`$AXI_TODO_HOME/.imported-pg-ids.json` and skipped on re-run.

Both `bin/axi-todo-migrate-postgres.mjs` and `bin/axi-todo-import-postgres.mjs`
require an explicit `DATABASE_URL` or `AXI_TODO_DATABASE_URL`; if both are
missing they exit 1 with a clear stderr message instead of silently defaulting
to `postgresql:///axi_todo` (the previous behaviour caused real "looks
connected, actually empty DB" incidents; see the M2 ledger
`outOfScopeButFlagged`).

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
```
