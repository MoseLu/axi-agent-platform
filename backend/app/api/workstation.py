"""
Restricted Axi Workstation integration API.

The workstation owns orchestration and audit storage. Axi Agent exposes only
the bounded quality-gate task in this first integration slice.
"""
import asyncio

from fastapi import APIRouter, Depends, HTTPException

from app.core.axi_agent_mcp_client import AxiAgentMcpClient, AxiAgentMcpClientError
from app.schemas.workstation import (
    WorkstationQualityGateTaskRequest,
    WorkstationQualityGateTaskResponse,
    WorkstationToolResultTaskRequest,
    WorkstationToolResultTaskResponse,
)


router = APIRouter(prefix="/workstation/agent-tasks", tags=["workstation"])


def get_axi_agent_mcp_client() -> AxiAgentMcpClient:
    return AxiAgentMcpClient.from_settings()


@router.post("/quality-gate", response_model=WorkstationQualityGateTaskResponse)
async def execute_quality_gate_task(
    task: WorkstationQualityGateTaskRequest,
    client: AxiAgentMcpClient = Depends(get_axi_agent_mcp_client),
):
    try:
        result = await asyncio.to_thread(
            client.validate_with_quality_gates,
            task.prompt,
            gate_ids=task.gate_ids,
        )
    except AxiAgentMcpClientError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    passed = result["passed"] is True
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
):
    try:
        result = await asyncio.to_thread(
            client.run_workstation_readonly_tool,
            task.tool_name,
            task.tool_arguments,
        )
    except AxiAgentMcpClientError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    passed = result["passed"] is True
    return WorkstationToolResultTaskResponse(
        agentTaskId=task.agent_task_id,
        status="succeeded" if passed else "failed",
        passed=passed,
        source=result["source"],
        tool=result["tool"],
        summary="Axi Agent read-only MCP tool completed." if passed else "Axi Agent read-only MCP tool failed.",
        text=result["text"],
    )
