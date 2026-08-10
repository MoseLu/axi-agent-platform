"""Fail-closed task-execution-routing/v1 guard for the Agent Platform."""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from app.config import settings
from app.schemas.task import (
    EffectProposal,
    Task,
    TaskCreate,
    TaskRoute,
    TaskRouteCredential,
    TaskRouteDecision,
    TaskType,
)


POLICY_VERSION = "task-execution-routing/v1"
SAFE_READ_ONLY_TOOLS = frozenset({"swarm_git_status", "swarm_validate_with_gates"})
HARD_SIGNAL_REASONS = {
    "requests_command": "command_requested",
    "requires_command": "command_requested",
    "requests_write": "write_requested",
    "requires_write": "write_requested",
    "requests_external_side_effect": "external_side_effect_requested",
    "requires_external_side_effect": "external_side_effect_requested",
    "requests_privilege_escalation": "privilege_escalation_requested",
    "requires_privilege_escalation": "privilege_escalation_requested",
}


class TaskRoutingError(RuntimeError):
    def __init__(self, code: str, message: str, decision: Optional[TaskRouteDecision] = None):
        super().__init__(message)
        self.code = code
        self.decision = decision

    def as_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": str(self)}
        if self.decision is not None:
            payload["routeDecision"] = self.decision.model_dump(by_alias=True, mode="json")
        return payload


def legacy_direct_execution_detail(code: str = "workflow_required") -> dict[str, str]:
    """Stable migration response for pre-v1 direct execution endpoints."""
    return {
        "code": code,
        "message": "Direct Agent execution is disabled; submit the operation through the workflow executor.",
        "policyVersion": POLICY_VERSION,
    }


