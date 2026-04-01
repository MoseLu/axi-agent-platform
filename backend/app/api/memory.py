"""
记忆管理 API
"""
from typing import List, Optional, Any
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.core import MemoryManager

router = APIRouter(prefix="/memory", tags=["memory"])

# 全局记忆管理器实例
memory_manager = MemoryManager()


# ===== 会话记忆 API =====

@router.post("/sessions")
async def create_session(
    title: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """创建新会话"""
    session_id = await memory_manager.create_session(title=title)
    return {"session_id": session_id}


@router.get("/sessions")
async def list_sessions(
    db: AsyncSession = Depends(get_db)
):
    """列出所有会话"""
    sessions = await memory_manager.list_sessions()
    return sessions


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db)
):
    """获取会话详情"""
    session = await memory_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.to_dict()


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    db: AsyncSession = Depends(get_db)
):
    """删除会话"""
    success = await memory_manager.delete_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"message": "Session deleted"}


@router.post("/sessions/{session_id}/messages")
async def add_message(
    session_id: str,
    role: str,
    content: str,
    metadata: Optional[dict] = None,
    db: AsyncSession = Depends(get_db)
):
    """添加消息到会话"""
    await memory_manager.add_message(
        session_id=session_id,
        role=role,
        content=content,
        metadata=metadata
    )
    return {"message": "Message added"}


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    limit: Optional[int] = None,
    db: AsyncSession = Depends(get_db)
):
    """获取会话消息"""
    messages = await memory_manager.get_session_messages(session_id, limit)
    return messages


@router.delete("/sessions/{session_id}/messages")
async def clear_session(
    session_id: str,
    db: AsyncSession = Depends(get_db)
):
    """清空会话消息"""
    success = await memory_manager.clear_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"message": "Session cleared"}


@router.put("/sessions/{session_id}/context")
async def update_session_context(
    session_id: str,
    key: str,
    value: Any,
    db: AsyncSession = Depends(get_db)
):
    """更新会话上下文"""
    success = await memory_manager.update_session_context(session_id, key, value)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"message": "Context updated"}


@router.get("/sessions/{session_id}/context")
async def get_session_context(
    session_id: str,
    db: AsyncSession = Depends(get_db)
):
    """获取会话上下文"""
    context = await memory_manager.get_session_context(session_id)
    if context is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return context


# ===== 长期记忆 API =====

@router.post("/long-term")
async def add_long_term_memory(
    content: str,
    metadata: Optional[dict] = None,
    db: AsyncSession = Depends(get_db)
):
    """添加长期记忆"""
    try:
        memory_id = await memory_manager.add_long_term_memory(
            content=content,
            metadata=metadata
        )
        return {"memory_id": memory_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/long-term/search")
async def search_long_term_memory(
    query: str,
    top_k: int = 5,
    db: AsyncSession = Depends(get_db)
):
    """搜索长期记忆"""
    try:
        memories = await memory_manager.search_long_term_memory(
            query=query,
            top_k=top_k
        )
        return memories
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/long-term/{memory_id}")
async def get_long_term_memory(
    memory_id: str,
    db: AsyncSession = Depends(get_db)
):
    """获取指定长期记忆"""
    memory = await memory_manager.get_long_term_memory(memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="Memory not found")
    return memory


@router.delete("/long-term/{memory_id}")
async def delete_long_term_memory(
    memory_id: str,
    db: AsyncSession = Depends(get_db)
):
    """删除长期记忆"""
    success = await memory_manager.delete_long_term_memory(memory_id)
    if not success:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"message": "Memory deleted"}


@router.put("/long-term/{memory_id}")
async def update_long_term_memory(
    memory_id: str,
    content: Optional[str] = None,
    metadata: Optional[dict] = None,
    db: AsyncSession = Depends(get_db)
):
    """更新长期记忆"""
    success = await memory_manager.update_long_term_memory(
        memory_id=memory_id,
        content=content,
        metadata=metadata
    )
    if not success:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"message": "Memory updated"}


@router.post("/sessions/{session_id}/save")
async def save_session_to_long_term(
    session_id: str,
    summary: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """将会话保存到长期记忆"""
    memory_id = await memory_manager.save_session_to_long_term(session_id, summary)
    if not memory_id:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"memory_id": memory_id}


@router.get("/stats")
async def get_memory_stats(
    db: AsyncSession = Depends(get_db)
):
    """获取记忆统计"""
    stats = await memory_manager.get_memory_stats()
    return stats
