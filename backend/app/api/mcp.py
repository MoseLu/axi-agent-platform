"""
Axi Agent MCP service API.
"""
import asyncio

from fastapi import APIRouter, HTTPException

from app.core.axi_agent_mcp_client import AxiAgentMcpClient, AxiAgentMcpClientError

router = APIRouter(prefix="/mcp", tags=["mcp"])


@router.get("/axi-agent/status")
async def get_axi_agent_mcp_status():
    """Return a smoke summary for the external Axi Agent MCP service."""
    client = AxiAgentMcpClient.from_settings()
    try:
        return await asyncio.to_thread(client.get_service_summary)
    except AxiAgentMcpClientError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
