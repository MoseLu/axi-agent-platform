"""
工具管理 API
"""
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.tool import Tool, ToolCreate, ToolUpdate, ToolExecutionResult, ToolCategory, ToolType
from app.database import get_db
from app.tools import ToolManager

router = APIRouter(prefix="/tools", tags=["tools"])

# 全局工具管理器实例
tool_manager = ToolManager()


@router.get("", response_model=List[Tool])
async def list_tools(
    category: Optional[ToolCategory] = None,
    tool_type: Optional[ToolType] = None,
    enabled_only: bool = True,
    db: AsyncSession = Depends(get_db)
):
    """列出所有工具"""
    tools = await tool_manager.list_tools(
        category=category,
        tool_type=tool_type,
        enabled_only=enabled_only
    )
    return tools


@router.get("/{tool_id}", response_model=Tool)
async def get_tool(
    tool_id: str,
    db: AsyncSession = Depends(get_db)
):
    """获取工具详情"""
    tool = await tool_manager.get_tool(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    return tool


@router.post("", response_model=Tool)
async def create_tool(
    tool_data: ToolCreate,
    db: AsyncSession = Depends(get_db)
):
    """创建自定义工具"""
    import uuid
    
    tool = Tool(
        id=str(uuid.uuid4()),
        **tool_data.model_dump(),
        created_at=datetime.now(),
        updated_at=datetime.now()
    )
    
    await tool_manager.register_tool(tool)
    return tool


@router.put("/{tool_id}", response_model=Tool)
async def update_tool(
    tool_id: str,
    update_data: ToolUpdate,
    db: AsyncSession = Depends(get_db)
):
    """更新工具"""
    tool = await tool_manager.get_tool(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    
    update_dict = update_data.model_dump(exclude_unset=True)
    for key, value in update_dict.items():
        if value is not None:
            setattr(tool, key, value)
    
    tool.updated_at = datetime.now()
    return tool


@router.delete("/{tool_id}")
async def delete_tool(
    tool_id: str,
    db: AsyncSession = Depends(get_db)
):
    """删除工具"""
    success = await tool_manager.unregister_tool(tool_id)
    if not success:
        raise HTTPException(status_code=404, detail="Tool not found")
    return {"message": "Tool deleted successfully"}


@router.post("/{tool_id}/execute", response_model=ToolExecutionResult)
async def execute_tool(
    tool_id: str,
    parameters: dict,
    agent_id: Optional[str] = None,
    task_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """执行工具"""
    result = await tool_manager.execute_tool(
        tool_id=tool_id,
        parameters=parameters,
        agent_id=agent_id,
        task_id=task_id
    )
    return result


@router.post("/{tool_id}/enable")
async def enable_tool(
    tool_id: str,
    db: AsyncSession = Depends(get_db)
):
    """启用工具"""
    tool = await tool_manager.get_tool(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    
    tool.enabled = True
    tool.updated_at = datetime.now()
    return {"message": "Tool enabled"}


@router.post("/{tool_id}/disable")
async def disable_tool(
    tool_id: str,
    db: AsyncSession = Depends(get_db)
):
    """禁用工具"""
    tool = await tool_manager.get_tool(tool_id)
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    
    tool.enabled = False
    tool.updated_at = datetime.now()
    return {"message": "Tool disabled"}


@router.get("/categories/list")
async def list_categories(
    db: AsyncSession = Depends(get_db)
):
    """列出所有工具类别"""
    return [category.value for category in ToolCategory]
