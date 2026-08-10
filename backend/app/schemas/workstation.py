from typing import Any, Dict, List, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.task import EffectProposal, TaskRouteCredential, TaskRouteDecision


class WorkstationRouteEnvelope(BaseModel):
    """Workflow-only capability envelope for every Agent runtime call."""
    model_config = ConfigDict(populate_by_name=True)

    route_decision: TaskRouteDecision | None = Field(None, alias="routeDecision")
    route_credential: TaskRouteCredential | None = Field(None, alias="routeCredential")


class WorkstationQualityGateTaskRequest(WorkstationRouteEnvelope):
    model_config = ConfigDict(populate_by_name=True)

    agent_task_id: str = Field(..., alias="agentTaskId", min_length=1)
    prompt: str = Field(..., min_length=1)
    gate_ids: List[str] = Field(default_factory=lambda: ["code_quality"], alias="gateIds")
    source: Literal["axi-workstation", "axi-workbench-workflow-engine"] = "axi-workstation"


class WorkstationQualityGateTaskResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    agent_task_id: str = Field(..., alias="agentTaskId")
    runtime: Literal["axi_agent_mcp"] = "axi_agent_mcp"
    status: Literal["succeeded", "failed"]
    passed: bool
    source: str
    tool: str
    summary: str
    text: str


class WorkstationToolResultTaskRequest(WorkstationRouteEnvelope):
    model_config = ConfigDict(populate_by_name=True)

    agent_task_id: str = Field(..., alias="agentTaskId", min_length=1)
    prompt: str = Field(..., min_length=1)
    tool_name: Literal["swarm_git_status"] = Field(..., alias="toolName")
    tool_arguments: Dict[str, Any] = Field(default_factory=dict, alias="toolArguments")
    source: Literal["axi-workstation", "axi-workbench-workflow-engine"] = "axi-workstation"


class WorkstationToolResultTaskResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    agent_task_id: str = Field(..., alias="agentTaskId")
    runtime: Literal["axi_agent_mcp"] = "axi_agent_mcp"
    status: Literal["succeeded", "failed"]
    passed: bool
    source: str
    tool: str
    summary: str
    text: str


class WorkstationEffectProposalRequest(WorkstationRouteEnvelope):
    model_config = ConfigDict(populate_by_name=True)

    agent_task_id: str = Field(..., alias="agentTaskId", min_length=1)
    proposal: EffectProposal
    source: Literal["axi-workstation", "axi-workbench-workflow-engine"] = "axi-workstation"


class WorkstationEffectProposalResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    agent_task_id: str = Field(..., alias="agentTaskId")
    status: Literal["approval_required"]
    proposal_id: str = Field(..., alias="proposalId")
    action_digest: str = Field(..., alias="actionDigest")
    trace_id: str = Field(..., alias="traceId")
    idempotency_key: str = Field(..., alias="idempotencyKey")
