"""
记忆管理器
"""
import uuid
from typing import Dict, List, Optional, Any
from datetime import datetime
from collections import deque

from app.database.vector_store import VectorStore
from app.config import settings


class SessionMemory:
    """会话记忆"""
    
    def __init__(self, session_id: str, max_messages: int = None):
        self.session_id = session_id
        self.messages: deque = deque(maxlen=max_messages or settings.MAX_SESSION_MEMORY)
        self.context: Dict[str, Any] = {}
        self.created_at = datetime.now()
        self.updated_at = datetime.now()
    
    def add_message(self, role: str, content: str, metadata: Dict = None):
        """添加消息"""
        self.messages.append({
            "id": str(uuid.uuid4()),
            "role": role,
            "content": content,
            "metadata": metadata or {},
            "timestamp": datetime.now().isoformat()
        })
        self.updated_at = datetime.now()
    
    def get_messages(self, limit: int = None) -> List[Dict]:
        """获取消息列表"""
        msgs = list(self.messages)
        if limit:
            msgs = msgs[-limit:]
        return msgs
    
    def clear(self):
        """清空消息"""
        self.messages.clear()
        self.updated_at = datetime.now()
    
    def update_context(self, key: str, value: Any):
        """更新上下文"""
        self.context[key] = value
        self.updated_at = datetime.now()
    
    def get_context(self) -> Dict[str, Any]:
        """获取上下文"""
        return self.context.copy()
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "session_id": self.session_id,
            "message_count": len(self.messages),
            "context": self.context,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat()
        }


