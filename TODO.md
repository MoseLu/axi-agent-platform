# TODO

Requirements, priorities, and test cases for outstanding Axi Agent Platform work. Items carry stable requirement IDs (`AXI-AP-<AREA>-<NN>`) so they can be referenced from PRs, milestones, and bug reports.

Priority legend:
- **P0** — release-blocking; must include at least one verifiable test case.
- **P1** — required for next minor; must include at least one verifiable test case.
- **P2** — backlog; optional test case.

## P0 — Release Blocking

### AXI-AP-DOC-001 — Complete the docs suite and verify required files
- Owner: docs-agent / Axi workspace docs deep-init rollout.
- Acceptance: `README.md`, `README.zh-CN.md`, `AGENTS.md`, `CHANGELOG.md`, `TODO.md`, `MILESTONE.md`, `INDEX.md`, `PRD.md`, and `TDD.md` all exist; manual sections preserved.
- Test case: run the verification command `for f in README.md README.zh-CN.md AGENTS.md CHANGELOG.md TODO.md MILESTONE.md INDEX.md PRD.md TDD.md; do test -f /Volumes/code/workspace/projects/axi-agent-platform/$f || exit 1; done && rg -n "Axi Agent Platform|PRD|TDD|Axi Todo|MCP" README.md PRD.md TDD.md MILESTONE.md INDEX.md` and assert exit code 0.

### AXI-AP-MCP-002 — Keep `axi-agent-mcp` service contract drift-free
- Owner: backend maintainer.
- Acceptance: every MCP tool consumed by `axi-agent-platform` is registered exactly once in `axi-agent-mcp/src/index.ts` and classified in `src/tool-contract.ts`; mutating tools carry explicit guardrail markers.
- Test case: `pnpm --dir infra/axi-agent-mcp test` passes and `src/tool-contract.test.ts` confirms zero duplicate registrations.

## P1 — Required for Next Minor

### AXI-AP-SUBAGENT-003 — SubAgent worktree lifecycle coverage
- Owner: backend maintainer.
- Acceptance: create, sync, commit, merge, and cleanup paths for Git worktrees covered by automated tests, with concurrent-agent collision handled.
- Test case: `backend/tests/test_code_isolation_manager.py::test_worktree_lifecycle_*` passes for create → sync → commit → cleanup and rejects overlapping `REPOSITORY_PATH` allocations.

### AXI-AP-FE-004 — SubAgent dashboard UX hardening
- Owner: frontend maintainer.
- Acceptance: worktree list, change diff, merge/cleanup actions match backend contracts and degrade gracefully when `MAX_WORKTREES` is exceeded.
- Test case: `cd frontend && pnpm run frontend:typecheck && pnpm exec vitest run src/pages/SubAgent` passes.

### AXI-AP-AT-005 — Axi Todo tool integration with platform tasks
- Owner: tools maintainer.
- Acceptance: `tools/axi-todo` CLI can list/schedule Axi Todo tasks that mirror platform SubAgent tasks; MCP tool `axi-todo` exposes at least status, schedule, and complete.
- Test case: `pnpm --dir tools/axi-todo verify` passes and `tools/axi-todo/test/mcp-server.test.mjs` asserts that the three tools register and respond to a smoke request.

### AXI-AP-DOC-006 — Keep README mirror parity with source
- Owner: docs-agent.
- Acceptance: `README.md` and `README.zh-CN.md` remain byte-aligned in body content (with allowed i18n note header); structural drift triggers CI failure.
- Test case: `pnpm exec scripts/verify_i18n.py --project axi-agent-platform --all` returns 0 mismatches.

## P2 — Backlog

### AXI-AP-REALTIME-007 — WebSocket task streaming
- Add streaming task events for SubAgent mode and general collaboration tasks.

### AXI-AP-CONFLICT-008 — Automated merge conflict resolution
- Extend `CodeIsolationManager` with heuristic merge-conflict resolution for trivial text collisions.

### AXI-AP-HISTORY-009 — Persistent agent conversation history
- Move agent conversation history from in-memory session store into the platform database for cross-restart continuity.

### AXI-AP-OBSERVABILITY-010 — Standardised observability for swarm mode
- Expose Prometheus metrics for active agents, worktrees, MCP tool calls, and Chroma latency.

### AXI-AP-ADR-011 — First ADR set under `docs/ADR/`
- Capture SubAgent worktree isolation and MCP swarm boundary as ADR-0001 / ADR-0002.

## Tracking

- Source of truth for active items: this file plus the workspace docs gap-audit output under `docs/audit/`.
- When an item is delivered, move its entry to `MILESTONE.md` with the commit hash and verification evidence; do not delete items here without a referenced commit.
