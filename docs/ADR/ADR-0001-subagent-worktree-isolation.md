# ADR-0001 — SubAgent worktree isolation as the canonical per-agent primitive

Status: accepted
Date:   2026-10-11 (initial draft by M18 doc-cleanup wave; supersedes 2026-05-25 SubAgent v1.1.0 release note)
Deciders: agent-cluster/axi-agent owners (post-M18 retro review pending)

## Context

The Axi Agent Platform v1.1.0 release (2026-05-25) introduced a SubAgent
code-development mode with three-tier roles (Planner / Worker / Judge).
Multiple Workers must be able to operate concurrently on the same
underlying checkout without stepping on each other's working tree.

Two primitive candidates were considered:

1. **In-place multi-agent mode**: each Worker mutates the shared checkout,
   relying on file-level locking and sequential reconciliation.
2. **Git worktree isolation**: each Worker receives its own worktree under
   `REPOSITORY_PATH` (default `./projects`); a `CodeIsolationManager`
   handles create / sync / commit / merge / cleanup.

The workspace already supports `git worktree`, and downstream consumers
(`backend/tests/test_code_isolation_manager.py`) validate the lifecycle.

## Decision

Adopt **Git worktree isolation** as the canonical per-agent primitive
for SubAgent mode. `REPOSITORY_PATH` is the contract path, capped at
`MAX_WORKTREES` (default 10) and `MAX_PARALLEL_AGENTS` (default 8).

Workers do not share a working tree; they each receive an isolated
worktree via `CodeIsolationManager`. Concurrent allocations of the
same `REPOSITORY_PATH` are rejected by the allocation gate.

## Consequences

Positive:
- Concurrent Workers cannot corrupt each other's tree.
- Cleanup is local to each worktree (`WORKTREES_CLEANUP_HOURS`, default 24h).
- Easy to map Worker identity to a branch and review surface.

Negative:
- Disk and filesystem-inode cost scales linearly with `MAX_WORKTREES`.
- Merge conflicts now cross worktree boundaries and must be resolved in
  the integration branch, not in a single shared checkout.

Operational:
- `docs/state/UPGRADE_v1.1.0.zh-CN.md` §"环境变量配置" remains the
  authoritative surface for `REPOSITORY_PATH`, `MAX_WORKTREES`,
  `MAX_PARALLEL_AGENTS`, `DEFAULT_BASE_BRANCH`, `WORKTREES_CLEANUP_HOURS`.

Related TODOs: `AXI-AP-SUBAGENT-003`, `AXI-AP-FE-004`.
