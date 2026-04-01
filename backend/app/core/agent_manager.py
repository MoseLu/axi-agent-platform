"""
智能体管理器
"""
import uuid
import asyncio
from typing import Dict, List, Optional, Any, Callable
from datetime import datetime

from app.schemas.agent import Agent, AgentCreate, AgentUpdate, AgentStatus, AgentExecutionRequest
from app.models.base import Message, MessageRole
from app.config import settings


class AgentInstance:
    """智能体实例"""
    
    def __init__(self, agent_def: Agent, model_connector):
        self.definition = agent_def
        self.model = model_connector
        self.status = AgentStatus.IDLE
        self.current_task_id: Optional[str] = None
        self.message_history: List[Message] = []
        self.created_at = datetime.now()
        self.last_active: Optional[datetime] = None
    
    async def execute(
        self,
        task_input: str,
        context: Dict[str, Any],
        tools: List[Dict] = None
    ) -> Dict[str, Any]:
        """执行任务"""
        self.status = AgentStatus.BUSY
        self.last_active = datetime.now()
        
        try:
            # 构建消息
            messages = [
                Message(role=MessageRole.SYSTEM, content=self.definition.system_prompt)
            ]
            
            # 添加上下文
            if context:
                context_str = f"Context: {context}\n\n"
            else:
                context_str = ""
            
            messages.append(
                Message(role=MessageRole.USER, content=f"{context_str}Task: {task_input}")
            )
            
            # 调用模型
            response = await self.model.chat(
                messages=messages,
                model=self.definition.model_name,
                temperature=self.definition.temperature,
                max_tokens=self.definition.max_tokens,
                tools=tools
            )
            
            self.status = AgentStatus.IDLE
            
            return {
                "success": True,
                "content": response.content,
                "tool_calls": response.tool_calls,
                "usage": response.usage,
                "model": response.model
            }
        except Exception as e:
            self.status = AgentStatus.ERROR
            return {
                "success": False,
                "error": str(e)
            }
    
    async def execute_stream(
        self,
        task_input: str,
        context: Dict[str, Any],
        tools: List[Dict] = None
):
        """流式执行任务"""
        self.status = AgentStatus.BUSY
        self.last_active = datetime.now()
        
        try:
            messages = [
                Message(role=MessageRole.SYSTEM, content=self.definition.system_prompt)
            ]
            
            if context:
                context_str = f"Context: {context}\n\n"
            else:
                context_str = ""
            
            messages.append(
                Message(role=MessageRole.USER, content=f"{context_str}Task: {task_input}")
            )
            
            async for chunk in self.model.chat_stream(
                messages=messages,
                model=self.definition.model_name,
                temperature=self.definition.temperature,
                max_tokens=self.definition.max_tokens,
                tools=tools
            ):
                yield chunk
            
            self.status = AgentStatus.IDLE
        except Exception as e:
            self.status = AgentStatus.ERROR
            yield f"Error: {str(e)}"
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "id": self.definition.id,
            "name": self.definition.name,
            "status": self.status.value,
            "current_task_id": self.current_task_id,
            "created_at": self.created_at.isoformat(),
            "last_active": self.last_active.isoformat() if self.last_active else None
        }


