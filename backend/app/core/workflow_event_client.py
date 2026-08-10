"""Authenticated, minimal lifecycle events from Agent Platform to Workbench."""
from __future__ import annotations

import hashlib
import json
from typing import Any

import httpx

from app.config import settings
from app.schemas.task import TaskExecutionEvent, TaskRoute


TOPIC_BY_EVENT_TYPE = {
    "started": "agent.started",
    "progress": "agent.progress",
    "completed": "agent.result",
    "failed": "agent.failed",
    "cancelled": "agent.cancelled",
    "effect_proposed": "agent.effect_proposed",
    "approval_resumed": "agent.approval_resumed",
}
SAFE_EVENT_DATA_KEYS = frozenset(
    {
        "status",
        "progress",
        "proposalId",
        "actionDigest",
        "tool",
        "passed",
        "reasonCode",
        "errorCode",
    }
)


class WorkflowLifecycleEventError(RuntimeError):
    """The configured workflow event boundary rejected or could not accept an event."""


class WorkflowLifecycleEventPublisher:
    """Publishes only v1 lifecycle metadata, never raw prompts, outputs, or secrets."""

    def __init__(self, sink_url: str | None = None, internal_token: str | None = None, timeout: float | None = None):
        self.sink_url = sink_url if sink_url is not None else settings.WORKFLOW_EVENT_SINK_URL
        self.internal_token = internal_token if internal_token is not None else settings.WORKFLOW_EVENT_SINK_TOKEN
        self.timeout = timeout if timeout is not None else settings.WORKFLOW_EVENT_SINK_TIMEOUT_SECONDS

    @property
    def enabled(self) -> bool:
        return bool(self.sink_url)

    async def publish(self, event: TaskExecutionEvent) -> None:
        topic = TOPIC_BY_EVENT_TYPE.get(event.event_type)
        if topic is None or event.route != TaskRoute.BOUNDED_AGENT or not self.enabled:
            return
        if not self.internal_token:
            raise WorkflowLifecycleEventError("Workflow event sink is configured without an internal token.")
        if not event.trace_id or not event.idempotency_key:
            raise WorkflowLifecycleEventError("Workflow lifecycle event requires trace and idempotency identifiers.")

        payload = {
            "agentTaskId": event.task_id,
            "eventType": event.event_type,
            "route": event.route.value if event.route is not None else None,
            "policyVersion": event.policy_version,
            "data": {key: event.data[key] for key in SAFE_EVENT_DATA_KEYS if key in event.data},
        }
        event_id = _event_id(topic, event.trace_id, event.idempotency_key, payload)
        envelope = {
            "id": event_id,
            "tenantId": "workspace",
            "topic": topic,
            "payload": payload,
            "producer": "agent-platform",
            "traceId": event.trace_id,
            "idempotencyKey": event.idempotency_key,
        }
        headers = {
            "X-Axi-Internal-Token": self.internal_token,
            "X-Axi-Event-ID": event_id,
            "X-Axi-Event-Topic": topic,
            "X-Axi-Event-Producer": "agent-platform",
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(self.sink_url, json=envelope, headers=headers)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise WorkflowLifecycleEventError("Workflow event sink did not accept the Agent lifecycle event.") from exc


def _event_id(topic: str, trace_id: str, idempotency_key: str, payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(f"{topic}:{trace_id}:{idempotency_key}:{canonical}".encode()).hexdigest()
    return f"agent-{digest[:48]}"
