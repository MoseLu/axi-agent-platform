"""Persistence boundary for authoritative workflow route decisions."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import TaskRouteDecisionRecord
from app.schemas.task import Task


async def persist_task_route_decision(session: AsyncSession, task: Task) -> None:
    """Store the decision metadata, never the bearer-like route credential."""
    decision = task.route_decision
    if decision is None:
        raise ValueError("cannot persist a task without an authoritative route decision")

    serialized = decision.model_dump(by_alias=True, mode="json")
    record = await session.get(TaskRouteDecisionRecord, task.id)
    if record is None:
        record = TaskRouteDecisionRecord(task_id=task.id)
        session.add(record)

    record.schema_version = decision.schema_version
    record.route = decision.route.value
    record.reason_code = decision.reason_code
    record.policy_version = decision.policy_version
    record.trace_id = decision.trace_id
    record.idempotency_key = decision.idempotency_key
    record.decision_json = serialized
    await session.commit()