class AgentManager:
    """智能体管理器"""
    
    def __init__(self):
        self._agents: Dict[str, Agent] = {}  # 智能体定义
        self._instances: Dict[str, AgentInstance] = {}  # 运行实例
        self._model_factory: Optional[Callable] = None
    
    def set_model_factory(self, factory: Callable):
        """设置模型工厂函数"""
        self._model_factory = factory
    
    async def create_agent(self, agent_data: AgentCreate) -> Agent:
        """创建智能体"""
        agent_id = str(uuid.uuid4())
        
        agent = Agent(
            id=agent_id,
            **agent_data.model_dump(),
            status=AgentStatus.IDLE,
            created_at=datetime.now(),
            updated_at=datetime.now()
        )
        
        self._agents[agent_id] = agent
        return agent
    
    async def get_agent(self, agent_id: str) -> Optional[Agent]:
        """获取智能体"""
        return self._agents.get(agent_id)
    
    async def list_agents(self, status: Optional[AgentStatus] = None) -> List[Agent]:
        """列出智能体"""
        agents = list(self._agents.values())
        if status:
            agents = [a for a in agents if a.status == status]
        return agents
    
    async def update_agent(self, agent_id: str, update_data: AgentUpdate) -> Optional[Agent]:
        """更新智能体"""
        agent = self._agents.get(agent_id)
        if not agent:
            return None
        
        update_dict = update_data.model_dump(exclude_unset=True)
        for key, value in update_dict.items():
            if value is not None:
                setattr(agent, key, value)
        
        agent.updated_at = datetime.now()
        return agent
    
    async def delete_agent(self, agent_id: str) -> bool:
        """删除智能体"""
        if agent_id in self._agents:
            # 如果正在运行，先停止
            if agent_id in self._instances:
                await self.stop_agent(agent_id)
            
            del self._agents[agent_id]
            return True
        return False
    
    async def start_agent(self, agent_id: str) -> Optional[AgentInstance]:
        """启动智能体实例"""
        agent = self._agents.get(agent_id)
        if not agent:
            return None
        
        if agent_id in self._instances:
            return self._instances[agent_id]
        
        if not self._model_factory:
            raise Exception("Model factory not set")
        
        # 创建模型连接器
        model = self._model_factory(agent.model_name)
        
        # 创建实例
        instance = AgentInstance(agent, model)
        self._instances[agent_id] = instance
        agent.status = AgentStatus.IDLE
        
        return instance
    
    async def stop_agent(self, agent_id: str) -> bool:
        """停止智能体实例"""
        if agent_id in self._instances:
            instance = self._instances[agent_id]
            instance.status = AgentStatus.OFFLINE
            del self._instances[agent_id]
            
            agent = self._agents.get(agent_id)
            if agent:
                agent.status = AgentStatus.OFFLINE
            
            return True
        return False
    
    async def get_instance(self, agent_id: str) -> Optional[AgentInstance]:
        """获取运行中的实例"""
        return self._instances.get(agent_id)
    
    async def execute_task(
        self,
        agent_id: str,
        task_input: str,
        context: Dict[str, Any] = None,
        tools: List[Dict] = None
    ) -> Dict[str, Any]:
        """分配任务给智能体"""
        instance = await self.get_instance(agent_id)
        if not instance:
            # 自动启动
            instance = await self.start_agent(agent_id)
            if not instance:
                return {"success": False, "error": "Agent not found"}
        
        if instance.status == AgentStatus.BUSY:
            return {"success": False, "error": "Agent is busy"}
        
        result = await instance.execute(task_input, context or {}, tools)
        
        # 更新统计
        agent = self._agents.get(agent_id)
        if agent:
            agent.task_count += 1
            if result.get("success"):
                agent.success_count += 1
            agent.last_active = datetime.now()
        
        return result
    
    async def find_agents_by_capability(self, capability: str) -> List[Agent]:
        """根据能力查找智能体"""
        return [
            agent for agent in self._agents.values()
            if capability in agent.capabilities
        ]
    
    async def get_agent_stats(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """获取智能体统计"""
        agent = self._agents.get(agent_id)
        instance = self._instances.get(agent_id)
        
        if not agent:
            return None
        
        return {
            "agent": agent.model_dump(),
            "instance": instance.to_dict() if instance else None,
            "is_running": instance is not None,
            "success_rate": agent.success_count / agent.task_count if agent.task_count > 0 else 0
        }
    
    async def pause_agent(self, agent_id: str) -> bool:
        """暂停智能体"""
        agent = self._agents.get(agent_id)
        instance = self._instances.get(agent_id)
        
        if agent and instance:
            agent.status = AgentStatus.PAUSED
            instance.status = AgentStatus.PAUSED
            return True
        return False
    
    async def resume_agent(self, agent_id: str) -> bool:
        """恢复智能体"""
        agent = self._agents.get(agent_id)
        instance = self._instances.get(agent_id)
        
        if agent and instance:
            agent.status = AgentStatus.IDLE
            instance.status = AgentStatus.IDLE
            return True
        return False
