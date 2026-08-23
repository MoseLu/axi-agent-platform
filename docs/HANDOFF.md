# Axi Agent Platform Handoff

- Project: `axi-agent-platform`
- Path: `/Volumes/code/workspace/projects/axi-agent-platform`
- Owner: `Axi Core Projects`
- Readiness: `verified`
- Purpose: Multi-agent collaboration platform combining a FastAPI backend, React dashboard, SubAgent worktree isolation, an MCP model swarm, and the Axi Todo tool.

## 90-Second Read Order

1. `AGENTS.md`
2. `README.md`
3. `docs/state/UPGRADE_v1.1.0.md`
4. `docs/state/PRD.md`
5. `docs/state/TDD.md`

## Entrypoints

- `backend/app/main.py`: FastAPI application, lifecycle initialization, health endpoint, and REST router registration.
- `frontend/src/main.tsx`: React dashboard browser entrypoint.
- `apps/desktop-glass-ui/src/main.tsx`: React + Electron macOS glass desktop shell prototype.
- `infra/axi-agent-mcp/src/index.ts`: MCP model-swarm server and tool registration surface.
- `tools/axi-todo/bin/axi-todo.mjs`: Axi Todo CLI entrypoint.

## Commands

- Setup: `python -m venv backend/venv && backend/venv/bin/pip install -r backend/requirements.txt`
- Setup: `pnpm --dir frontend install`
- Setup: `pnpm --dir apps/desktop-glass-ui install`
- Setup: `pnpm --dir infra/axi-agent-mcp install`
- Setup: `pnpm --dir tools/axi-todo install`
- Start: `cd backend && uvicorn app.main:app --reload`
- Start: `pnpm --dir frontend dev`
- Start: `pnpm --dir apps/desktop-glass-ui dev`
- Start: `docker compose up -d`
- Health: `curl -fsS http://127.0.0.1:8000/health`
- Health: `curl -fsS http://127.0.0.1:8000/`
- Verify: `cd backend && pytest tests/`
- Verify: `pnpm --dir frontend build`
- Verify: `pnpm --dir apps/desktop-glass-ui build`
- Verify: `pnpm --dir infra/axi-agent-mcp test`
- Verify: `pnpm --dir tools/axi-todo verify`
- Smoke: `PYTHONPATH=backend uv run --python 3.12 --with-requirements backend/requirements.txt python -m pytest -q backend/tests/test_code_isolation_manager.py backend/tests/test_runtime_api_smoke.py`

## Environment

- Runtimes: `Python 3.10+`, `Node.js`, `pnpm`, `Docker Compose`
- Services: `FastAPI backend`, `React/Vite frontend`, `Electron macOS desktop shell`, `SQLite`, `Chroma`, `Axi Agent MCP`
- `MINIMAX_API_KEY`: required=no, secret=yes, source=backend/.env
- `OPENAI_API_KEY`: required=no, secret=yes, source=backend/.env
- `SECRET_KEY`: required=yes, secret=yes, source=backend/.env
- `DATABASE_URL`: required=no, secret=no, source=backend/.env
- `VECTOR_DB_PATH`: required=no, secret=no, source=backend/.env
- `REPOSITORY_PATH`: required=no, secret=no, source=backend/.env
- `AXI_AGENT_MCP_COMMAND`: required=no, secret=no, source=backend/.env
- `WORKFLOW_ROUTE_CREDENTIAL_SECRET`: required=yes, secret=yes, source=backend/.env

## Contracts

- Provides: `SubAgent REST API under /subagent/*`, `FastAPI health and system API under /api/v1`, `macOS glass desktop shell prototype under apps/desktop-glass-ui`, `Axi Agent MCP tool surface`, `Axi Todo CLI and MCP tools`, `Workflow-only bounded read-only Agent runtime and lifecycle events`
- Consumes: `MiniMax-compatible model API`, `OpenAI-compatible model API`, `Git repositories used as SubAgent worktree roots`, `task-execution-routing/v1 from Axi workspace governance`
- Contract files: `infra/axi-agent-mcp/docs/axi-agent-mcp-service-contract.md`, `backend/app/api/subagent.py`, `backend/app/core/code_isolation_manager.py`, `backend/app/core/task_routing.py`, `backend/app/core/workflow_event_client.py`, `docs/axi-todo-prd-continuity-design.md`, `apps/desktop-glass-ui/README.md`, `docs/PRD.md`, `docs/TDD.md`

## Current Work

- TODO: `docs/state/TODO.md`
- Milestone: `docs/state/MILESTONE.md`
- Active: SubAgent worktree lifecycle coverage
- Active: SubAgent dashboard hardening
- Active: Axi Todo integration
- Active: Axi Todo PRD continuity mode
- Active: README mirror parity

## Troubleshooting

- Symptom: Bare `cd backend && pytest tests/` fails during collection with a missing backend module such as fastapi or pydantic_settings.
  Diagnosis: The selected Python environment does not contain the complete backend dependency set.
  Resolution: Use the manifest smoke command, or create the backend virtual environment, install backend/requirements.txt, and rerun pytest.
- Symptom: SubAgent mode is unavailable while the rest of the API starts.
  Diagnosis: REPOSITORY_PATH is missing, invalid, or cannot be initialized as a Git worktree root.
  Resolution: Set REPOSITORY_PATH to an accessible Git repository root and review backend startup output.
- Symptom: Frontend cannot reach the API.
  Diagnosis: The Vite frontend and backend ports or proxy configuration are not aligned.
  Resolution: Start the backend on port 8000 for local development or use the Docker Compose ports documented in README.md.

## Decisions And Freshness

- ADR: `docs/ADR/README.md`
- Changelog: `docs/state/CHANGELOG.md`
- Submit log: `docs/logs/submit/20260611-124509-batch-submit.md`
- Last verified: `2026-08-23`
- Evidence: `PYTHONPATH=backend python3 -m pytest backend/tests/test_dashboard.py -q passed 4 tests in 0.18s on 2026-08-23 (path resolution, DTO field-by-field match with Go BFF, empty-state handling, request_id UUID format).`, `node /Volumes/code/workspace/infra/axi-workspace-governance/scripts/workspace-audit.mjs reports errors=0, warnings=0 on 2026-08-23 (3 incubations checked, no drift).`

> Generated from `docs/project-docs.manifest.json`; edit the manifest, then regenerate this file.
