# Axi Agent Platform Handoff

- Project: `axi-agent-platform`
- Path: `/Volumes/code/workspace/projects/axi-agent-platform`
- Owner: `Axi Core Projects`
- Readiness: `verified`
- Purpose: Multi-agent collaboration platform combining a FastAPI backend, React dashboard, SubAgent worktree isolation, an MCP model swarm, and the Axi Todo tool.

## 90-Second Read Order

1. `AGENTS.md`
2. `README.md`
3. `UPGRADE_v1.1.0.md`
4. `docs/PRD.md`
5. `docs/TDD.md`

## Entrypoints

- `backend/app/main.py`: FastAPI application, lifecycle initialization, health endpoint, and REST router registration.
- `frontend/src/main.tsx`: React dashboard browser entrypoint.
- `infra/axi-agent-mcp/src/index.ts`: MCP model-swarm server and tool registration surface.
- `tools/axi-todo/bin/axi-todo.mjs`: Axi Todo CLI entrypoint.

## Commands

- Setup: `python -m venv backend/venv && backend/venv/bin/pip install -r backend/requirements.txt`
- Setup: `pnpm --dir frontend install`
- Setup: `pnpm --dir infra/axi-agent-mcp install`
- Setup: `pnpm --dir tools/axi-todo install`
- Start: `cd backend && uvicorn app.main:app --reload`
- Start: `pnpm --dir frontend dev`
- Start: `docker compose up -d`
- Health: `curl -fsS http://127.0.0.1:8000/health`
- Health: `curl -fsS http://127.0.0.1:8000/`
- Verify: `cd backend && pytest tests/`
- Verify: `pnpm --dir frontend build`
- Verify: `pnpm --dir infra/axi-agent-mcp test`
- Verify: `pnpm --dir tools/axi-todo verify`
- Smoke: `PYTHONPATH=backend uv run --python 3.12 --with-requirements backend/requirements.txt python -m pytest -q backend/tests/test_code_isolation_manager.py backend/tests/test_runtime_api_smoke.py`

## Environment

- Runtimes: `Python 3.10+`, `Node.js`, `pnpm`, `Docker Compose`
- Services: `FastAPI backend`, `React/Vite frontend`, `SQLite`, `Chroma`, `Axi Agent MCP`
- `MINIMAX_API_KEY`: required=no, secret=yes, source=backend/.env
- `OPENAI_API_KEY`: required=no, secret=yes, source=backend/.env
- `SECRET_KEY`: required=yes, secret=yes, source=backend/.env
- `DATABASE_URL`: required=no, secret=no, source=backend/.env
- `VECTOR_DB_PATH`: required=no, secret=no, source=backend/.env
- `REPOSITORY_PATH`: required=no, secret=no, source=backend/.env
- `AXI_AGENT_MCP_COMMAND`: required=no, secret=no, source=backend/.env

## Contracts

- Provides: `SubAgent REST API under /subagent/*`, `FastAPI health and system API under /api/v1`, `Axi Agent MCP tool surface`, `Axi Todo CLI and MCP tools`
- Consumes: `MiniMax-compatible model API`, `OpenAI-compatible model API`, `Git repositories used as SubAgent worktree roots`
- Contract files: `infra/axi-agent-mcp/docs/axi-agent-mcp-service-contract.md`, `backend/app/api/subagent.py`, `backend/app/core/code_isolation_manager.py`, `docs/PRD.md`, `docs/TDD.md`

## Current Work

- TODO: `TODO.md`
- Milestone: `MILESTONE.md`
- Active: SubAgent worktree lifecycle coverage
- Active: SubAgent dashboard hardening
- Active: Axi Todo integration
- Active: README mirror parity
- Known failure: The 2026-06-11 runtime smoke could not collect because the available Python environments do not contain the complete backend dependency set.

## Troubleshooting

- Symptom: Runtime smoke fails during test collection with a missing backend module such as fastapi or pydantic_settings.
  Diagnosis: The selected Python environment does not contain the complete backend dependency set.
  Resolution: Create or activate the backend virtual environment, install backend/requirements.txt, then rerun the smoke command.
- Symptom: SubAgent mode is unavailable while the rest of the API starts.
  Diagnosis: REPOSITORY_PATH is missing, invalid, or cannot be initialized as a Git worktree root.
  Resolution: Set REPOSITORY_PATH to an accessible Git repository root and review backend startup output.
- Symptom: Frontend cannot reach the API.
  Diagnosis: The Vite frontend and backend ports or proxy configuration are not aligned.
  Resolution: Start the backend on port 8000 for local development or use the Docker Compose ports documented in README.md.

## Decisions And Freshness

- ADR: `docs/ADR/README.md`
- Changelog: `CHANGELOG.md`
- Submit log: `docs/logs/submit/20260611-124509-batch-submit.md`
- Last verified: `2026-06-11`
- Evidence: `PYTHONPATH=backend uv run --python 3.12 --with-requirements backend/requirements.txt python -m pytest -q backend/tests/test_code_isolation_manager.py backend/tests/test_runtime_api_smoke.py passed 11 tests on 2026-06-11.`, `Warnings were deprecation-only and do not block handoff readiness.`

> Generated from `docs/project-docs.manifest.json`; edit the manifest, then regenerate this file.
