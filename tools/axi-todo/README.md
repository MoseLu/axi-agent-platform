# Axi Todo

`axi-todo` is a local persistent task ledger plus Codex runner. It is the Axi Todo / assistant surface for unfinished-task checks. Day-to-day task maintenance is handled by the macOS desktop app; the CLI, MCP server, and LaunchAgent stay behind it as the automation backend.

Canonical workspace path: `/Volumes/code/workspace/projects/axi-agent-platform/tools/axi-todo`.

It lives under `tools/` rather than `projects/` because it is local developer automation: a CLI, MCP server, and LaunchAgent-backed daemon for Codex task handling. Product applications remain under `/Volumes/code/workspace/projects`.

## Runtime Model

- Task store: JSON file at `~/.axi-todo/tasks.json` by default, or `AXI_TODO_HOME/tasks.json`.
- Desktop app: macOS WebView shell with shared `@axi/core`, `@axi/shell`, `@axi/crud`, `@axi/settings`, `@axi/widgets`, and `@axi/vite-plugin` layers for creating, editing, filtering, deleting, building, and re-queuing tasks against the same JSON store.
- MCP server: stdio JSON-RPC server exposing task add/list/get/update/delete/run-once tools.
- Daemon: single-worker loop; default interval is `300000` ms.
- Executor: local `codex exec --output-last-message ... -C <task.cwd> <prompt>`.
- Verification: optional `verifyCommand` runs in the task `cwd`. A failed verification moves a completed task back to `pending` when retries remain, otherwise `failed`.

## Desktop App

The desktop app owns the normal user workflow as a single Axi UI editable table. It consumes the shared `@axi/*` runtime boundary instead of copying shell logic:

- click `+` to open a local draft, then click `提交` to create the task.
- edit title, prompt, directory, verification command, due time, and status inline.
- existing task edits autosave shortly after you stop typing or changing a field.
- filter active, pending, running, blocked, failed, completed, cancelled, or all rows.
- write through the same `tasks.json` lock file used by the daemon.

Build the app bundle:

```bash
pnpm desktop:bundle
```

The bundle is generated at:

```text
/Volumes/code/workspace/projects/axi-agent-platform/tools/axi-todo/dist/Axi Todo.app
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
  --cwd /Volumes/code/workspace/projects/axi-agent-platform/tools/axi-todo \
  --verify-command "pnpm verify"

node bin/axi-todo.mjs list
node bin/axi-todo.mjs run-once
node bin/axi-todo-daemon.mjs --interval-ms 300000
```

## Codex MCP Setup

Register the stdio MCP server with the local Codex CLI:

```bash
codex mcp add axi-todo -- node /Volumes/code/workspace/projects/axi-agent-platform/tools/axi-todo/bin/axi-todo-mcp.mjs
```

Useful MCP tools:

- `axi_todo_add_task`
- `axi_todo_list_tasks`
- `axi_todo_get_task`
- `axi_todo_update_task`
- `axi_todo_delete_task`
- `axi_todo_run_once`

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
node /Volumes/code/workspace/projects/axi-agent-platform/tools/axi-todo/bin/axi-todo-daemon.mjs --interval-ms 300000
```

## Task Statuses

- `pending`: unfinished and eligible for execution when `dueAt` has passed.
- `running`: claimed by a daemon tick and protected from deletion until the run finishes.
- `completed`: Codex exited successfully and verification passed or was not configured.
- `failed`: execution failed, or verification failed after attempts were exhausted.
- `blocked`: manually paused by a user or agent.
- `cancelled`: terminal cancellation.

## CLI Reference

```bash
node bin/axi-todo.mjs add --title <title> --prompt <prompt> [--cwd <path>] [--verify-command <cmd>]
node bin/axi-todo.mjs list [--status pending] [--json]
node bin/axi-todo.mjs show <task-id>
node bin/axi-todo.mjs delete <task-id>
node bin/axi-todo.mjs update <task-id> [--status completed] [--note <text>]
node bin/axi-todo.mjs run-once
node bin/axi-todo.mjs daemon --interval-ms 300000
node bin/axi-todo.mjs mcp
```
