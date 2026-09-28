# Changelog

All notable local changes to Axi Agent are tracked here.

> 由 audit-remediation 2026-09-25 自动生成基础结构；后续 entry 由项目 owner 补充。

## [Unreleased]

### Added

- Optional `OBSERVABILITY_TRACE_SINK_URL` / `OBSERVABILITY_TRACE_SINK_TOKEN`
  integration for publishing bounded-agent lifecycle spans to the workspace
  TraceStore.
- 2026-09-29: Added Capability Broker + Governance Guard primitives (one-shot, action-digest-bound, TTL-bounded capabilities; 4-state allow/deny/transform/pause plan evaluation). Tool manifest enumerates all current built-in + MCP tool ids. Phase 1 commit 3.
- 2026-09-29: `infra/axi-agent-mcp` adds server-side tool allowlist (`manifest.json` + middleware in `src/index.ts`); ~31 currently-unallowlisted `swarm_*` tools are now rejected at the MCP request boundary with JSON-RPC `code = -32601` / `reasonCode = "deny_unregistered_tool"`; mutating tools additionally require a `capability_id` argument (raw string ≥ 8 chars; content validation deferred to commit 6) and return `code = -32602` when missing. Phase 1 commit 5.

### Changed

- _（暂无变更条目）_

### Removed

- _（暂无移除条目）_

## Notes

- 本文件遵循 Keep a Changelog 语义化版本（Added / Changed / Removed / Fixed / Deprecated / Security）。
- 项目 owner 须在每次可被外部观察的变更后追加一行 entry（不需要新版本号，[Unreleased] 持续累积）。
- 当一个 release 被 tag 出去时，把 [Unreleased] 的内容剪到一个新的版本段（如 [0.1.0] - 2026-XX-XX），并新开 [Unreleased] 占位。
