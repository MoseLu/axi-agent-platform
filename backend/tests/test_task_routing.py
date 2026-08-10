import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.task_routing import TaskRoutingError, TaskRoutingGuard
from app.core.task_scheduler import TaskScheduler
from app.core.strategy_planner import StrategyPlanner
from app.main import app
from app.schemas.task import (
    TaskCreate,
    TaskExecutionLimits,
    TaskRoute,
    TaskRouteCredential,
    TaskRouteDecision,
)


def make_bounded_envelope(secret: str = "test-route-secret"):
    decision = TaskRouteDecision(
        route=TaskRoute.BOUNDED_AGENT,
        reasonCode="read_only_open_exploration",
        policyVersion="task-execution-routing/v1",
        traceId="trace-routing-test",
        idempotencyKey="idempotency-routing-test",
        contextRefs=[{"id": "doc-1", "version": "v1"}],
        toolAllowlist=["swarm_git_status"],
        sandbox="read_only",
        limits=TaskExecutionLimits(maxSteps=2, maxWallTimeMs=60_000, maxModelTokens=1_000, maxEstimatedCost=1),
    )
    now = datetime.now(timezone.utc)
    credential = TaskRouteCredential(
        credentialId="credential-routing-test",
        subject="axi-workbench-workflow-engine",
        decisionDigest=TaskRoutingGuard.decision_digest(decision),
        issuedAt=now.isoformat(),
        expiresAt=(now + timedelta(minutes=5)).isoformat(),
        signature="0" * 64,
    )
    credential.signature = TaskRoutingGuard.credential_signature(credential, secret)
    return decision, credential


def test_legacy_auto_strategy_and_subagent_hint_cannot_bypass_workflow_route():
    scheduler = TaskScheduler()
    scheduler.set_dependencies(None, None, None, task_routing_guard=TaskRoutingGuard("test-route-secret", "test-event-token"))

    task = asyncio.run(
        scheduler.create_task(
            TaskCreate(
                title="legacy direct task",
                strategy_mode="auto",
                use_subagent_mode=True,
            )
        )
    )

    assert task.route_decision.route == TaskRoute.ESCALATE
    assert task.route_decision.reason_code == "workflow_required"
    assert task.error_message == "workflow_required"
    assert task.status.value == "paused"
    assert scheduler._task_queue.empty()


def test_hard_write_signal_overrides_a_signed_bounded_agent_request():
    decision, credential = make_bounded_envelope()
    scheduler = TaskScheduler()
    scheduler.set_dependencies(None, None, None, task_routing_guard=TaskRoutingGuard("test-route-secret", "test-event-token"))

    task = asyncio.run(
        scheduler.create_task(
            TaskCreate(
                title="write requested",
                input_data={"local_path_unenumerable": True, "read_only": True, "requests_write": True},
                routeDecision=decision,
                routeCredential=credential,
            )
        )
    )

    assert task.route_decision.route == TaskRoute.ESCALATE
    assert task.route_decision.reason_code == "write_requested"
    assert task.error_message == "approval_required"


def test_signed_read_only_route_is_the_only_route_that_is_queued():
    decision, credential = make_bounded_envelope()
    scheduler = TaskScheduler()
    scheduler.set_dependencies(None, None, None, task_routing_guard=TaskRoutingGuard("test-route-secret", "test-event-token"))

    task = asyncio.run(
        scheduler.create_task(
            TaskCreate(
                title="read-only exploration",
                input_data={"local_path_unenumerable": True, "read_only": True},
                routeDecision=decision,
                routeCredential=credential,
            )
        )
    )

    assert task.route_decision.route == TaskRoute.BOUNDED_AGENT
    assert task.status.value == "pending"
    assert not scheduler._task_queue.empty()


def test_client_supplied_non_agent_route_is_not_a_legacy_execution_authority():
    decision, _ = make_bounded_envelope()
    decision.route = TaskRoute.WORKFLOW
    scheduler = TaskScheduler()
    scheduler.set_dependencies(None, None, None, task_routing_guard=TaskRoutingGuard("test-route-secret", "test-event-token"))

    task = asyncio.run(
        scheduler.create_task(
            TaskCreate(
                title="client supplied workflow route",
                input_data={"local_path_unenumerable": True, "read_only": True},
                routeDecision=decision,
            )
        )
    )

    assert task.route_decision.route == TaskRoute.ESCALATE
    assert task.route_decision.reason_code == "workflow_required"
    assert task.status.value == "paused"
    assert not asyncio.run(scheduler.resume_task(task.id))


def test_tool_and_budget_guards_stop_unapproved_or_over_budget_runs():
    decision, credential = make_bounded_envelope()
    guard = TaskRoutingGuard("test-route-secret", "test-event-token")

    guard.authorize_bounded_run(decision, credential, "swarm_git_status", "test-event-token")
    with pytest.raises(TaskRoutingError, match="Tool is not allowed"):
        guard.authorize_bounded_run(decision, credential, "swarm_write_file", "test-event-token")
    guard.authorize_bounded_run(decision, credential, "swarm_git_status", "test-event-token")
    with pytest.raises(TaskRoutingError, match="budget exceeded"):
        guard.authorize_bounded_run(decision, credential, "swarm_git_status", "test-event-token")


def test_effect_proposal_is_validated_as_a_proposal_not_an_executed_action():
    decision, credential = make_bounded_envelope()
    guard = TaskRoutingGuard("test-route-secret", "test-event-token")
    action = {"kind": "document_write", "target": "docs/example.md", "parameters": {"content": "x"}}
    proposal = {
        "schemaVersion": "task-execution-routing/v1",
        "proposalId": "proposal-routing-test",
        "traceId": decision.trace_id,
        "idempotencyKey": decision.idempotency_key,
        "summary": "Request a document change for approval.",
        "action": action,
        "actionDigest": TaskRoutingGuard.action_digest(action),
    }

    guard.authorize_bounded_route(decision, credential, "test-event-token")
    validated = guard.validate_effect_proposal(proposal, decision)

    assert validated.action["kind"] == "document_write"
    assert validated.action_digest == proposal["actionDigest"]


def test_direct_tasks_api_returns_machine_readable_workflow_required():
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/tasks",
            json={
                "title": "legacy direct API request",
                "strategy_mode": "auto",
                "use_subagent_mode": True,
            },
        )

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["code"] == "workflow_required"
    assert detail["routeDecision"]["route"] == "escalate"


def test_legacy_strategy_planner_is_deterministic_advice_not_model_control_flow():
    class ForbiddenConnector:
        async def chat(self, **_kwargs):
            raise AssertionError("legacy strategy planner must not invoke a model")

    result = asyncio.run(
        StrategyPlanner(ForbiddenConnector()).analyze_task(
            "Implement an export feature",
            "Read repository context only.",
            {"local_path_unenumerable": True, "read_only": True},
        )
    )

    assert result["advisoryOnly"] is True
    assert result["controlFlowOwner"] == "workflow-engine"
    assert result["routeSignals"] == {
        "pathEnumerable": False,
        "localPathUnenumerable": True,
        "readOnly": True,
        "requestsCommand": False,
        "requestsWrite": False,
        "requestsExternalSideEffect": False,
        "requestsPrivilegeEscalation": False,
    }
