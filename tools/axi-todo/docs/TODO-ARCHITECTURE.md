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
- **Task model**: Supports `agent` execution tasks and `personal` Todos with lifecycle management
- **Verification**: Optional `verifyCommand` per task with idempotent writeback to `<cwd>/VERIFICATION.md`

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
