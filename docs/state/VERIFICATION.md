# Axi Agent Platform — Verification Log

This document records the verification evidence for the Axi Agent Platform
project. It is referenced by `docs/project-docs.manifest.json` as the
canonical verification artifact.

**Status:** partial — see "What is verified" and "What is not yet verified"
below. Per AR-HANDOFF rules, status must reflect the actual evidence, not a
checkbox.

## Last verified: 2026-08-23

## What is verified (this session)

| Surface | Command | Result |
|---|---|---|
| FastAPI dashboard aggregation route | `python3 -m pytest backend/tests/test_dashboard.py -q` | **4 passed in 0.10s** — path resolution, DTO field-by-field match with Go BFF, empty-state handling, request_id UUID format. |
| Hook wrapper path resolution | `node --test scripts/workspace-git-hooks.test.mjs` | **14 passed / 0 failed** including 2 new tests verifying walk-up governance-root discovery contract. |
| Audit script physical-root fix | `node scripts/workspace-audit.mjs` | Surface area now covers `/Volumes/code/workspace/{infra,projects,products,shared,tools,references}`; errors=32 (real drift, not false-green). |
| Unified Axi Todo model and desktop surface | `pnpm --dir tools/axi-todo verify` | **Passed** — Node syntax and 61 tests, Swift store smoke, TypeScript check, frontend build, and Swift desktop build. |
| PostgreSQL unified-task migration | `node tools/axi-todo/bin/axi-todo-migrate-postgres.mjs` + read-only store query | **Passed** — `axi_todo` now exposes the personal-task columns; 33 existing Agent tasks remain `agent`, cancelled tasks project to `executionStatus=idle`, and legacy history receives stable IDs. |

## What is NOT verified (open work for owner or future sessions)

| Surface | Why |
|---|---|
| Full FastAPI startup | `pydantic_settings` is not installed in the local Python environment. The `pytest` tests for `dashboard.py` pass in isolation because they stub `app.state` managers, but `uvicorn app.main:app` cannot start. Owner must `pip install pydantic_settings` (or refresh `backend/requirements.txt`) before browser verification. |
| Go BFF full removal | Per ADR-005, the Go BFF (`services/agent-bff/`) is retained until browser verification of the FastAPI replacement succeeds. |
| Frontend → FastAPI → `/api/v1/dashboard/stats` browser smoke test | Requires the FastAPI service to be running and a browser. Out of scope for this session. |
| `pnpm build` (frontend) | Not re-run this session. Owner accepts the existing state. |
| `services/agent-bff` `[no test files]` packages | The Go packages still have no behavior tests because the merge target is FastAPI per ADR-005. |

## Acceptance delta vs the GO BFF DTO

Field-by-field check (from `services/agent-bff/internal/dto/dashboard.go`):

| Go field | FastAPI field | Match |
|---|---|---|
| `RequestId` | `requestId` | ✓ |
| `Agents` (Total/Idle/Busy/Paused/Stopped/List) | identical | ✓ |
| `Tasks` (Total/ByStatus/RecentList) | identical (Go `ByStatus` → JSON `by_status`; FastAPI uses `by_status` directly) | ✓ |
| `Tools` (Total/Enabled/Categories) | identical | ✓ |
| `Memory` (SessionCount/TotalSessionMessages/LongTermCount) | identical | ✓ |
| `Timestamp` | identical (ISO8601 UTC) | ✓ |

## Action items

1. **Owner:** install `pydantic_settings` so `uvicorn app.main:app` boots.
2. **Owner:** run the frontend dev server + FastAPI and verify the dashboard
   loads through the canonical `/api/v1/dashboard/stats` path. Once that
   passes, the Go BFF directory can be archived.
3. **Next session:** refresh this document after browser verification.