class TaskRoutingGuard:
    """Applies hard rules before queueing, model execution, and every tool call."""

    def __init__(
        self,
        credential_secret: Optional[str] = None,
        internal_event_token: Optional[str] = None,
        safe_tools: Iterable[str] = SAFE_READ_ONLY_TOOLS,
    ):
        self.credential_secret = credential_secret if credential_secret is not None else settings.WORKFLOW_ROUTE_CREDENTIAL_SECRET
        self.internal_event_token = internal_event_token if internal_event_token is not None else settings.WORKFLOW_INTERNAL_EVENT_TOKEN
        self.safe_tools = frozenset(safe_tools)
        self._usage: dict[str, dict[str, float]] = {}

    def route_for_creation(self, task_data: TaskCreate) -> TaskRouteDecision:
        hard_reason = self._hard_reason(task_data)
        if hard_reason:
            return self._escalation(task_data, hard_reason)

        supplied = task_data.route_decision
        if supplied is None:
            return self._escalation(task_data, "workflow_required")
        if supplied.policy_version != POLICY_VERSION:
            return self._escalation(task_data, "workflow_required")
        if task_data.use_subagent_mode:
            return self._escalation(task_data, "workflow_required")
        # This service consumes only a signed bounded route issued by the
        # workflow.  A client-supplied workflow/escalate decision is never a
        # control-plane instruction for the legacy Agent task API.
        if supplied.route != TaskRoute.BOUNDED_AGENT:
            return self._escalation(task_data, "workflow_required")
        return self._validate_bounded_decision(task_data, supplied, task_data.route_credential)

    def validate_queued_bounded_task(self, task: Task) -> TaskRouteDecision:
        """Validate persisted routing state before a paused task may re-enter the queue."""
        decision = task.route_decision
        if decision is None or decision.route != TaskRoute.BOUNDED_AGENT:
            raise TaskRoutingError("workflow_required", "Only a bounded workflow route may resume execution.", decision)
        self._validate_bounded_decision_data(decision, task.route_credential)
        return decision

    def authorize_bounded_run(
        self,
        decision: Optional[TaskRouteDecision],
        credential: Optional[TaskRouteCredential],
        tool_name: str,
        internal_token: Optional[str],
    ) -> TaskRouteDecision:
        decision = self.authorize_bounded_route(decision, credential, internal_token)
        self.before_tool_call(decision, tool_name)
        return decision

    def authorize_bounded_route(
        self,
        decision: Optional[TaskRouteDecision],
        credential: Optional[TaskRouteCredential],
        internal_token: Optional[str],
    ) -> TaskRouteDecision:
        if not self.internal_event_token or not internal_token or not hmac.compare_digest(internal_token, self.internal_event_token):
            raise TaskRoutingError("workflow_required", "A valid workflow internal token is required.", decision)
        if decision is None:
            raise TaskRoutingError("workflow_required", "A workflow route decision is required.")
        if decision.route != TaskRoute.BOUNDED_AGENT:
            code = "approval_required" if decision.route == TaskRoute.ESCALATE else "workflow_required"
            raise TaskRoutingError(code, "This route cannot start an Agent runtime.", decision)
        self._validate_bounded_decision_data(decision, credential)
        return decision

    def before_model_call(self, task: Task) -> None:
        decision = task.route_decision
        if decision is None or decision.route != TaskRoute.BOUNDED_AGENT:
            raise TaskRoutingError("workflow_required", "Only a bounded workflow route can invoke an Agent model.", decision)
        self._validate_bounded_decision_data(decision, task.route_credential)
        self._reserve_step(decision)

    def before_tool_call(
        self,
        decision: TaskRouteDecision,
        tool_name: str,
        credential: Optional[TaskRouteCredential] = None,
    ) -> None:
        if decision.route != TaskRoute.BOUNDED_AGENT:
            raise TaskRoutingError("workflow_required", "Tool execution requires a bounded Agent route.", decision)
        if credential is not None:
            self._validate_bounded_decision_data(decision, credential)
        if tool_name not in decision.tool_allowlist or tool_name not in self.safe_tools:
            raise TaskRoutingError("approval_required", f"Tool is not allowed for bounded execution: {tool_name}", decision)
        if decision.sandbox != "read_only":
            raise TaskRoutingError("approval_required", "Bounded Agent requires the read_only sandbox.", decision)
        self._reserve_step(decision)

    def record_usage(self, decision: TaskRouteDecision, *, model_tokens: int = 0, estimated_cost: float = 0) -> None:
        usage = self._usage.setdefault(decision.trace_id, self._new_usage())
        usage["model_tokens"] += max(0, model_tokens)
        usage["estimated_cost"] += max(0, estimated_cost)
        if usage["model_tokens"] > decision.limits.max_model_tokens or usage["estimated_cost"] > decision.limits.max_estimated_cost:
            raise TaskRoutingError("approval_required", "Bounded Agent budget exceeded.", decision)

    def filter_tool_definitions(self, decision: TaskRouteDecision, tools: Any) -> Any:
        if not isinstance(tools, list):
            return tools
        allowed = set(decision.tool_allowlist) & self.safe_tools
        return [tool for tool in tools if self._tool_name(tool) in allowed]

    def validate_effect_proposal(self, raw_proposal: Any, decision: TaskRouteDecision) -> EffectProposal:
        try:
            proposal = EffectProposal.model_validate(raw_proposal)
        except Exception as exc:  # Pydantic validation error is intentionally boundary-safe.
            raise TaskRoutingError("approval_required", "Effect proposal is invalid.", decision) from exc
        if proposal.trace_id != decision.trace_id or proposal.idempotency_key != decision.idempotency_key:
            raise TaskRoutingError("approval_required", "Effect proposal does not belong to this route.", decision)
        if proposal.action_digest != self.action_digest(proposal.action):
            raise TaskRoutingError("approval_required", "Effect proposal action digest does not match.", decision)
        return proposal

    @staticmethod
    def decision_digest(decision: TaskRouteDecision) -> str:
        return hashlib.sha256(_canonical_json(decision.model_dump(by_alias=True, mode="json")).encode()).hexdigest()

    @staticmethod
    def action_digest(action: dict[str, Any]) -> str:
        return hashlib.sha256(_canonical_json(action).encode()).hexdigest()

    @staticmethod
    def credential_signature(credential: TaskRouteCredential, secret: str) -> str:
        payload = {
            "credentialId": credential.credential_id,
            "subject": credential.subject,
            "decisionDigest": credential.decision_digest,
            "issuedAt": credential.issued_at,
            "expiresAt": credential.expires_at,
        }
        return hmac.new(secret.encode(), _canonical_json(payload).encode(), hashlib.sha256).hexdigest()

    def _validate_bounded_decision(
        self,
        task_data: TaskCreate,
        decision: TaskRouteDecision,
        credential: Optional[TaskRouteCredential],
    ) -> TaskRouteDecision:
        if task_data.input_data.get("local_path_unenumerable") is not True or task_data.input_data.get("read_only") is not True:
            return self._escalation(task_data, "unknown_request")
        try:
            self._validate_bounded_decision_data(decision, credential)
        except TaskRoutingError as exc:
            return self._escalation(task_data, "workflow_required" if exc.code == "workflow_required" else "approval_required")
        return decision

    def _validate_bounded_decision_data(
        self,
        decision: TaskRouteDecision,
        credential: Optional[TaskRouteCredential],
    ) -> None:
        if decision.policy_version != POLICY_VERSION or decision.sandbox != "read_only":
            raise TaskRoutingError("workflow_required", "Bounded Agent route violates the v1 policy.", decision)
        if not decision.tool_allowlist or not set(decision.tool_allowlist).issubset(self.safe_tools):
            raise TaskRoutingError("approval_required", "Bounded Agent route includes a non-read-only tool.", decision)
        if decision.limits.max_steps < 1 or decision.limits.max_wall_time_ms < 1:
            raise TaskRoutingError("approval_required", "Bounded Agent requires a positive step and time budget.", decision)
        if credential is None or not self.credential_secret:
            raise TaskRoutingError("workflow_required", "A signed workflow route credential is required.", decision)
        if credential.decision_digest != self.decision_digest(decision):
            raise TaskRoutingError("workflow_required", "Route credential decision digest does not match.", decision)
        expected_signature = self.credential_signature(credential, self.credential_secret)
        if not hmac.compare_digest(credential.signature, expected_signature):
            raise TaskRoutingError("workflow_required", "Route credential signature is invalid.", decision)
        try:
            expires_at = datetime.fromisoformat(credential.expires_at.replace("Z", "+00:00"))
        except ValueError as exc:
            raise TaskRoutingError("workflow_required", "Route credential expiry is invalid.", decision) from exc
        if expires_at <= datetime.now(timezone.utc):
            raise TaskRoutingError("workflow_required", "Route credential has expired.", decision)

    def _reserve_step(self, decision: TaskRouteDecision) -> None:
        usage = self._usage.setdefault(decision.trace_id, self._new_usage())
        elapsed_ms = (time.monotonic() - usage["started_at"]) * 1000
        usage["steps"] += 1
        if usage["steps"] > decision.limits.max_steps or elapsed_ms > decision.limits.max_wall_time_ms:
            raise TaskRoutingError("approval_required", "Bounded Agent step or time budget exceeded.", decision)

    def _hard_reason(self, task_data: TaskCreate) -> Optional[str]:
        for signal, reason in HARD_SIGNAL_REASONS.items():
            if task_data.input_data.get(signal) is True:
                return reason
        if task_data.task_type in {TaskType.CODE_DEVELOPMENT, TaskType.TEST_WRITING}:
            return "write_requested"
        return None

    def _escalation(self, task_data: TaskCreate, reason_code: str) -> TaskRouteDecision:
        trace_id = str(task_data.input_data.get("traceId") or f"task-{hashlib.sha256(task_data.title.encode()).hexdigest()[:16]}")
        idempotency_key = str(task_data.input_data.get("idempotencyKey") or f"task-{hashlib.sha256((task_data.title + (task_data.description or '')).encode()).hexdigest()[:24]}")
        return TaskRouteDecision(
            route=TaskRoute.ESCALATE,
            reasonCode=reason_code,
            policyVersion=POLICY_VERSION,
            traceId=trace_id,
            idempotencyKey=idempotency_key,
            contextRefs=[],
            toolAllowlist=[],
            sandbox="none",
            limits={"maxSteps": 0, "maxWallTimeMs": 0, "maxModelTokens": 0, "maxEstimatedCost": 0},
        )

    @staticmethod
    def _new_usage() -> dict[str, float]:
        return {"started_at": time.monotonic(), "steps": 0, "model_tokens": 0, "estimated_cost": 0}

    @staticmethod
    def _tool_name(tool: Any) -> Optional[str]:
        if not isinstance(tool, dict):
            return None
        return tool.get("id") or tool.get("name") or tool.get("function", {}).get("name")


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
