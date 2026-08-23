"""Dashboard aggregation endpoint.

This module is the FastAPI equivalent of the legacy Go BFF
`services/agent-bff/.../dashboard.go` handler. Per ADR-005, the Go BFF
is merged into the Agent Platform FastAPI service; the
`/api/v1/dashboard/stats` DTO contract is preserved verbatim.

The frontend (frontend/src/services/bff.ts) already calls
`/api/v1/dashboard/stats` and reaches this endpoint via the existing Vite
proxy at AXI_AGENT_BACKEND_URL (default http://127.0.0.1:8001).
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/dashboard/stats")
async def get_dashboard_stats(request: Request) -> Dict[str, Any]:
    """Aggregate dashboard statistics for the Agent Platform frontend.

    Replaces the four parallel calls previously issued by the frontend:
        - agentsApi.list()
        - tasksApi.list()
        - toolsApi.list()
        - systemApi.getStats()
        - memoryApi summary

    Returns a single DTO matching the Go BFF's DashboardStatsResponse
    field-for-field so the existing frontend code works without change.
    """
    request_id = getattr(request.state, "request_id", None) or _new_request_id()

    agents_svc = request.app.state.agent_manager
    tasks_svc = request.app.state.task_scheduler
    tool_manager = request.app.state.tool_manager
    memory_manager = request.app.state.memory_manager

    started = time.perf_counter()

    # Concurrent fan-out with a bounded concurrency limiter (mirrors the Go
    # BFF ServiceConcurrencyLimiter; default 8 to match BFF defaults).
    sem = asyncio.Semaphore(8)

    async def _bounded(coro):
        async with sem:
            return await coro

    try:
        agent_stats, task_stats, tool_stats, memory_stats = await asyncio.gather(
            _bounded(_summarize_agents(agents_svc)),
            _bounded(_summarize_tasks(tasks_svc)),
            _bounded(_summarize_tools(tool_manager)),
            _bounded(_summarize_memory(memory_manager)),
            return_exceptions=False,
        )
    except Exception as exc:  # noqa: BLE001 - aggregated endpoint, surface as 500
        duration_ms = (time.perf_counter() - started) * 1000.0
        return _error_response(
            status_code=500,
            code="upstream_error",
            message="Failed to load dashboard data",
            request_id=request_id,
            duration_ms=duration_ms,
            cause=repr(exc),
        )

    duration_ms = (time.perf_counter() - started) * 1000.0

    return {
        "requestId": request_id,
        "agents": agent_stats,
        "tasks": task_stats,
        "tools": tool_stats,
        "memory": memory_stats,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "_meta": {
            "duration_ms": round(duration_ms, 2),
            "aggregated": True,
        },
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _new_request_id() -> str:
    import uuid
    return str(uuid.uuid4())


def _error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    request_id: str,
    duration_ms: float,
    cause: Optional[str] = None,
) -> Dict[str, Any]:
    # Mirrors dto.NewErrorResponse from the Go BFF.
    return {
        "status_code": status_code,
        "body": {
            "error": {
                "code": code,
                "message": message,
                "requestId": request_id,
                "cause": cause,
                "duration_ms": round(duration_ms, 2),
            }
        },
    }


async def _summarize_agents(agent_manager: Any) -> Dict[str, Any]:
    """Build AgentStats. Mirrors dto.AgentStats from the Go BFF."""
    agents = await _safe_call(lambda: agent_manager.list_agents())
    items = agents or []
    by_status: Dict[str, int] = {}
    for a in items:
        status = getattr(a, "status", "unknown")
        by_status[status] = by_status.get(status, 0) + 1
    return {
        "total": len(items),
        "idle": by_status.get("idle", 0),
        "busy": by_status.get("busy", 0),
        "paused": by_status.get("paused", 0),
        "stopped": by_status.get("stopped", 0),
        # `list` is omitted by default to keep the payload small.
        "list": [],
    }


async def _summarize_tasks(task_scheduler: Any) -> Dict[str, Any]:
    """Build TaskStats. Mirrors dto.TaskStats."""
    tasks = await _safe_call(lambda: task_scheduler.list_tasks())
    items = tasks or []
    by_status: Dict[str, int] = {}
    for t in items:
        s = getattr(t, "status", "unknown")
        by_status[s] = by_status.get(s, 0) + 1
    return {
        "total": len(items),
        "by_status": by_status,
        "recent_list": [],
    }


async def _summarize_tools(tool_manager: Any) -> Dict[str, Any]:
    """Build ToolStats. Mirrors dto.ToolStats."""
    tools = await _safe_call(lambda: tool_manager.list_tools())
    items = tools or []
    enabled = sum(1 for t in items if getattr(t, "enabled", True))
    categories: Dict[str, int] = {}
    for t in items:
        cat = getattr(t, "category", "uncategorized")
        categories[cat] = categories.get(cat, 0) + 1
    return {
        "total": len(items),
        "enabled": enabled,
        "categories": [
            {"name": name, "count": count} for name, count in sorted(categories.items())
        ],
    }


async def _summarize_memory(memory_manager: Any) -> Dict[str, Any]:
    """Build MemoryStats. Mirrors dto.MemoryStats."""
    summary = await _safe_call(lambda: memory_manager.summarize())
    if not isinstance(summary, dict):
        summary = {}
    return {
        "session_count": int(summary.get("session_count", 0)),
        "total_session_messages": int(summary.get("total_session_messages", 0)),
        "long_term_count": int(summary.get("long_term_count", 0)),
    }


async def _safe_call(fn):
    """Run a sync lambda off the event loop and never raise."""
    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(None, fn)
    except Exception:
        return None
