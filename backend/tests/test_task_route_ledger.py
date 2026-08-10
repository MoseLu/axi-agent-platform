import asyncio

from app.core.task_route_ledger import persist_task_route_decision
from app.schemas.task import Task, TaskExecutionLimits, TaskRouteDecision


class FakeSession:
    def __init__(self):
        self.records = {}
        self.commits = 0

    async def get(self, _model, task_id):
        return self.records.get(task_id)

    def add(self, record):
        self.records[record.task_id] = record

    async def commit(self):
        self.commits += 1


def test_route_ledger_persists_authoritative_metadata_without_route_credential():
    decision = TaskRouteDecision(
        route="bounded_agent",
        reasonCode="read_only_open_exploration",
        policyVersion="task-execution-routing/v1",
        traceId="trace-ledger-test",
        idempotencyKey="idempotency-ledger-test",
        contextRefs=[],
        toolAllowlist=["swarm_git_status"],
        sandbox="read_only",
        limits=TaskExecutionLimits(maxSteps=2, maxWallTimeMs=60_000, maxModelTokens=1_000, maxEstimatedCost=1),
    )
    task = Task(id="task-ledger-1", title="persist route", routeDecision=decision)
    session = FakeSession()

    asyncio.run(persist_task_route_decision(session, task))

    record = session.records[task.id]
    assert session.commits == 1
    assert record.route == "bounded_agent"
    assert record.trace_id == "trace-ledger-test"
    assert record.decision_json["policyVersion"] == "task-execution-routing/v1"
    assert "routeCredential" not in record.decision_json
