"""
向量数据库存储 - 用于长期记忆
"""
import uuid
from typing import List, Dict, Any, Optional
from datetime import datetime
import chromadb
from chromadb.config import Settings as ChromaSettings

from app.config import settings


class VectorStore:
    """向量存储管理器"""
    
    def __init__(self):
        self.client = chromadb.PersistentClient(
            path=settings.VECTOR_DB_PATH,
            settings=ChromaSettings(
                anonymized_telemetry=False
            )
        )
        self.collection = self.client.get_or_create_collection(
            name="agent_memory",
            metadata={"hnsw:space": "cosine"}
        )
    
    async def add_memory(
        self,
        content: str,
        metadata: Dict[str, Any] = None,
        memory_id: Optional[str] = None
    ) -> str:
        """
        添加记忆
        
        Args:
            content: 记忆内容
            metadata: 元数据
            memory_id: 可选的记忆ID
            
        Returns:
            记忆ID
        """
        if memory_id is None:
            memory_id = str(uuid.uuid4())
        
        if metadata is None:
            metadata = {}
        
        metadata["timestamp"] = datetime.now().isoformat()
        
        self.collection.add(
            ids=[memory_id],
            documents=[content],
            metadatas=[metadata]
        )
        
        return memory_id
    
    async def search_memory(
        self,
        query: str,
        top_k: int = None,
        filter_metadata: Dict[str, Any] = None
    ) -> List[Dict[str, Any]]:
        """
        搜索记忆
        
        Args:
            query: 查询文本
            top_k: 返回结果数量
            filter_metadata: 元数据过滤条件
            
        Returns:
            记忆列表
        """
        if top_k is None:
            top_k = settings.VECTOR_SIMILARITY_TOP_K
        
        results = self.collection.query(
            query_texts=[query],
            n_results=top_k,
            where=filter_metadata
        )
        
        memories = []
        if results["ids"] and results["ids"][0]:
            for i, memory_id in enumerate(results["ids"][0]):
                memories.append({
                    "id": memory_id,
                    "content": results["documents"][0][i],
                    "metadata": results["metadatas"][0][i],
                    "distance": results["distances"][0][i] if results["distances"] else None
                })
        
        return memories
    
    async def get_memory(self, memory_id: str) -> Optional[Dict[str, Any]]:
        """获取指定记忆"""
        try:
            result = self.collection.get(ids=[memory_id])
            if result["ids"]:
                return {
                    "id": result["ids"][0],
                    "content": result["documents"][0],
                    "metadata": result["metadatas"][0]
                }
        except Exception:
            pass
        return None
    
    async def delete_memory(self, memory_id: str) -> bool:
        """删除记忆"""
        try:
            self.collection.delete(ids=[memory_id])
            return True
        except Exception:
            return False
    
    async def update_memory(
        self,
        memory_id: str,
        content: str = None,
        metadata: Dict[str, Any] = None
    ) -> bool:
        """更新记忆"""
        try:
            update_data = {}
            if content is not None:
                update_data["documents"] = [content]
            if metadata is not None:
                metadata["timestamp"] = datetime.now().isoformat()
                update_data["metadatas"] = [metadata]
            
            if update_data:
                self.collection.update(
                    ids=[memory_id],
                    **update_data
                )
            return True
        except Exception:
            return False
    
    async def clear_memory(self, filter_metadata: Dict[str, Any] = None):
        """清空记忆"""
        if filter_metadata:
            self.collection.delete(where=filter_metadata)
        else:
            # 删除集合并重新创建
            self.client.delete_collection("agent_memory")
            self.collection = self.client.create_collection(
                name="agent_memory",
                metadata={"hnsw:space": "cosine"}
            )
    
    async def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        count = self.collection.count()
        return {
            "total_memories": count,
            "collection_name": "agent_memory"
        }
