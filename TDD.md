# Test / Technical Design — Axi Agent Platform

## 1. Architecture Assumptions

- A1 — The platform is a **monorepo** of three logical products: SubAgent mode (`backend/` + `frontend/`), Axi Todo (`tools/axi-todo`), and the MCP swarm service (`infra/axi-agent-mcp`). Each product has its own owner and verification surface.
- A2 — Model routing, workflow execution, filesystem, git, CI, agent, skill, governance, and data planes are **not** implemented inside the platform runtime. They live in `axi-agent-mcp` and are consumed via MCP.
- A3 — The platform's SubAgent mode uses **Git worktrees** as the per-agent isolation primitive. `REPOSITORY_PATH` defines the worktree root; `MAX_WORKTREES` and `MAX_PARALLEL_AGENTS` bound concurrency.
- A4 — Storage defaults to SQLite (`axi_agent_platform.db`) for task state and Chroma for long-term memory; Postgres is available via the Axi Todo migration path under `tools/axi-todo/migrations/`.
- A5 — Authentication and model credentials flow through environment variables (`.env`), never through persisted task payloads.

## 2. Component Map

| Component | Tech | Source path | Test surface |
|-----------|------|-------------|--------------|
| Backend API | Python 3.10+ FastAPI | `backend/app/` | `backend/tests/` (pytest) |
| SubAgent core | Python + Git worktrees | `backend/app/core/code_isolation_manager.py` | `backend/tests/test_code_isolation_manager.py` |
| SubAgent REST | FastAPI router | `backend/app/api/subagent.py` | `backend/tests/test_workstation_agent_tasks.py` |
| Runtime smoke | Python | `backend/tests/test_runtime_api_smoke.py` | same |
| MCP client | Python | `backend/app/core/` (consumes `axi-agent-mcp`) | `backend/tests/test_axi_agent_mcp_client.py` |
| Frontend dashboard | React 18 + TypeScript + Tailwind + Zustand | `frontend/src/` | `frontend` typecheck + Vite dev server |
| SubAgent UI page | React | `frontend/src/pages/SubAgent.tsx` | vitest (planned) |
| MCP swarm service | Node.js + TypeScript | `infra/axi-agent-mcp/src/` | vitest + `tool-contract.test.ts` |
| Axi Todo CLI / MCP | Node.js (ESM) | `tools/axi-todo/bin/`, `tools/axi-todo/lib/` | `tools/axi-todo/test/` (node --test) |
| Axi Todo desktop | Swift | `tools/axi-todo/scripts/`, `AxiTodoDesktop` | `swift run AxiTodoStoreSmokeTests` |
| Bridge runtime | Node.js | `infra/codex-remote-bridge/`, `infra/axi-agent-transport/` | owner-defined |

## 3. Test Strategy

### 3.1 Levels

- **Unit** — Pure logic under `backend/app/core/`, `tools/axi-todo/lib/`, `infra/axi-agent-mcp/src/`. Run on every commit.
- **Integration** — Service-boundary tests such as `backend/tests/test_axi_agent_mcp_client.py` and `tools/axi-todo/test/mcp-server.test.mjs`. Run on every PR to `dev`.
- **End-to-end** — `backend/tests/test_runtime_api_smoke.py` exercises the FastAPI surface against a local SQLite + Chroma. Run before merging to `main`.
- **Contract** — `infra/axi-agent-mcp/src/tool-contract.test.ts` validates that every MCP tool is registered exactly once and classified exactly once. Blocks duplicate registrations.

### 3.2 Coverage targets

- Backend regression suite must cover worktree create → sync → commit → cleanup paths and overlap rejection.
- `tools/axi-todo` `verify` script runs `check` (syntax), `test` (node --test), `desktop:test`, `frontend:typecheck`, `desktop:build`.
- `axi-agent-mcp` test suite asserts zero duplicate MCP tool registrations.

### 3.3 Risk cases

- **R-1 — Worktree collision** — concurrent SubAgent tasks targeting the same `REPOSITORY_PATH`. Test: `test_code_isolation_manager.py::test_worktree_overlap_rejected`.
- **R-2 — MCP drift** — platform consumes a tool name that `axi-agent-mcp` does not register. Test: `tool-contract.test.ts` plus a smoke call in `test_axi_agent_mcp_client.py`.
- **R-3 — Stale docs** — required doc missing or `<!-- MANUAL -->` section overwritten. Test: `for f in README.md README.zh-CN.md AGENTS.md CHANGELOG.md TODO.md MILESTONE.md INDEX.md PRD.md TDD.md; do test -f $f || exit 1; done`.
- **R-4 — i18n mirror drift** — body of `README.zh-CN.md` diverges from `README.md`. Test: workspace `scripts/verify_i18n.py --project axi-agent-platform --all`.
- **R-5 — Axi Todo MCP regression** — adding a new tool changes the public surface. Test: `tools/axi-todo/test/mcp-server.test.mjs` + `store.test.mjs`.
- **R-6 — Credential leakage** — API keys persist in task payloads. Test: scan `.env.example`, runtime logs, and `backend/app/schemas/` for secret-shaped fields.

## 4. Verification Commands

| Scope | Command | Expected exit |
|-------|---------|---------------|
| Required docs present | `for f in README.md README.zh-CN.md AGENTS.md CHANGELOG.md TODO.md MILESTONE.md INDEX.md PRD.md TDD.md; do test -f $f || exit 1; done && rg -n "Axi Agent Platform|PRD|TDD|Axi Todo|MCP" README.md PRD.md TDD.md MILESTONE.md INDEX.md` | 0 |
| Backend tests | `cd backend && pytest tests/` | 0 |
| Frontend typecheck | `cd frontend && pnpm run frontend:typecheck` | 0 |
| MCP swarm tests | `pnpm --dir infra/axi-agent-mcp test` | 0 |
| Axi Todo verify | `pnpm --dir tools/axi-todo verify` | 0 |
| Docs i18n parity | `pnpm exec scripts/verify_i18n.py --project axi-agent-platform --all` | 0 |

## 5. Open Risks

- **OR-1 — Naming migration residue** — historical artifacts may still reference the old experimental names; rely on `BUG_FIXES.md` and the `axi-agent-mcp` service contract for the canonical surface.
- **OR-2 — Solo-owner model** — only one human owner has final authority for `main`, releases, secrets, and destructive cleanup. Agents must not bypass that.
- **OR-3 — Chroma / Postgres drift** — Chroma is the default long-term store, but `cc_connect_memory` Postgres is used elsewhere in the workspace; the platform must not assume Chroma is the only vector store.

## 6. Future Work

- ADR-0001: SubAgent worktree isolation as the canonical per-agent primitive.
- ADR-0002: MCP swarm boundary — platform never duplicates `axi-agent-mcp` runtime groups.
- Frontend vitest suite for `pages/SubAgent.tsx` (P1).
- WebSocket streaming + persistent history (P1).
