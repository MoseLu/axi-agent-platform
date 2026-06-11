# Product Requirements — Axi Agent Platform

## 1. Summary

Axi Agent Platform is the owner project for **Axi Todo**, **SubAgent code-development mode**, and the **MCP model-swarm** layer that the workspace consumes. It delivers a personal-scale, locally-runnable multi-agent collaboration system that combines:

- General collaboration agents (OpenAI Swarm-style hand-offs, LangChain tools, Chroma long-term memory).
- SubAgent code-development mode (Planner / Worker / Judge over Git worktrees).
- An MCP service layer (`axi-agent-mcp`) that owns model routing, workflow, git, CI, agent, skill, governance, and data planes.

The platform is the canonical owner of the local Axi Todo CLI and the desktop / web surfaces that drive it.

## 2. Users

- **Solo developer-owner** — primary user; runs the platform locally on macOS, drives tasks through the Axi Todo CLI / desktop / web.
- **Workspace-internal agents** — Codex / OMX agents that consume `axi-agent-mcp` for model routing, workflow execution, git operations, and governance.
- **Documentation / audit agents** — read this PRD plus `INDEX.md`, `TODO.md`, `MILESTONE.md` to scope work and verify completeness.

## 3. Product Goals

- G1 — Provide a single local entrypoint that owns Axi Todo, SubAgent worktree orchestration, and the MCP swarm service consumed by the rest of the workspace.
- G2 — Keep agent task execution verifiable end to end: every task emits a status event, every SubAgent step is committed to a worktree branch, every MCP call is logged.
- G3 — Maintain a strict ownership boundary: the platform never duplicates model routing, workflow execution, filesystem, git, CI, agent, skill, gate, vector, cache, or code-store logic that already lives in `axi-agent-mcp`.
- G4 — Preserve human-authored documentation. New docs are added incrementally; existing `<!-- MANUAL -->` sections are never overwritten.

## 4. Functional Requirements

| ID | Statement | Priority |
|----|-----------|----------|
| FR-1 | The platform shall expose a SubAgent REST surface (`/subagent/worktree/*`, `/subagent/quality/*`, `/subagent/config`) for create / sync / commit / merge / cleanup of Git worktrees. | P0 |
| FR-2 | The platform shall consume `axi-agent-mcp` MCP services through MCP tool calls for `model-routing`, `workflow`, `workspace`, `git`, `ci`, `agents`, `skills`, `governance`, and `data` groups. | P0 |
| FR-3 | The platform shall host the Axi Todo package (`tools/axi-todo`) with `axi-todo`, `axi-todo-daemon`, `axi-todo-mcp`, and `axi-todo-launchd` binaries plus a `verify` script. | P0 |
| FR-4 | The platform shall provide a React dashboard with agent, task, tool, memory, and SubAgent pages that match the FastAPI surface. | P0 |
| FR-5 | The platform shall provide a complete root docs suite (`README.md`, `README.zh-CN.md`, `AGENTS.md`, `CHANGELOG.md`, `TODO.md`, `MILESTONE.md`, `INDEX.md`, `PRD.md`, `TDD.md`) with P0/P1 TODOs carrying requirement IDs and test cases. | P0 |
| FR-6 | The platform shall expose WebSocket task streaming for SubAgent and general collaboration modes. | P1 |
| FR-7 | The platform shall persist agent conversation history across restarts. | P1 |
| FR-8 | The platform shall surface Prometheus-style metrics for active agents, worktrees, MCP calls, and Chroma latency. | P2 |

## 5. Non-Goals

- N1 — The platform does **not** ship its own model router; routing is owned by `axi-agent-mcp`.
- N2 — The platform does **not** maintain a hosted multi-tenant service; deployment target is the solo developer's local machine.
- N3 — The platform does **not** translate or modify third-party / reference governance documents under `references/` or `docs/audit/`; those remain governed by the workspace governance project.
- N4 — The platform does **not** claim ownership of upstream product direction; reference material (`参考.md`) is explicitly non-source-of-truth.

## 6. Acceptance Criteria

- AC-1 — `docker-compose up -d` brings up backend and frontend with the renamed `axi-agent-platform-*` container / network family.
- AC-2 — `for f in README.md README.zh-CN.md AGENTS.md CHANGELOG.md TODO.md MILESTONE.md INDEX.md PRD.md TDD.md; do test -f $f || exit 1; done && rg -n "Axi Agent Platform|PRD|TDD|Axi Todo|MCP" README.md PRD.md TDD.md MILESTONE.md INDEX.md` exits 0.
- AC-3 — `pnpm --dir tools/axi-todo verify` exits 0; `pnpm --dir infra/axi-agent-mcp test` exits 0.
- AC-4 — Backend regression suite (`pytest backend/tests/`) covers `test_code_isolation_manager.py` and `test_axi_agent_mcp_client.py` and exits 0.
- AC-5 — Frontend typecheck (`pnpm run frontend:typecheck`) exits 0.

## 7. Constraints

- C1 — Workspace governance is the source of truth for cross-project routing; project-local rules apply only inside the project tree.
- C2 — MCP tool surface must come from `axi-agent-mcp`; do not copy or fork.
- C3 — Docs mirror parity must be preserved (workspace i18n policy).
- C4 — Repository lifecycle (`main` releases, destructive cleanup) requires explicit owner approval; ordinary work lives on `dev` and task branches.

## 8. Open Questions

- OQ-1 — When will `axi-agent-mcp` publish its first stable external contract version (currently generated 2026-05-25)?
- OQ-2 — When will the first ADR (SubAgent worktree isolation) be merged under `docs/ADR/`?
- OQ-3 — Should the platform adopt the workspace-wide `axiomaticworld.com` brand narrative or remain a workspace-internal utility?
