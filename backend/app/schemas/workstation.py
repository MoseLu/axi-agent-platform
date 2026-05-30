from typing import Any, Dict, List, Literal

from pydantic import BaseModel, ConfigDict, Field


class WorkstationQualityGateTaskRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    agent_task_id: str = Field(..., alias="agentTaskId", min_length=1)
    prompt: str = Field(..., min_length=1)
    gate_ids: List[str] = Field(default_factory=lambda: ["code_quality"], alias="gateIds")
    source: Literal["axi-workstation"] = "axi-workstation"


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


class WorkstationToolResultTaskRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    agent_task_id: str = Field(..., alias="agentTaskId", min_length=1)
    prompt: str = Field(..., min_length=1)
    tool_name: Literal["swarm_git_status"] = Field(..., alias="toolName")
    tool_arguments: Dict[str, Any] = Field(default_factory=dict, alias="toolArguments")
    source: Literal["axi-workstation"] = "axi-workstation"


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
