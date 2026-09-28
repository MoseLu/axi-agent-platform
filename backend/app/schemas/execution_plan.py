"""
ExecutionPlan (execution-plan/v1) Pydantic model.

Mirrors the JSON Schema at
foundation/workspace-governance/contracts/governance-decision/v1/execution-plan.schema.json.

The wire format uses camelCase aliases (`planId`, `traceId`, etc.); the Python
attribute names stay snake_case (`plan_id`, `trace_id`). `extra="forbid"` is
deliberate: any field the schema does not declare must be rejected at the
boundary so the Agent runtime cannot smuggle extra data into the
Governance Guard.
"""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


EXECUTION_PLAN_SCHEMA_VERSION = "execution-plan/v1"


class ContextRef(BaseModel):
    """A reference to an external context (prompt template, dataset, tool)."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    id: str = Field(..., min_length=1)
    version: str = Field(..., min_length=1)
    uri: Optional[str] = Field(None, max_length=2048, alias="uri")


class ExecutionPlanStep(BaseModel):
    """One tool call the Agent wants to make.

    `expectedEffect` is a short human-readable description of what the Agent
    intends the side-effect to be (e.g. ``"create file src/foo.py"``). The
    Governance Guard compares it against the manifest to decide whether the
    step is ``allow``/``deny``/``pause``/``transform``.
    """

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    tool: str = Field(..., min_length=1)
    parameters: Dict[str, Any] = Field(default_factory=dict)
    expected_effect: str = Field(..., min_length=1, max_length=256, alias="expectedEffect")
    idempotency_key: Optional[str] = Field(
        None, min_length=8, max_length=256, alias="idempotencyKey"
    )
    estimated_cost: Optional[float] = Field(
        None, ge=0, le=10000, alias="estimatedCost"
    )


class ExecutionPlan(BaseModel):
    """A batch of tool calls the Agent wants to make under one decision.

    `issuedBy` is the subject that produced the plan (typically an Agent id,
    a workflow id, or an operator id). The Governance Guard will refuse to
    evaluate a plan whose ``issuedBy`` is not on the actor allowlist.
    """

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    schema_version: Literal[EXECUTION_PLAN_SCHEMA_VERSION] = Field(
        default=EXECUTION_PLAN_SCHEMA_VERSION,
        alias="schemaVersion",
    )
    plan_id: str = Field(..., min_length=8, max_length=128, alias="planId")
    trace_id: str = Field(..., min_length=8, max_length=128, alias="traceId")
    intent: str = Field(..., min_length=1, max_length=512)
    steps: List[ExecutionPlanStep] = Field(..., min_length=1)
    context_refs: List[ContextRef] = Field(default_factory=list, alias="contextRefs")
    assumptions: List[str] = Field(default_factory=list)
    success_criteria: List[str] = Field(default_factory=list, alias="successCriteria")
    issued_by: str = Field(..., min_length=1, alias="issuedBy")