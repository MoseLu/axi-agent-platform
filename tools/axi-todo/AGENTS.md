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
