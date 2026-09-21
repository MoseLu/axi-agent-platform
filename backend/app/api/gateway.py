"""Gateway-level monitoring, logging, and health check endpoints.

This module provides:
- Request ID injection and tracing
- Structured request/response logging
- Prometheus-style metrics
- Enhanced health check with component status
- Runtime verification utilities

Replaces the Go BFF's internal/metrics and internal/middleware packages
per ADR-005.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Callable, Dict, Optional

from fastapi import FastAPI, Request, Response
from fastapi.routing import APIRoute


# ---------------------------------------------------------------------------
# Metrics (Prometheus-style, in-process)
# ---------------------------------------------------------------------------


class GatewayMetrics:
    """In-process metrics collector matching the Go BFF's prometheus counters."""

    def __init__(self) -> None:
        self._requests_total: Dict[str, int] = {}
        self._request_duration: Dict[str, list[float]] = {}
        self._downstream_calls: Dict[str, int] = {}
        self._downstream_duration: Dict[str, list[float]] = {}
        self._lock = asyncio.Lock()

    async def record_request(
        self, method: str, path: str, status: int, duration_ms: float
    ) -> None:
        key = f"{method}:{path}:{status}"
        async with self._lock:
            self._requests_total[key] = self._requests_total.get(key, 0) + 1
            if path not in self._request_duration:
                self._request_duration[path] = []
            self._request_duration[path].append(duration_ms)
            # Keep only last 1000 samples per path
            if len(self._request_duration[path]) > 1000:
                self._request_duration[path] = self._request_duration[path][-1000:]

    async def record_downstream(
        self, service: str, path: str, status: str, duration_ms: float
    ) -> None:
        key = f"{service}:{path}:{status}"
        async with self._lock:
            self._downstream_calls[key] = self._downstream_calls.get(key, 0) + 1
            if path not in self._downstream_duration:
                self._downstream_duration[path] = []
            self._downstream_duration[path].append(duration_ms)
            if len(self._downstream_duration[path]) > 1000:
                self._downstream_duration[path] = self._downstream_duration[path][-1000:]

    def get_metrics(self) -> Dict[str, Any]:
        """Return current metrics snapshot for /metrics endpoint."""
        return {
            "http_requests_total": dict(self._requests_total),
            "http_request_duration_samples": {
                path: len(samples) for path, samples in self._request_duration.items()
            },
            "downstream_calls_total": dict(self._downstream_calls),
            "downstream_duration_samples": {
                path: len(samples) for path, samples in self._downstream_duration.items()
            },
        }


# Global metrics instance
_gateway_metrics = GatewayMetrics()


# ---------------------------------------------------------------------------
# Request ID middleware
# ---------------------------------------------------------------------------


async def request_id_middleware(request: Request, call_next: Callable) -> Response:
    """Inject X-Request-ID header for tracing, matching Go BFF's RequestID middleware."""
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    request.state.request_id = request_id

    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


# ---------------------------------------------------------------------------
# Request logging middleware
# ---------------------------------------------------------------------------


async def logging_middleware(request: Request, call_next: Callable) -> Response:
    """Structured request logging matching Go BFF's Logger middleware."""
    from fastapi import Request
    import logging

    logger = logging.getLogger("gateway.access")
    start = time.perf_counter()

    method = request.method
    path = request.url.path

    response = await call_next(request)

    duration_ms = (time.perf_counter() - start) * 1000.0
    status = response.status_code
    request_id = getattr(request.state, "request_id", "unknown")

    log_level = logging.INFO
    if status >= 500:
        log_level = logging.ERROR
    elif status >= 400:
        log_level = logging.WARNING

    logger.log(
        log_level,
        f"method={method} path={path} status={status} "
        f"duration_ms={duration_ms:.2f} request_id={request_id} "
        f"client_ip={request.client.host if request.client else 'unknown'}",
    )

    # Record metrics
    await _gateway_metrics.record_request(method, path, status, duration_ms)

    return response


# ---------------------------------------------------------------------------
# Health check endpoint helpers
# ---------------------------------------------------------------------------


async def check_component_health(
    agent_manager: Any, task_scheduler: Any, tool_manager: Any, memory_manager: Any
) -> Dict[str, Any]:
    """Check health of all major components. Mirrors Go BFF's Health handler."""
    components = {}
    overall_healthy = True

    # Check agent manager
    try:
        agents = await agent_manager.list_agents()
        components["agent_manager"] = {
            "status": "healthy",
            "agent_count": len(agents),
        }
    except Exception as e:
        components["agent_manager"] = {"status": "unhealthy", "error": str(e)}
        overall_healthy = False

    # Check task scheduler
    try:
        tasks = await task_scheduler.list_tasks()
        components["task_scheduler"] = {
            "status": "healthy",
            "task_count": len(tasks),
        }
    except Exception as e:
        components["task_scheduler"] = {"status": "unhealthy", "error": str(e)}
        overall_healthy = False

    # Check tool manager
    try:
        tools = await tool_manager.list_tools()
        enabled = sum(1 for t in tools if getattr(t, "enabled", True))
        components["tool_manager"] = {
            "status": "healthy",
            "total_tools": len(tools),
            "enabled_tools": enabled,
        }
    except Exception as e:
        components["tool_manager"] = {"status": "unhealthy", "error": str(e)}
        overall_healthy = False

    # Check memory manager
    try:
        summary = await memory_manager.summarize()
        components["memory_manager"] = {
            "status": "healthy",
            "sessions": summary.get("session_count", 0) if isinstance(summary, dict) else 0,
        }
    except Exception as e:
        components["memory_manager"] = {"status": "unhealthy", "error": str(e)}
        overall_healthy = False

    return {
        "healthy": overall_healthy,
        "components": components,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Metrics endpoint handler
# ---------------------------------------------------------------------------


def get_metrics_summary() -> Dict[str, Any]:
    """Return Prometheus-style metrics summary for /metrics endpoint."""
    metrics = _gateway_metrics.get_metrics()
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
    }
