# ADR 0001: Axi Agent Transport Owner

Date: 2026-05-25

## Status

Accepted.

## Context

Axi Agent has three active owner surfaces:

- `axi-agent-platform`: runtime/API/Web console.
- `axi-agent-mcp`: MCP service for model routing, workflows, project tools, CI, gates, and data helpers.
- `axi-agent-transport`: local terminal transport for multi-pane Claude CLI orchestration.

The archived `termagent` and `agent-scripts` projects overlap with terminal communication, but they are not active owners:

- `termagent` uses a Python package, temporary registry, Windows named pipes, message types, heartbeat, discovery, task messages, and correlation IDs.
- `agent-scripts` uses PowerShell plus inline C# named-pipe server/client code and Cursor `agent` command piping.
- The active transport already uses a Git-backed Node package, WebSocket broker, Windows Terminal launcher, Claude CLI `stream-json`, targeted `DISPATCH`, `[SEND]`, and `[BROADCAST]`.

## Decision

Keep `axi-agent-transport` as the single active terminal transport owner.

Keep the current Node/WebSocket architecture:

- `src/orchestrator.js` remains the localhost broker and agent registry.
- `src/agent-runner.js` remains the Claude CLI runner and directive parser.
- `src/launcher.js` remains the Windows Terminal pane launcher.

Do not restore the Python named-pipe runtime or standalone PowerShell pipe runtime as active code. Archive-derived ideas may be merged only as features inside `axi-agent-transport`.

## Merge From Archives

| Source | Feature | Decision |
|---|---|---|
| `termagent` | `heartbeat` message type and online detection | Merge later as WebSocket heartbeat/ping-pong, not named pipe |
| `termagent` | `correlation_id` for command/response/error | Merge later into message envelope for `DISPATCH`/response tracking |
| `termagent` | `task_create/task_update/task_complete` messages | Merge later only if `axi-agent-platform` needs terminal task telemetry |
| `termagent` | discovery/register registry | Do not copy; current WebSocket register path is enough |
| `termagent` | Python named-pipe IPC | Do not restore |
| `agent-scripts` | PowerShell launcher/test ergonomics | Merge later as Windows smoke scripts for this package |
| `agent-scripts` | Cursor `agent` pipe invocation | Do not restore as active runtime; document as optional launcher variant only |

## Message Contract Direction

Current messages are intentionally small:

```json
{
  "type": "message",
  "from": "main",
  "to": "worker-1",
  "content": "task instruction",
  "timestamp": "2026-05-25T00:00:00.000Z"
}
```

Next envelope should add only the archive-derived fields that have a clear consumer:

```json
{
  "type": "message",
  "from": "main",
  "to": "worker-1",
  "content": "task instruction",
  "timestamp": "2026-05-25T00:00:00.000Z",
  "correlationId": "run-123",
  "parentId": "dispatch-1"
}
```

## Consequences

- Axi Agent has one active terminal transport instead of three parallel runtimes.
- Archive projects remain evidence/reference, not active products.
- `axi-agent-platform` can later consume transport telemetry without owning the transport.
- `axi-agent-mcp` remains the tool/model/gate service and does not absorb terminal process orchestration.

## Verification

- Package name changed to `axi-agent-transport`.
- `pnpm test` verifies that this ADR still records heartbeat, correlation, PowerShell launcher, and named-pipe non-restoration decisions.
