"""
Restricted Axi Workstation integration API.

The workstation owns orchestration and audit storage. Axi Agent exposes only
the bounded quality-gate task in this first integration slice.
"""
import asyncio

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from app.core.axi_agent_mcp_client import AxiAgentMcpClient, AxiAgentMcpClientError
from app.core.task_routing import TaskRoutingError, TaskRoutingGuard
from app.core.workflow_event_client import WorkflowLifecycleEventError, WorkflowLifecycleEventPublisher
from app.schemas.task import TaskExecutionEvent, TaskRouteDecision
from app.schemas.workstation import (
    WorkstationEffectProposalRequest,
    WorkstationEffectProposalResponse,
    WorkstationQualityGateTaskRequest,
    WorkstationQualityGateTaskResponse,
    WorkstationToolResultTaskRequest,
    WorkstationToolResultTaskResponse,
)


router = APIRouter(prefix="/workstation/agent-tasks", tags=["workstation"])


def get_axi_agent_mcp_client() -> AxiAgentMcpClient:
    return AxiAgentMcpClient.from_settings()


def get_task_routing_guard() -> TaskRoutingGuard:
    return TaskRoutingGuard()


def get_workflow_lifecycle_event_publisher() -> WorkflowLifecycleEventPublisher:
    return WorkflowLifecycleEventPublisher()


async def _publish_lifecycle_event(
    publisher: WorkflowLifecycleEventPublisher,
    *,
    event_type: str,
    agent_task_id: str,
    decision: TaskRouteDecision,
    data: dict[str, object],
) -> None:
    await publisher.publish(
        TaskExecutionEvent(
            task_id=agent_task_id,
            event_type=event_type,
            message="Bounded Agent lifecycle event.",
            data=data,
            traceId=decision.trace_id,
            idempotencyKey=decision.idempotency_key,
            route=decision.route,
            policyVersion=decision.policy_version,
        )
    )


@router.post("/quality-gate", response_model=WorkstationQualityGateTaskResponse)
async def execute_quality_gate_task(
    task: WorkstationQualityGateTaskRequest,
    client: AxiAgentMcpClient = Depends(get_axi_agent_mcp_client),
    guard: TaskRoutingGuard = Depends(get_task_routing_guard),
    publisher: WorkflowLifecycleEventPublisher = Depends(get_workflow_lifecycle_event_publisher),
    workflow_token: Optional[str] = Header(default=None, alias="X-Axi-Workflow-Token"),
):
    decision: TaskRouteDecision | None = None
    try:
        decision = guard.authorize_bounded_run(
            task.route_decision,
            task.route_credential,
            "swarm_validate_with_gates",
            workflow_token,
        )
        await _publish_lifecycle_event(
            publisher,
            event_type="started",
            agent_task_id=task.agent_task_id,
            decision=decision,
            data={"tool": "swarm_validate_with_gates"},
        )
        result = await asyncio.to_thread(
            client.validate_with_quality_gates,
            task.prompt,
            gate_ids=task.gate_ids,
        )
    except TaskRoutingError as exc:
        raise HTTPException(status_code=409, detail=exc.as_dict()) from exc
    except AxiAgentMcpClientError as exc:
        if decision is not None:
            await _publish_lifecycle_event(
                publisher,
                event_type="failed",
                agent_task_id=task.agent_task_id,
                decision=decision,
                data={"tool": "swarm_validate_with_gates", "errorCode": "agent_mcp_unavailable"},
            )
        raise HTTPException(status_code=503, detail="Bounded Agent MCP runtime is unavailable.") from exc
    except WorkflowLifecycleEventError as exc:
        raise HTTPException(status_code=503, detail="Workflow lifecycle event sink is unavailable.") from exc

    passed = result["passed"] is True
    await _publish_lifecycle_event(
        publisher,
        event_type="completed" if passed else "failed",
        agent_task_id=task.agent_task_id,
        decision=decision,
        data={"tool": "swarm_validate_with_gates", "passed": passed, "status": "succeeded" if passed else "failed"},
    )
    return WorkstationQualityGateTaskResponse(
        agentTaskId=task.agent_task_id,
        status="succeeded" if passed else "failed",
        passed=passed,
        source=result["source"],
        tool=result["tool"],
        summary="Axi Agent quality gate passed." if passed else "Axi Agent quality gate rejected the task.",
        text=result["text"],
    )


