"""Behavior tests for ADR-005 dashboard aggregation endpoint.

These tests verify the FastAPI replacement of the Go BFF
`/api/v1/dashboard/stats` route, asserting:

  1. Path resolves under `/api/v1/` (matches the legacy DTO path).
  2. DTO field names match the Go BFF's DashboardStatsResponse exactly so
     the existing frontend code (`frontend/src/services/bff.ts`) works
     without modification.
  3. The endpoint returns 200 and all four sub-summaries.

Run:
    pytest backend/tests/test_dashboard.py -q

These tests do NOT require a running database — they use FastAPI's
TestClient with stubbed app.state managers.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List

# Make `app` importable when running from repo root.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from fastapi import FastAPI
from fastapi.testclient import TestClient

# Import the dashboard router module directly to avoid triggering the full
# app.api.__init__ chain (which pulls in pydantic_settings and the database
# models). The router itself only depends on FastAPI.
import importlib.util as _ilu
_DASHBOARD_PY = Path(__file__).resolve().parents[1] / "app" / "api" / "dashboard.py"
_spec = _ilu.spec_from_file_location("_dashboard_isolated", _DASHBOARD_PY)
_dashboard_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_dashboard_mod)
dashboard_router = _dashboard_mod.router



class _FakeAgent:
    def __init__(self, status: str):
        self.status = status


class _FakeTask:
    def __init__(self, status: str):
        self.status = status


class _FakeTool:
    def __init__(self, enabled: bool = True, category: str = "default"):
        self.enabled = enabled
        self.category = category


def _build_app(agents: List[_FakeAgent], tasks: List[_FakeTask],
               tools: List[_FakeTool], memory: Dict[str, int]) -> FastAPI:
    app = FastAPI()
    app.include_router(dashboard_router, prefix="/api/v1")

    app.state.agent_manager = SimpleNamespace(list_agents=lambda: agents)
    app.state.task_scheduler = SimpleNamespace(list_tasks=lambda: tasks)
    app.state.tool_manager = SimpleNamespace(list_tools=lambda: tools)
    app.state.memory_manager = SimpleNamespace(
        summarize=lambda: {
            "session_count": memory.get("session_count", 0),
            "total_session_messages": memory.get("total_session_messages", 0),
            "long_term_count": memory.get("long_term_count", 0),
        }
    )
    return app


def _sample() -> Dict[str, Any]:
    return {
        "agents": [_FakeAgent("idle"), _FakeAgent("busy"), _FakeAgent("stopped")],
        "tasks": [_FakeTask("pending"), _FakeTask("running"), _FakeTask("done")],
        "tools": [_FakeTool(True, "fs"), _FakeTool(False, "net"), _FakeTool(True, "fs")],
        "memory": {
            "session_count": 7,
            "total_session_messages": 142,
            "long_term_count": 19,
        },
    }


def test_dashboard_stats_path_resolves():
    """The endpoint must be reachable at /api/v1/dashboard/stats."""
    sample = _sample()
    client = TestClient(_build_app(**sample))
    resp = client.get("/api/v1/dashboard/stats")
    assert resp.status_code == 200, f"unexpected status: {resp.text}"


def test_dashboard_stats_dto_matches_go_bff():
    """Field names must match Go BFF's DashboardStatsResponse."""
    sample = _sample()
    client = TestClient(_build_app(**sample))
    body = client.get("/api/v1/dashboard/stats").json()

    # Top-level required keys
    for key in ("requestId", "agents", "tasks", "tools", "memory", "timestamp"):
        assert key in body, f"missing top-level key: {key}"

    # Agents DTO
    agents = body["agents"]
    assert agents["total"] == 3
    assert agents["idle"] == 1
    assert agents["busy"] == 1
    assert agents["stopped"] == 1
    assert "list" in agents  # may be empty list

    # Tasks DTO
    tasks = body["tasks"]
    assert tasks["total"] == 3
    assert tasks["by_status"]["pending"] == 1
    assert tasks["by_status"]["running"] == 1
    assert tasks["by_status"]["done"] == 1

    # Tools DTO
    tools = body["tools"]
    assert tools["total"] == 3
    assert tools["enabled"] == 2  # only enabled=True
    cats = {c["name"]: c["count"] for c in tools["categories"]}
    assert cats["fs"] == 2
    assert cats["net"] == 1

    # Memory DTO
    memory = body["memory"]
    assert memory["session_count"] == 7
    assert memory["total_session_messages"] == 142
    assert memory["long_term_count"] == 19


def test_dashboard_stats_handles_empty_state():
    """Empty state must not crash; all totals must be 0."""
    empty = {"agents": [], "tasks": [], "tools": [], "memory": {}}
    client = TestClient(_build_app(**empty))
    body = client.get("/api/v1/dashboard/stats").json()
    assert body["agents"]["total"] == 0
    assert body["tasks"]["total"] == 0
    assert body["tasks"]["by_status"] == {}
    assert body["tools"]["total"] == 0
    assert body["tools"]["enabled"] == 0
    assert body["tools"]["categories"] == []
    assert body["memory"]["session_count"] == 0


def test_dashboard_stats_returns_request_id():
    """Each call returns a UUID request id for tracing."""
    client = TestClient(_build_app(**_sample()))
    body = client.get("/api/v1/dashboard/stats").json()
    import uuid as _uuid
    # Parse to ensure it's a valid UUID
    _uuid.UUID(body["requestId"])
