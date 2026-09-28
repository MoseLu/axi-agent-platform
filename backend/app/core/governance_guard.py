"""Plan-level governance evaluator: ``ExecutionPlan`` -> ``GovernanceDecision``.

The ``GovernanceGuard`` is the second enforcement layer of agent-governance
Phase 1: it consumes an ``ExecutionPlan`` produced by the planner and emits
a single 4-state ``GovernanceDecision``. Steps that pass policy are turned
into one-shot capabilities via ``CapabilityBroker.issue`` and their
``capability_id`` is attached to ``decision.metadata["issued_capabilities"]``
so the runtime can hand it back to ``CapabilityBroker.consume`` at the
``ToolManager.execute_tool`` / ``AxiAgentMcpClient.call_tool`` boundary.

Layer model:

* The existing ``TaskRoutingGuard`` (``backend/app/core/task_routing.py``)
  decides whether the *route* (``bounded_agent`` vs ``workflow`` vs
  ``escalate``) is even authorized for the task. It emits a
  ``TaskRouteDecision``. This module consumes that decision as a
  prerequisite.
* ``GovernanceGuard`` (this file) decides whether the *plan* the Agent
  produced under that route is allowed, denied, paused, or needs
  transformation. It emits a ``GovernanceDecision`` and, for ``allow``,
  hands out one ``Capability`` per step.

Wiring the ``ToolManager.execute_tool`` and ``AxiAgentMcpClient.call_tool``
boundaries to actually require the ``capability_id`` is deferred to commit 4.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

from app.core.capability_broker import (
    Capability,
    CapabilityBroker,
    QuarantinedToolError,
    UnknownToolError,
)
from app.schemas.execution_plan import EXECUTION_PLAN_SCHEMA_VERSION, ExecutionPlan
from app.schemas.governance_decision import (
    Actor,
    GovernanceDecision,
    RequiredApproval,
)
from app.schemas.task import TaskRoute, TaskRouteDecision


DEFAULT_POLICY_VERSION = "governance-policy/v1"


# Step-level redactor: a stub for now; Phase 1 commit 3 keeps it trivial
# and commit 4 wires the real one. Signature:
#   (tool: str, parameters: dict) -> dict
# Returning the (possibly modified) parameters dict.
StepRedactor = Callable[[str, Dict[str, Any]], Dict[str, Any]]


def default_redactor(tool: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
    """No-op redactor; replaces obvious secrets with ``"<redacted>"``.

    Real redactors live behind ``app.core.redaction`` in commit 4. This
    stub is enough to prove the ``transform`` decision path is reachable
    end-to-end."""
    redacted = dict(parameters)
    for key in ("api_key", "token", "password", "secret"):
        if key in redacted and isinstance(redacted[key], str):
            redacted[key] = "<redacted>"
    return redacted


@dataclass
class _StepVerdict:
    """Internal: one step's verdict inside the guard."""

    step_index: int
    tool: str
    outcome: str  # "allow" | "deny" | "transform"
    capability: Optional[Capability] = None
    transformed_parameters: Optional[Dict[str, Any]] = None
    reason: str = ""


