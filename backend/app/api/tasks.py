"""
任务管理 API
"""
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.task import (
    Task, TaskCreate, TaskUpdate, TaskStatus,
    TaskExecutionEvent
)
from app.database import get_db
from app.core import TaskScheduler, SwarmOrchestrator

router = APIRouter(prefix="/tasks", tags=["tasks"])

# 全局任务调度器实例
task_scheduler = TaskScheduler()


@router.on_event("startup")
async def startup():
    """启动时初始化调度器"""
    await task_scheduler.start()


@router.on_event("shutdown")
async def shutdown():
    """关闭时停止调度器"""
    await task_scheduler.stop()


@router.post("", response_model=Task)
async def create_task(
    task_data: TaskCreate,
    db: AsyncSession = Depends(get_db)
):
    """创建任务"""
    task = await task_scheduler.create_task(task_data)
    return task


@router.get("", response_model=List[Task])
async def list_tasks(
    status: Optional[TaskStatus] = Query(None, description="按状态过滤"),
    parent_id: Optional[str] = Query(None, description="父任务ID"),
    db: AsyncSession = Depends(get_db)
):
    """列出所有任务"""
    tasks = await task_scheduler.list_tasks(status=status, parent_id=parent_id)
    return tasks


@router.get("/{task_id}", response_model=Task)
async def get_task(
    task_id: str,
    db: AsyncSession = Depends(get_db)
):
    """获取任务详情"""
    task = await task_scheduler.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.put("/{task_id}", response_model=Task)
async def update_task(
    task_id: str,
    update_data: TaskUpdate,
    db: AsyncSession = Depends(get_db)
):
    """更新任务"""
    task = await task_scheduler.update_task(task_id, update_data)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.delete("/{task_id}")
async def delete_task(
    task_id: str,
    db: AsyncSession = Depends(get_db)
):
    """删除任务"""
    success = await task_scheduler.delete_task(task_id)
    if not success:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "Task deleted successfully"}


@router.post("/{task_id}/cancel")
async def cancel_task(
    task_id: str,
    db: AsyncSession = Depends(get_db)
):
    """取消任务"""
    success = await task_scheduler.cancel_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail="Task not found or cannot be cancelled")
    return {"message": "Task cancelled"}


@router.post("/{task_id}/pause")
async def pause_task(
    task_id: str,
    db: AsyncSession = Depends(get_db)
):
    """暂停任务"""
    success = await task_scheduler.pause_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail="Task not found or cannot be paused")
    return {"message": "Task paused"}


@router.post("/{task_id}/resume")
async def resume_task(
    task_id: str,
    db: AsyncSession = Depends(get_db)
):
    """恢复任务"""
    success = await task_scheduler.resume_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail="Task not found or cannot be resumed")
    return {"message": "Task resumed"}


@router.get("/stats/overview")
async def get_task_stats(
    db: AsyncSession = Depends(get_db)
):
    """获取任务统计"""
    stats = await task_scheduler.get_task_stats()
    return stats


# WebSocket 用于实时任务更新
@router.websocket("/ws/{task_id}")
async def task_websocket(websocket: WebSocket, task_id: str):
    """WebSocket 连接用于实时接收任务更新"""
    await websocket.accept()
    
    async def event_handler(event: TaskExecutionEvent):
        if event.task_id == task_id:
            await websocket.send_json(event.model_dump())
    
    # 注册事件处理器
    task_scheduler.add_event_handler(event_handler)
    
    try:
        while True:
            # 保持连接
            data = await websocket.receive_text()
            # 可以处理客户端消息
    except WebSocketDisconnect:
        pass
    finally:
        # 移除事件处理器
        task_scheduler._event_handlers.remove(event_handler)


# Swarm 协作相关 API
@router.post("/swarm/collaborative")
async def create_collaborative_task(
    title: str,
    description: str,
    agent_roles: List[str],
    input_data: Optional[dict] = None,
    db: AsyncSession = Depends(get_db)
):
    """创建协作任务"""
    # 需要SwarmOrchestrator实例
    # 这里简化处理
    return {"message": "Collaborative task created", "title": title}


@router.post("/{task_id}/handoff")
async def handoff_task(
    task_id: str,
    from_agent_id: str,
    to_agent_id: str,
    context: Optional[dict] = None,
    db: AsyncSession = Depends(get_db)
):
    """任务交接"""
    # 需要SwarmOrchestrator实例
    return {"message": "Task handed off", "task_id": task_id}
