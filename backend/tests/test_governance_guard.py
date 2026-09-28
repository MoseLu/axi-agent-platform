"""Tests for ``app.core.governance_guard``.

Coverage:

* An ``allow`` plan: capabilities are issued, decision is ``allow``,
  side-channel carries one ``capability_id`` per step.
* An unknown-tool step forces the plan to ``deny``; no capability is
  issued for any step.
* A ``destructive``-danger step forces the plan to ``pause`` and adds
  the ``pause_human_required`` reason code.
* A redaction-trigger step switches the plan to ``transform``; the
  rewritten ``transformedPlan`` carries the redacted parameters.

Each test builds its own manifest to keep the assertions tight and avoid
coupling to the runtime default.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, List

import pytest

from app.core.capability_broker import CapabilityBroker, ToolManifest, ToolManifestEntry
from app.core.governance_guard import GovernanceGuard
from app.schemas.execution_plan import ExecutionPlan, ExecutionPlanStep
from app.schemas.governance_decision import (
    Actor,
    GovernanceDecision,
    RequiredApproval,
)
from app.schemas.task import (
    TaskExecutionLimits,
    TaskRoute,
    TaskRouteDecision,
)


# ---------- fixtures ----------


def _make_route_decision() -> TaskRouteDecision:
    return TaskRouteDecision(
        schema_version="task-execution-routing/v1",
        route=TaskRoute.BOUNDED_AGENT,
        reason_code="policy_match",
        policy_version="task-execution-routing/v1",
        trace_id="trace-deadbeef-00000000",
        idempotency_key="idem-deadbeef-00000000",
        context_refs=[],
        tool_allowlist=["write_file", "read_file", "drop_database"],
        sandbox="read_only",
        limits=TaskExecutionLimits(
            maxSteps=10,
            maxWallTimeMs=60_000,
            maxModelTokens=100_000,
            maxEstimatedCost=10.0,
        ),
    )


def _make_actor() -> Actor:
    return Actor(
        subject="agent-1",
        role="agent",
        tokenDigest="a" * 64,
    )


def _make_plan(steps: List[Dict[str, Any]]) -> ExecutionPlan:
    return ExecutionPlan(
        schemaVersion="execution-plan/v1",
        planId="plan-deadbeef-00000000",
        traceId="trace-deadbeef-00000000",
        intent="unit-test plan",
        steps=[ExecutionPlanStep(**s) for s in steps],
        contextRefs=[],
        assumptions=[],
        successCriteria=["all steps succeed"],
        issuedBy="agent-1",
    )


def _make_manifest() -> ToolManifest:
    return ToolManifest(
        manifest_id="test-guard-2026-09-29",
        issued_at=datetime.now(timezone.utc),
        tools={
            "read_file": ToolManifestEntry(
                tool_id="read_file", danger_level="read", side_effects=[]
            ),
            "write_file": ToolManifestEntry(
                tool_id="write_file",
                danger_level="local_write",
                side_effects=["writes_filesystem"],
            ),
            "drop_database": ToolManifestEntry(
                tool_id="drop_database",
                danger_level="destructive",
                side_effects=["drops_database"],
            ),
        },
        quarantine=["legacy_uncaught_tool"],
    )


@pytest.fixture
def broker() -> CapabilityBroker:
    return CapabilityBroker(_make_manifest())


@pytest.fixture
def guard(broker: CapabilityBroker) -> GovernanceGuard:
    return GovernanceGuard(broker=broker)


# ---------- allow ----------


def test_allow_plan_with_read_step(guard: GovernanceGuard, broker: CapabilityBroker):
    plan = _make_plan(
        [
            {
                "tool": "read_file",
                "parameters": {"path": "/etc/hosts"},
                "expectedEffect": "read /etc/hosts",
                "idempotencyKey": "idem-allow-read-00000000",
            }
        ]
    )
    decision = guard.evaluate_plan(
        plan,
        subject="agent-1",
        trace_id="trace-deadbeef-00000000",
        idempotency_key="idem-guard-00000000000000",
        actor=_make_actor(),
        routing_decision=_make_route_decision(),
    )

    assert isinstance(decision, GovernanceDecision)
    assert decision.decision == "allow"
    assert "read_file" in decision.allowed_tools
    # The side-channel MUST carry one issued capability.
    issued = getattr(decision, "_issued_capabilities", [])
    assert len(issued) == 1
    assert issued[0]["tool"] == "read_file"
    assert issued[0]["capabilityId"] is not None
    assert broker.has_capability(issued[0]["capabilityId"])


# ---------- deny ----------


def test_deny_plan_with_unknown_tool(guard: GovernanceGuard, broker: CapabilityBroker):
    plan = _make_plan(
        [
            {
                "tool": "totally_made_up_tool",
                "parameters": {"foo": "bar"},
                "expectedEffect": "do something",
                "idempotencyKey": "idem-deny-unknown-00000",
            }
        ]
    )
    decision = guard.evaluate_plan(
        plan,
        subject="agent-1",
        trace_id="trace-deadbeef-00000000",
        idempotency_key="idem-guard-deny-00000000",
        actor=_make_actor(),
        routing_decision=_make_route_decision(),
    )

    assert decision.decision == "deny"
    assert "deny_unregistered_tool" in decision.reason_codes
    # No capability should have been issued.
    issued = getattr(decision, "_issued_capabilities", [])
    assert issued == []


# ---------- pause ----------


def test_pause_plan_with_destructive_tool(guard: GovernanceGuard, broker: CapabilityBroker):
    plan = _make_plan(
        [
            {
                "tool": "drop_database",
                "parameters": {"name": "production"},
                "expectedEffect": "drop production database",
                "idempotencyKey": "idem-pause-destructive",
            }
        ]
    )
    decision = guard.evaluate_plan(
        plan,
        subject="agent-1",
        trace_id="trace-deadbeef-00000000",
        idempotency_key="idem-guard-pause-0000000",
        actor=_make_actor(),
        routing_decision=_make_route_decision(),
    )

    assert decision.decision == "pause"
    assert "pause_human_required" in decision.reason_codes
    assert isinstance(decision.required_approval, RequiredApproval)
    assert decision.required_approval.kind == "human"
    # No capability issued for the destructive step.
    issued = getattr(decision, "_issued_capabilities", [])
    assert issued == []


# ---------- transform ----------


def test_transform_plan_redacts_payload(guard: GovernanceGuard, broker: CapabilityBroker):
    """The stub redactor replaces ``api_key``/``token``/``password``/``secret``
    with ``"<redacted>"``. The plan switches to ``transform`` and the
    ``transformedPlan.steps[0].parameters`` differs from the input."""
    plan = _make_plan(
        [
            {
                "tool": "write_file",
                "parameters": {
                    "path": "/tmp/secrets.txt",
                    "content": "ignored",
                    "api_key": "AKIA-real-secret",
                },
                "expectedEffect": "write a file containing an api_key",
                "idempotencyKey": "idem-transform-redact",
            }
        ]
    )
    decision = guard.evaluate_plan(
        plan,
        subject="agent-1",
        trace_id="trace-deadbeef-00000000",
        idempotency_key="idem-guard-transform-000",
        actor=_make_actor(),
        routing_decision=_make_route_decision(),
    )

    assert decision.decision == "transform"
    assert decision.transformed_plan is not None
    assert decision.transformed_plan.steps[0].parameters["api_key"] == "<redacted>"
    assert plan.steps[0].parameters["api_key"] == "AKIA-real-secret"
    # The issued capability should be bound to the redacted action digest.
    issued = getattr(decision, "_issued_capabilities", [])
    assert len(issued) == 1
    assert issued[0]["tool"] == "write_file"


# ---------- mixed plan ----------


def test_mixed_plan_allows_read_and_denies_unknown(guard: GovernanceGuard, broker: CapabilityBroker):
    plan = _make_plan(
        [
            {
                "tool": "read_file",
                "parameters": {"path": "/etc/hosts"},
                "expectedEffect": "read /etc/hosts",
                "idempotencyKey": "idem-mixed-allow-read",
            },
            {
                "tool": "totally_made_up_tool",
                "parameters": {"foo": "bar"},
                "expectedEffect": "do something",
                "idempotencyKey": "idem-mixed-deny-unknown",
            },
        ]
    )
    decision = guard.evaluate_plan(
        plan,
        subject="agent-1",
        trace_id="trace-deadbeef-00000000",
        idempotency_key="idem-guard-mixed-000000",
        actor=_make_actor(),
        routing_decision=_make_route_decision(),
    )

    # One step allowed, one step denied: overall decision is deny.
    assert decision.decision == "deny"
    assert "deny_unregistered_tool" in decision.reason_codes
    # But the read step DID get a capability.
    issued = getattr(decision, "_issued_capabilities", [])
    assert len(issued) == 1
    assert issued[0]["tool"] == "read_file"


# ---------- routing prerequisite ----------


def test_guard_rejects_non_bounded_route(guard: GovernanceGuard):
    from app.schemas.task import TaskExecutionLimits

    non_bounded = TaskRouteDecision(
        schema_version="task-execution-routing/v1",
        route=TaskRoute.WORKFLOW,
        reason_code="workflow_required",
        policy_version="task-execution-routing/v1",
        trace_id="trace-deadbeef-00000000",
        idempotency_key="idem-deadbeef-00000000",
        context_refs=[],
        tool_allowlist=[],
        sandbox="none",
        limits=TaskExecutionLimits(
            maxSteps=0,
            maxWallTimeMs=0,
            maxModelTokens=0,
            maxEstimatedCost=0,
        ),
    )
    plan = _make_plan(
        [
            {
                "tool": "read_file",
                "parameters": {"path": "/etc/hosts"},
                "expectedEffect": "read /etc/hosts",
                "idempotencyKey": "idem-routing-check-000",
            }
        ]
    )
    with pytest.raises(ValueError):
        guard.evaluate_plan(
            plan,
            subject="agent-1",
            trace_id="trace-deadbeef-00000000",
            idempotency_key="idem-guard-routing-0000",
            actor=_make_actor(),
            routing_decision=non_bounded,
        )