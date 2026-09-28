"""
GovernanceDecision (governance-decision/v1) Pydantic model.

Mirrors the JSON Schema at
foundation/workspace-governance/contracts/governance-decision/v1/decision.schema.json.

A ``GovernanceDecision`` is the authoritative 4-state answer to an
``ExecutionPlan`` evaluation: ``allow``, ``deny``, ``transform``, or
``pause``. ``allow`` is the only state that produces one-shot capabilities
the caller can later redeem against ``CapabilityBroker.consume``.

For ``routingDecisions`` we re-export the existing
``TaskRouteDecision`` from ``app.schemas.task``; that is the same object the
``TaskRoutingGuard`` emits, so the workflow pipeline can stay single-sourced.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.execution_plan import ExecutionPlan
from app.schemas.task import TaskRouteDecision


GOVERNANCE_DECISION_SCHEMA_VERSION = "governance-decision/v1"


DecisionEnum = Literal["allow", "deny", "transform", "pause"]


ReasonCodeEnum = Literal[
    "policy_match",
    "safety_hard_rule",
    "workspace_rule",
    "project_rule",
    "tool_metadata",
    "agent_suggestion_overridden",
    "deny_protected_branch",
    "deny_unregistered_tool",
    "deny_expired_credential",
    "deny_replay_idempotency_key",
    "deny_cross_project",
    "deny_destructive_default",
    "deny_external_message",
    "deny_force_push",
    "deny_publish",
    "transform_path_confined",
    "transform_payload_redacted",
    "transform_tool_substituted",
    "transform_rate_limited",
    "pause_human_required",
    "pause_durable_approval_required",
    "pause_budget_exceeded",
    "pause_langsmith_unavailable",
    "unknown_request",
]


class Actor(BaseModel):
    """The subject the decision is attributable to."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    subject: str = Field(..., min_length=1)
    role: Literal["owner", "operator", "workflow", "agent"]
    token_digest: str = Field(
        ..., min_length=64, max_length=64, pattern=r"^[a-f0-9]{64}$", alias="tokenDigest"
    )


class RequiredApproval(BaseModel):
    """What kind of human/durable/workflow approval is needed before retry."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    kind: Literal["human", "durable", "workflow"]
    prompt: str = Field(..., min_length=1, max_length=1024)


class GovernanceDecision(BaseModel):
    """The 4-state verdict returned by ``GovernanceGuard.evaluate_plan``.

    ``transformedPlan`` is non-null only when ``decision == "transform"`` and
    carries the rewritten plan the caller should run instead. ``requiredApproval``
    is non-null only when ``decision == "pause"``. ``allowedTools`` lists the
    tools that may be invoked under the capability issuance, even when the
    overall decision is ``deny`` for other steps.
    """

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    schema_version: Literal[GOVERNANCE_DECISION_SCHEMA_VERSION] = Field(
        default=GOVERNANCE_DECISION_SCHEMA_VERSION,
        alias="schemaVersion",
    )
    decision: DecisionEnum
    reason_codes: List[ReasonCodeEnum] = Field(..., min_length=1, unique=True, alias="reasonCodes")
    policy_version: str = Field(
        ..., pattern=r"^governance-policy/v[0-9]+$", alias="policyVersion"
    )
    plan_digest: str = Field(
        ..., min_length=64, max_length=64, pattern=r"^[a-f0-9]{64}$", alias="planDigest"
    )
    trace_id: str = Field(..., min_length=8, max_length=128, alias="traceId")
    idempotency_key: str = Field(
        ..., min_length=8, max_length=256, alias="idempotencyKey"
    )
    routing_decisions: List[TaskRouteDecision] = Field(
        ..., min_length=1, alias="routingDecisions"
    )
    allowed_tools: List[str] = Field(
        ..., min_length=1, unique=True, alias="allowedTools"
    )
    required_approval: Optional[RequiredApproval] = Field(
        None, alias="requiredApproval"
    )
    transformed_plan: Optional[ExecutionPlan] = Field(
        None, alias="transformedPlan"
    )
    expires_at: datetime = Field(..., alias="expiresAt")
    issued_at: datetime = Field(..., alias="issuedAt")
    actor: Actor


__all__ = [
    "GOVERNANCE_DECISION_SCHEMA_VERSION",
    "DecisionEnum",
    "ReasonCodeEnum",
    "Actor",
    "RequiredApproval",
    "GovernanceDecision",
    "TaskRouteDecision",
]