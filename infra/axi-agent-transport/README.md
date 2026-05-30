# Axi Agent Transport

Axi Agent terminal transport owner. It keeps the active WebSocket broker, Windows Terminal pane launcher, and Claude CLI `stream-json` runners that were previously in the local `multi-agent` project.

The old local project name is retained only in remote history and migration notes. The current local package/path is `axi-agent-transport`.

## Scope

- Own local terminal orchestration for Axi Agent.
- Launch one main pane plus worker panes.
- Route targeted messages and broadcasts over localhost WebSocket.
- Keep Claude CLI process integration in `src/agent-runner.js`.

## Not In Scope

- Do not restore the archived Python named-pipe runtime as a second active transport.
- Do not restore standalone PowerShell pipe scripts as a separate product.
- Do not put model routing or MCP tools here; those belong to `axi-agent-mcp`.
- Do not put task/runtime APIs here; those belong to `axi-agent-platform`.

## Archive Inputs

Transport decisions are recorded in [`docs/adr/0001-axi-agent-transport.md`](docs/adr/0001-axi-agent-transport.md).