class MemoryManager:
    """记忆管理器"""
    
    def __init__(self):
        self._sessions: Dict[str, SessionMemory] = {}
        self._vector_store: Optional[VectorStore] = None
    
    async def initialize(self, vector_store: VectorStore):
        """初始化记忆管理器"""
        self._vector_store = vector_store
    
    # ===== 会话记忆管理 =====
    
    async def create_session(self, session_id: str = None, title: str = None) -> str:
        """创建新会话"""
        if session_id is None:
            session_id = str(uuid.uuid4())
        
        session = SessionMemory(session_id)
        if title:
            session.update_context("title", title)
        
        self._sessions[session_id] = session
        return session_id
    
    async def get_session(self, session_id: str) -> Optional[SessionMemory]:
        """获取会话"""
        return self._sessions.get(session_id)
    
    async def delete_session(self, session_id: str) -> bool:
        """删除会话"""
        if session_id in self._sessions:
            del self._sessions[session_id]
            return True
        return False
    
    async def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        metadata: Dict = None
    ):
        """添加消息到会话"""
        session = self._sessions.get(session_id)
        if not session:
            session = SessionMemory(session_id)
            self._sessions[session_id] = session
        
        session.add_message(role, content, metadata)
    
    async def get_session_messages(
        self,
        session_id: str,
        limit: int = None
    ) -> List[Dict]:
        """获取会话消息"""
        session = self._sessions.get(session_id)
        if session:
            return session.get_messages(limit)
        return []
    
    async def clear_session(self, session_id: str) -> bool:
        """清空会话消息"""
        session = self._sessions.get(session_id)
        if session:
            session.clear()
            return True
        return False
    
    async def update_session_context(
        self,
        session_id: str,
        key: str,
        value: Any
    ) -> bool:
        """更新会话上下文"""
        session = self._sessions.get(session_id)
        if session:
            session.update_context(key, value)
            return True
        return False
    
    async def get_session_context(self, session_id: str) -> Optional[Dict[str, Any]]:
        """获取会话上下文"""
        session = self._sessions.get(session_id)
        if session:
            return session.get_context()
        return None
    
    async def list_sessions(self) -> List[Dict[str, Any]]:
        """列出所有会话"""
        return [session.to_dict() for session in self._sessions.values()]
    
    # ===== 长期记忆管理 =====
    
    async def add_long_term_memory(
        self,
        content: str,
        metadata: Dict[str, Any] = None,
        memory_id: str = None
    ) -> str:
        """
        添加长期记忆
        
        Args:
            content: 记忆内容
            metadata: 元数据（如agent_id, task_id, tags等）
            memory_id: 可选的记忆ID
            
        Returns:
            记忆ID
        """
        if not self._vector_store:
            raise Exception("Vector store not initialized")
        
        return await self._vector_store.add_memory(
            content=content,
            metadata=metadata or {},
            memory_id=memory_id
        )
    
    async def search_long_term_memory(
        self,
        query: str,
        top_k: int = None,
        filter_metadata: Dict[str, Any] = None
    ) -> List[Dict[str, Any]]:
        """
        搜索长期记忆
        
        Args:
            query: 查询文本
            top_k: 返回结果数量
            filter_metadata: 过滤条件
            
        Returns:
            记忆列表
        """
        if not self._vector_store:
            raise Exception("Vector store not initialized")
        
        return await self._vector_store.search_memory(
            query=query,
            top_k=top_k,
            filter_metadata=filter_metadata
        )
    
    async def get_long_term_memory(self, memory_id: str) -> Optional[Dict[str, Any]]:
        """获取指定长期记忆"""
        if not self._vector_store:
            return None
        return await self._vector_store.get_memory(memory_id)
    
    async def delete_long_term_memory(self, memory_id: str) -> bool:
        """删除长期记忆"""
        if not self._vector_store:
            return False
        return await self._vector_store.delete_memory(memory_id)
    
    async def update_long_term_memory(
        self,
        memory_id: str,
        content: str = None,
        metadata: Dict[str, Any] = None
    ) -> bool:
        """更新长期记忆"""
        if not self._vector_store:
            return False
        return await self._vector_store.update_memory(memory_id, content, metadata)
    
    async def clear_long_term_memory(self, filter_metadata: Dict[str, Any] = None):
        """清空长期记忆"""
        if self._vector_store:
            await self._vector_store.clear_memory(filter_metadata)
    
    async def get_memory_stats(self) -> Dict[str, Any]:
        """获取记忆统计"""
        stats = {
            "session_count": len(self._sessions),
            "total_session_messages": sum(
                len(s.messages) for s in self._sessions.values()
            )
        }
        
        if self._vector_store:
            vector_stats = await self._vector_store.get_stats()
            stats["long_term_memory"] = vector_stats
        
        return stats
    
    async def save_session_to_long_term(
        self,
        session_id: str,
        summary: str = None
    ) -> Optional[str]:
        """将会话保存到长期记忆"""
        session = self._sessions.get(session_id)
        if not session or not self._vector_store:
            return None
        
        # 如果没有提供摘要，生成简单摘要
        if not summary:
            messages = session.get_messages()
            if messages:
                summary = f"Session with {len(messages)} messages. Last message: {messages[-1]['content'][:100]}..."
            else:
                summary = "Empty session"
        
        metadata = {
            "session_id": session_id,
            "type": "session_summary",
            "message_count": len(session.messages),
            "created_at": session.created_at.isoformat(),
            **session.context
        }
        
        return await self._vector_store.add_memory(
            content=summary,
            metadata=metadata
        )
    
    async def get_relevant_context(
        self,
        query: str,
        session_id: str = None,
        top_k: int = 3
    ) -> Dict[str, Any]:
        """
        获取相关上下文（会话记忆 + 长期记忆）
        
        Args:
            query: 查询
            session_id: 当前会话ID
            top_k: 长期记忆检索数量
            
        Returns:
            上下文信息
        """
        context = {
            "session_messages": [],
            "long_term_memories": [],
            "session_context": {}
        }
        
        # 获取会话消息
        if session_id:
            session = self._sessions.get(session_id)
            if session:
                context["session_messages"] = session.get_messages()
                context["session_context"] = session.get_context()
        
        # 检索长期记忆
        if self._vector_store:
            memories = await self.search_long_term_memory(query, top_k=top_k)
            context["long_term_memories"] = memories
        
        return context
