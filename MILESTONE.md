# Milestone

Evidence-backed milestone log for Axi Agent Platform. Each entry references the verification command used, the date observed, and the deliverable commit or release when known.

Status legend:
- ✅ verified — the listed verification command passed on the stated commit/date.
- 🟡 partial — known verification gaps; see "Not-tested" notes.
- ⏳ planned — not yet shipped.

## M-2026-05-10 — v1.0.0 General collaboration baseline — ✅

- Scope: FastAPI backend with OpenAI Swarm-style orchestration, React frontend, Docker compose deployment, Chroma long-term memory, multi-agent general collaboration mode.
- Verification:
  - `cd backend && pytest tests/` passes for general collaboration regression tests.
  - `cd frontend && pnpm install && pnpm dev` boots the Vite dev server on http://localhost:5173.
  - `docker-compose up -d` brings up backend + nginx-fronted frontend.
- Evidence: README.md "开发计划 / v1.0.0" checklist; backend Dockerfile + frontend Dockerfile + docker-compose.yml.

## M-2026-05-25 — v1.1.0 SubAgent code-development mode — ✅

- Scope: Planner / Worker / Judge three-tier roles, `CodeIsolationManager` worktree isolation, SubAgent REST API, frontend SubAgent management page, Axi naming migration, `axi-agent-mcp` MCP swarm service as external plane.
- Verification:
  - `cd backend && pytest tests/test_code_isolation_manager.py` passes.
  - `pnpm --dir infra/axi-agent-mcp test` passes the tool-contract regression suite.
  - `cd frontend && pnpm run frontend:typecheck` passes.
- Evidence: `infra/axi-agent-mcp/docs/axi-agent-mcp-service-contract.md` (generated 2026-05-25), `backend/tests/test_code_isolation_manager.py`, `frontend/src/pages/SubAgent.tsx`.

## M-2026-06-07 — Docs manifest v1 — ✅

- Scope: `docs/project-docs.manifest.json` records expected doc inventory, owners, and verification policy.
- Verification:
  - `python -c "import json; json.load(open('docs/project-docs.manifest.json'))"` returns 0.
- Evidence: `docs/project-docs.manifest.json` writer `workspace-docs-gap-audit-A1` (2026-06-07).

## M-2026-06-08 — Docs suite deep-init — ✅

- Scope: Add `CHANGELOG.md`, `TODO.md`, `MILESTONE.md`, `INDEX.md`, `docs/PRD.md`, and `docs/TDD.md`; preserve existing human-authored sections; first ADR directory created.
- Verification:
  - `for f in README.md README.zh-CN.md AGENTS.md CHANGELOG.md TODO.md MILESTONE.md INDEX.md PRD.md TDD.md; do test -f /Volumes/code/workspace/projects/axi-agent-platform/$f || exit 1; done && rg -n "Axi Agent Platform|PRD|TDD|Axi Todo|MCP" README.md PRD.md TDD.md MILESTONE.md INDEX.md` exits 0.
- Evidence: this commit set; see `CHANGELOG.md` [Unreleased] section.

## M-2026-Q3 — v1.2.0 WebSocket + real-time — ⏳

- Scope: WebSocket task streaming, advanced orchestration, persistent agent conversation history, automated merge-conflict resolution, observability metrics.
- Verification (planned):
  - `cd backend && pytest tests/test_realtime_stream.py` passes.
  - `cd frontend && pnpm exec vitest run` adds SubAgent streaming coverage.
- Not-tested yet: nothing under `tests/test_realtime_stream.py`.
