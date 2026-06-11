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

## Zero-context handoff governance

### Completed — Migrate the project docs manifest to v2

- **Problem:** A new agent could see the document inventory but could not discover runtime entrypoints, commands, environment boundaries, contracts, active work, or current verification evidence from one machine-readable file.
- **Solution:** Upgrade `docs/project-docs.manifest.json` to version 2 using repository-local guidance, source entrypoints, package scripts, environment examples, TODOs, milestones, and contract files.
- **Expected result:** A zero-context agent can identify what to read, where execution begins, how to start and verify the project, and which known failure currently blocks verified status.
- **Acceptance:** The manifest contains every v2 onboarding field, parses as JSON, references existing local paths, contains no secret values, and records the 2026-06-11 smoke result.
- **Evidence:** `docs/project-docs.manifest.json`; `python -m json.tool docs/project-docs.manifest.json`; attempted `cd backend && python3 -m pytest -q tests/test_runtime_api_smoke.py`.
- **Dependencies:** `AGENTS.md`, `README.md`, `docs/PRD.md`, `docs/TDD.md`, `MILESTONE.md`, backend and package entrypoints.
- **Status:** Completed on 2026-06-11; runtime verification remains blocked by missing backend dependencies in the active Python environment.

### Ongoing — Keep zero-context evidence fresh

- **Problem:** Commands, environment variables, contracts, active work, and smoke evidence can drift as the backend, frontend, MCP swarm, and Axi Todo surfaces evolve.
- **Solution:** Review the v2 manifest whenever an entrypoint, command, public contract, required variable, milestone, known failure, or ownership boundary changes.
- **Expected result:** Future agents can begin from the manifest without rediscovering stale or contradictory onboarding facts.
- **Acceptance:** Each relevant change updates `updated`, `currentWork`, and `verification`; `status` becomes `verified` only after the listed safe smoke succeeds; TODO and changelog remain aligned.
- **Evidence:** Fresh command output in `verification.evidence`, a matching `CHANGELOG.md` entry, and path existence checks for all declared documents and entrypoints.
- **Dependencies:** Maintainers of `backend/`, `frontend/`, `infra/axi-agent-mcp/`, and `tools/axi-todo/`.
- **Status:** Ongoing.
