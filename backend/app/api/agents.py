"""
智能体管理 API
"""
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.agent import Agent, AgentCreate, AgentUpdate, AgentStatus
from app.database import get_db
from app.core import AgentManager
from app.models import MiniMaxConnector, OpenAIConnector
from app.config import settings
from app.core.task_routing import legacy_direct_execution_detail

router = APIRouter(prefix="/agents", tags=["agents"])

# 全局智能体管理器实例
agent_manager = AgentManager()


def get_model_connector(model_name: str):
    """获取模型连接器"""
    if "abab" in model_name.lower():
        return MiniMaxConnector()
    else:
        return OpenAIConnector()


@router.on_event("startup")
async def startup():
    """启动时初始化"""
    agent_manager.set_model_factory(get_model_connector)


@router.post("", response_model=Agent)
async def create_agent(
    agent_data: AgentCreate,
    db: AsyncSession = Depends(get_db)
):
    """创建智能体"""
    agent = await agent_manager.create_agent(agent_data)
    return agent


@router.get("", response_model=List[Agent])
async def list_agents(
    status: Optional[AgentStatus] = Query(None, description="按状态过滤"),
    db: AsyncSession = Depends(get_db)
):
    """列出所有智能体"""
    agents = await agent_manager.list_agents(status=status)
    return agents


@router.get("/{agent_id}", response_model=Agent)
async def get_agent(
    agent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """获取智能体详情"""
    agent = await agent_manager.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.put("/{agent_id}", response_model=Agent)
async def update_agent(
    agent_id: str,
    update_data: AgentUpdate,
    db: AsyncSession = Depends(get_db)
):
    """更新智能体"""
    agent = await agent_manager.update_agent(agent_id, update_data)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.delete("/{agent_id}")
async def delete_agent(
    agent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """删除智能体"""
    success = await agent_manager.delete_agent(agent_id)
    if not success:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"message": "Agent deleted successfully"}


@router.post("/{agent_id}/start")
async def start_agent(
    agent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """启动智能体"""
    instance = await agent_manager.start_agent(agent_id)
    if not instance:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"message": "Agent started", "instance": instance.to_dict()}


@router.post("/{agent_id}/stop")
async def stop_agent(
    agent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """停止智能体"""
    success = await agent_manager.stop_agent(agent_id)
    if not success:
        raise HTTPException(status_code=404, detail="Agent not found or not running")
    return {"message": "Agent stopped"}


@router.post("/{agent_id}/pause")
async def pause_agent(
    agent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """暂停智能体"""
    success = await agent_manager.pause_agent(agent_id)
    if not success:
        raise HTTPException(status_code=400, detail="Agent not found or not running")
    return {"message": "Agent paused"}


@router.post("/{agent_id}/resume")
async def resume_agent(
    agent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """恢复智能体"""
    success = await agent_manager.resume_agent(agent_id)
    if not success:
        raise HTTPException(status_code=400, detail="Agent not found or not paused")
    return {"message": "Agent resumed"}


@router.get("/{agent_id}/stats")
async def get_agent_stats(
    agent_id: str,
    db: AsyncSession = Depends(get_db)
):
    """获取智能体统计"""
    stats = await agent_manager.get_agent_stats(agent_id)
    if not stats:
        raise HTTPException(status_code=404, detail="Agent not found")
    return stats


@router.post("/{agent_id}/execute")
async def execute_task(
    agent_id: str,
    task_input: str,
    context: Optional[dict] = None,
    db: AsyncSession = Depends(get_db)
):
    """Legacy direct execution endpoint: workflow routing is now mandatory."""
    raise HTTPException(status_code=409, detail=legacy_direct_execution_detail())


@router.get("/by-capability/{capability}", response_model=List[Agent])
async def find_agents_by_capability(
    capability: str,
    db: AsyncSession = Depends(get_db)
):
    """根据能力查找智能体"""
    agents = await agent_manager.find_agents_by_capability(capability)
    return agents
