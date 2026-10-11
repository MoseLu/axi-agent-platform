# ADR-0002 — MCP swarm boundary: platform never duplicates `axi-agent-mcp` runtime groups

Status: accepted
Date:   2026-10-11 (initial draft by M18 doc-cleanup wave; cross-references audit-remediation 2026-09-25 lock-down and 2026-09-29 capability broker PRs)
Deciders: agent-cluster/axi-agent owners (post-M18 retro review pending)

## Context

The Axi Agent Platform exposes an MCP swarm surface (`axi-agent-mcp`)
that owns:

- Model routing across `qwen3.5-plus` / `qwen3-coder-next` /
  `MiniMax-M2.5` / `glm-5` / `kimi-k2.5` and others.
- Tool groups (agent / workflow / git / CI / data plane).
- Server-side tool allowlist (post-2026-09-29 capability broker
  hardening).

Axi Agent Platform has historically discussed the temptation of
"shadowing" a subset of MCP tools inside the platform backend for
fallback or shim purposes. Two failure modes were observed:

1. **Tool surface drift**: shadow tools diverge from the canonical MCP
   surface, breaking the `axi_agent_*` consumer contract.
2. **Authorization bypass**: shadow tools skip the capability broker
   and therefore inherit no `capability_id` audit trail.

## Decision

Adopt a hard rule: **the platform does not duplicate `axi-agent-mcp`
runtime groups**. If a backend feature appears to require a tool that
`axi-agent-mcp` does not expose, the action is:

1. Promote the tool through `infra/axi-agent-mcp` (preferred), or
2. Open an MCP integration issue (fallback).

Tool discovery MUST go through the registered `manifest.json` and the
service contract `infra/axi-agent-mcp/docs/axi-agent-mcp-service-contract.md`.
The capability broker (`ToolManager.execute_tool` /
`AxiAgentMcpClient.call_tool`) is the only allowed execution surface
for swarm tools; raw calls without `capability_id` raise
`CapabilityError(deny_unregistered_tool)`.

## Consequences

Positive:
- One canonical MCP surface for all consumers.
- Single capability-broker audit log; no shadow paths.
- Easier to reason about cross-project contracts (`workspace-project consumers axi-agent`).

Negative:
- Any new MCP tool requires an `axi-agent-mcp` change (cannot ship in
  the platform repo alone).
- Latency-sensitive paths still must call MCP over the network.

Operational:
- README cross-ref: `infra/axi-agent-mcp/README.zh-CN.md` and
  `docs/axi-agent-mcp-service-contract.md` are the authoritative
  contract surface.
- Tool registration invariants are exercised by
  `pnpm --dir infra/axi-agent-mcp test` and
  `src/tool-contract.test.ts`.

Related TODOs: `AXI-AP-MCP-002`, `AXI-AP-BFF-005`.