@router.post("/tool-result", response_model=WorkstationToolResultTaskResponse)
async def execute_tool_result_task(
    task: WorkstationToolResultTaskRequest,
    client: AxiAgentMcpClient = Depends(get_axi_agent_mcp_client),
    guard: TaskRoutingGuard = Depends(get_task_routing_guard),
    publisher: WorkflowLifecycleEventPublisher = Depends(get_workflow_lifecycle_event_publisher),
    workflow_token: Optional[str] = Header(default=None, alias="X-Axi-Workflow-Token"),
):
    decision: TaskRouteDecision | None = None
    try:
        decision = guard.authorize_bounded_run(
            task.route_decision,
            task.route_credential,
            task.tool_name,
            workflow_token,
        )
        await _publish_lifecycle_event(
            publisher,
            event_type="started",
            agent_task_id=task.agent_task_id,
            decision=decision,
            data={"tool": task.tool_name},
        )
        result = await asyncio.to_thread(
            client.run_workstation_readonly_tool,
            task.tool_name,
            task.tool_arguments,
        )
    except TaskRoutingError as exc:
        raise HTTPException(status_code=409, detail=exc.as_dict()) from exc
    except AxiAgentMcpClientError as exc:
        if decision is not None:
            await _publish_lifecycle_event(
                publisher,
                event_type="failed",
                agent_task_id=task.agent_task_id,
                decision=decision,
                data={"tool": task.tool_name, "errorCode": "agent_mcp_unavailable"},
            )
        raise HTTPException(status_code=503, detail="Bounded Agent MCP runtime is unavailable.") from exc
    except WorkflowLifecycleEventError as exc:
        raise HTTPException(status_code=503, detail="Workflow lifecycle event sink is unavailable.") from exc

    passed = result["passed"] is True
    await _publish_lifecycle_event(
        publisher,
        event_type="completed" if passed else "failed",
        agent_task_id=task.agent_task_id,
        decision=decision,
        data={"tool": task.tool_name, "passed": passed, "status": "succeeded" if passed else "failed"},
    )
    return WorkstationToolResultTaskResponse(
        agentTaskId=task.agent_task_id,
        status="succeeded" if passed else "failed",
        passed=passed,
        source=result["source"],
        tool=result["tool"],
        summary="Axi Agent read-only MCP tool completed." if passed else "Axi Agent read-only MCP tool failed.",
        text=result["text"],
    )


@router.post("/effect-proposal", response_model=WorkstationEffectProposalResponse)
async def submit_effect_proposal(
    task: WorkstationEffectProposalRequest,
    guard: TaskRoutingGuard = Depends(get_task_routing_guard),
    publisher: WorkflowLifecycleEventPublisher = Depends(get_workflow_lifecycle_event_publisher),
    workflow_token: Optional[str] = Header(default=None, alias="X-Axi-Workflow-Token"),
):
    try:
        decision = guard.authorize_bounded_route(
            task.route_decision,
            task.route_credential,
            workflow_token,
        )
        proposal = guard.validate_effect_proposal(task.proposal.model_dump(by_alias=True, mode="json"), decision)
    except TaskRoutingError as exc:
        raise HTTPException(status_code=409, detail=exc.as_dict()) from exc

    # This endpoint only records a proposal for the workflow event stream.
    # It intentionally cannot execute document writes, commands, or HTTP effects.
    try:
        await _publish_lifecycle_event(
            publisher,
            event_type="effect_proposed",
            agent_task_id=task.agent_task_id,
            decision=decision,
            data={"proposalId": proposal.proposal_id, "actionDigest": proposal.action_digest},
        )
    except WorkflowLifecycleEventError as exc:
        raise HTTPException(status_code=503, detail="Workflow lifecycle event sink is unavailable.") from exc
    return WorkstationEffectProposalResponse(
        agentTaskId=task.agent_task_id,
        status="approval_required",
        proposalId=proposal.proposal_id,
        actionDigest=proposal.action_digest,
        traceId=decision.trace_id,
        idempotencyKey=decision.idempotency_key,
    )
