# Axi Todo Agent Guide

## Scope

- This repository owns the local `axi-todo` task ledger, MCP server, and Codex runner.
- Keep v1 local-first: no external database, no web UI, and no network dependency unless a task explicitly asks for it.
- Runtime data belongs under `AXI_TODO_HOME` or `~/.axi-todo`; do not commit task stores, run outputs, logs, or lock files.

## Safety

- Treat task prompts, Codex output, and verification logs as local user data.
- Do not print secrets from task prompts, environment variables, or Codex output.
- Keep daemon execution single-worker by default unless concurrency is deliberately designed and tested.

## Verification

- Run `pnpm verify` after source changes.
- For daemon or runner changes, include a test that avoids invoking real Codex by using a fake command.