@dataclass
class GovernanceGuard:
    """Evaluate an ``ExecutionPlan`` and emit a ``GovernanceDecision``."""

    broker: CapabilityBroker
    policy_version: str = DEFAULT_POLICY_VERSION
    ttl_seconds: int = 300
    redactor: StepRedactor = field(default=default_redactor)

    def evaluate_plan(
        self,
        plan: ExecutionPlan,
        *,
        subject: str,
        trace_id: str,
        idempotency_key: str,
        actor: Actor,
        routing_decision: TaskRouteDecision,
    ) -> GovernanceDecision:
        """Evaluate every step in ``plan`` and return a single decision.

        Decision rules (apply in order per step):

        1. Tool is in ``manifest.quarantine`` -> deny
           (``workspace_rule`` / ``deny_unregistered_tool``).
        2. Tool is not in ``manifest.tools`` -> deny
           (``project_rule`` / ``deny_unregistered_tool``).
        3. Tool has ``danger_level == "destructive"`` -> pause
           (``safety_hard_rule`` / ``pause_human_required``).
        4. Otherwise -> issue a one-shot capability and add to allow list.
           If the redactor modifies parameters, switch to ``transform`` and
           emit a ``transformedPlan`` with the rewritten parameters.
        """
        if plan.schema_version != EXECUTION_PLAN_SCHEMA_VERSION:
            raise ValueError(
                f"unsupported ExecutionPlan schemaVersion {plan.schema_version!r}, "
                f"expected {EXECUTION_PLAN_SCHEMA_VERSION!r}"
            )
        if routing_decision.route != TaskRoute.BOUNDED_AGENT:
            # The governance layer can only evaluate plans that already
            # passed routing; the workflow owns any escalation.
            raise ValueError(
                f"GovernanceGuard only evaluates plans under route=BOUNDED_AGENT, "
                f"got route={routing_decision.route.value!r}"
            )

        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=self.ttl_seconds)
        plan_digest = self._plan_digest(plan)

        issued: List[_StepVerdict] = []
        allowed_tools: List[str] = []
        denied: List[_StepVerdict] = []
        paused: List[_StepVerdict] = []
        transformed_steps: List[Dict[str, Any]] = []

        overall_decision = "allow"
        reason_codes: List[str] = []

        for index, step in enumerate(plan.steps):
            entry = self.broker.manifest.tools.get(step.tool)
            verdict = _StepVerdict(step_index=index, tool=step.tool, outcome="allow")

            if step.tool in self.broker.manifest.quarantine:
                verdict.outcome = "deny"
                verdict.reason = "tool is quarantined"
                denied.append(verdict)
                overall_decision = "deny"
                reason_codes.extend(["workspace_rule", "deny_unregistered_tool"])
                continue

            if entry is None:
                verdict.outcome = "deny"
                verdict.reason = "tool not in manifest"
                denied.append(verdict)
                overall_decision = "deny"
                reason_codes.extend(["project_rule", "deny_unregistered_tool"])
                continue

            if entry.danger_level == "destructive":
                verdict.outcome = "pause"
                verdict.reason = "destructive tool requires human approval"
                paused.append(verdict)
                if overall_decision == "allow":
                    overall_decision = "pause"
                reason_codes.extend(["safety_hard_rule", "pause_human_required"])
                continue

            # Step 4: redactor + issuance.
            redacted_parameters = self.redactor(step.tool, dict(step.parameters))
            if redacted_parameters != dict(step.parameters):
                verdict.outcome = "transform"
                verdict.transformed_parameters = redacted_parameters
                transformed_steps.append(
                    {
                        "index": index,
                        "tool": step.tool,
                        "parameters": redacted_parameters,
                    }
                )
                reason_codes.extend(["transform_payload_redacted"])
                if overall_decision == "allow":
                    overall_decision = "transform"

            try:
                cap = self.broker.issue(
                    subject=subject,
                    tool=step.tool,
                    plan_digest=plan_digest,
                    action_digest=CapabilityBroker.compute_action_digest(step.tool, redacted_parameters),
                    allowed_target=self._extract_target(step.tool, redacted_parameters),
                    idempotency_key=step.idempotency_key,
                    ttl_seconds=self.ttl_seconds,
                )
            except (UnknownToolError, QuarantinedToolError) as exc:
                verdict.outcome = "deny"
                verdict.reason = f"broker refused to issue: {exc}"
                denied.append(verdict)
                overall_decision = "deny"
                reason_codes.extend(["deny_unregistered_tool"])
                continue

            verdict.capability = cap
            issued.append(verdict)
            if step.tool not in allowed_tools:
                allowed_tools.append(step.tool)
            reason_codes.append("policy_match")

        # Deduplicate reason codes while preserving insertion order.
        seen: set[str] = set()
        deduped_reasons: List[str] = []
        for code in reason_codes:
            if code not in seen:
                deduped_reasons.append(code)
                seen.add(code)

        transformed_plan = self._build_transformed_plan(
            plan, transformed_steps
        ) if transformed_steps else None
        required_approval = (
            RequiredApproval(
                kind="human",
                prompt=f"Destructive tool step requires human approval: "
                       f"{', '.join(v.tool for v in paused)}",
            )
            if paused
            else None
        )

        decision = GovernanceDecision(
            decision=overall_decision,
            reasonCodes=deduped_reasons,
            policyVersion=self.policy_version,
            planDigest=plan_digest,
            traceId=trace_id,
            idempotencyKey=idempotency_key,
            routingDecisions=[routing_decision],
            allowedTools=allowed_tools or [v.tool for v in denied + paused] or ["(none)"],
            requiredApproval=required_approval,
            transformedPlan=transformed_plan,
            expiresAt=expires_at,
            issuedAt=now,
            actor=actor,
        )

        # Side-channel: the runtime hands these back to
        # ``CapabilityBroker.consume`` at the tool boundary. We attach them
        # via Pydantic's model metadata because ``GovernanceDecision`` uses
        # ``extra="forbid"`` and the capability ids are not part of the wire
        # schema. A future schema rev will lift them into a typed field.
        object.__setattr__(
            decision,
            "_issued_capabilities",
            [
                {
                    "stepIndex": v.step_index,
                    "tool": v.tool,
                    "capabilityId": v.capability.capability_id if v.capability else None,
                    "actionDigest": v.capability.action_digest if v.capability else None,
                    "allowedTarget": v.capability.allowed_target if v.capability else None,
                }
                for v in issued
            ],
        )
        return decision

    # --- helpers ---

    @staticmethod
    def _plan_digest(plan: ExecutionPlan) -> str:
        canonical = json.dumps(
            plan.model_dump(by_alias=True, mode="json"),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    @staticmethod
    def _extract_target(tool: str, parameters: Dict[str, Any]) -> str:
        """Best-effort target extraction: file path, branch name, URL, etc.

        The Broker uses ``allowed_target`` as a sanity binding so a
        capability issued for one path cannot be used against another. The
        guard's view of ``target`` is the canonical first parameter that
        uniquely names the target (``path``, ``branch``, ``url``,
        ``file_path``, etc.). If none is found the Broker falls back to
        ``"<unspecified>"`` so the mismatch check is still meaningful."""
        for key in ("path", "file_path", "branch", "url", "target", "name"):
            value = parameters.get(key)
            if isinstance(value, str) and value:
                return value
        return "<unspecified>"

    def _build_transformed_plan(
        self,
        plan: ExecutionPlan,
        transformed_steps: List[Dict[str, Any]],
    ) -> ExecutionPlan:
        new_steps = []
        for index, step in enumerate(plan.steps):
            replaced = next(
                (item for item in transformed_steps if item["index"] == index),
                None,
            )
            if replaced is not None:
                new_steps.append(
                    step.model_copy(update={"parameters": replaced["parameters"]})
                )
            else:
                new_steps.append(step)
        return plan.model_copy(update={"steps": new_steps})


__all__ = [
    "DEFAULT_POLICY_VERSION",
    "GovernanceGuard",
    "StepRedactor",
    "default_redactor",
]