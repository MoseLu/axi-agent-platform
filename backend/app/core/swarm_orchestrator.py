"""
Swarm 协作编排器
"""
import asyncio
from typing import Dict, List, Optional, Any, Callable
from datetime import datetime

from app.schemas.agent import Agent, AgentStatus
from app.schemas.task import Task, TaskStatus, SubTask
from app.config import settings


class SwarmOrchestrator:
    """
    Swarm 协作编排器
    负责协调多个智能体之间的协作
    """
    
    def __init__(
        self,
        agent_manager,
        task_scheduler,
        memory_manager,
        tool_manager
    ):
        self.agent_manager = agent_manager
        self.task_scheduler = task_scheduler
        self.memory_manager = memory_manager
        self.tool_manager = tool_manager
        
        self._global_state: Dict[str, Any] = {}
        self._handoff_callbacks: List[Callable] = []
        self._max_agents = settings.MAX_AGENTS
    
    def add_handoff_callback(self, callback: Callable):
        """添加任务交接回调"""
        self._handoff_callbacks.append(callback)
    
    async def _notify_handoff(
        self,
        from_agent_id: str,
        to_agent_id: str,
        task_id: str,
        context: Dict[str, Any]
    ):
        """通知任务交接"""
        for callback in self._handoff_callbacks:
            try:
                if asyncio.iscoroutinefunction(callback):
                    await callback(from_agent_id, to_agent_id, task_id, context)
                else:
                    callback(from_agent_id, to_agent_id, task_id, context)
            except Exception as e:
                print(f"Handoff callback error: {e}")
    
    async def create_collaborative_task(
        self,
        title: str,
        description: str,
        agent_roles: List[str],
        input_data: Dict[str, Any] = None
    ) -> Task:
        """
        创建协作任务
        
        Args:
            title: 任务标题
            description: 任务描述
            agent_roles: 需要的智能体角色列表
            input_data: 输入数据
            
        Returns:
            创建的任务
        """
        from app.schemas.task import TaskCreate
        
        # 创建任务
        task = await self.task_scheduler.create_task(
            TaskCreate(
                title=title,
                description=description,
                input_data=input_data or {}
            )
        )
        
        # 为每个角色创建子任务
        subtasks = []
        for i, role in enumerate(agent_roles):
            # 查找具有该能力的智能体
            agents = await self.agent_manager.find_agents_by_capability(role)
            
            if agents:
                agent_id = agents[0].id
            else:
                # 创建临时智能体
                from app.schemas.agent import AgentCreate
                agent = await self.agent_manager.create_agent(
                    AgentCreate(
                        name=f"{role.capitalize()}Agent-{task.id[:8]}",
                        description=f"Auto-created agent for {role}",
                        system_prompt=f"You are a specialized agent for {role} tasks.",
                        capabilities=[role]
                    )
                )
                agent_id = agent.id
            
            subtask = SubTask(
                id=f"{task.id}-sub-{i}",
                name=f"{role} Task",
                description=f"Execute {role} operations for: {description}",
                agent_id=agent_id,
                status=TaskStatus.PENDING,
                dependencies=[] if i == 0 else [subtasks[i-1].id]  # 顺序依赖
            )
            subtasks.append(subtask)
        
        task.subtasks = subtasks
        return task
    
    async def handoff_task(
        self,
        task_id: str,
        from_agent_id: str,
        to_agent_id: str,
        handoff_context: Dict[str, Any] = None
    ) -> bool:
        """
        任务交接
        
        Args:
            task_id: 任务ID
            from_agent_id: 源智能体ID
            to_agent_id: 目标智能体ID
            handoff_context: 交接上下文
            
        Returns:
            是否成功
        """
        task = await self.task_scheduler.get_task(task_id)
        if not task:
            return False
        
        # 验证智能体
        from_agent = await self.agent_manager.get_agent(from_agent_id)
        to_agent = await self.agent_manager.get_agent(to_agent_id)
        
        if not from_agent or not to_agent:
            return False
        
        # 更新任务状态
        task.current_agent_id = to_agent_id
        task.updated_at = datetime.now()
        
        # 同步上下文到全局状态
        if handoff_context:
            self._global_state[task_id] = {
                **self._global_state.get(task_id, {}),
                **handoff_context,
                "handoff_from": from_agent_id,
                "handoff_to": to_agent_id,
                "handoff_time": datetime.now().isoformat()
            }
        
        # 通知回调
        await self._notify_handoff(
            from_agent_id,
            to_agent_id,
            task_id,
            handoff_context or {}
        )
        
        return True
    
    async def request_collaboration(
        self,
        agent_id: str,
        task_id: str,
        request_type: str,
        request_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        请求协作
        
        Args:
            agent_id: 请求智能体ID
            task_id: 任务ID
            request_type: 请求类型
            request_data: 请求数据
            
        Returns:
            协作结果
        """
        # 根据请求类型处理
        if request_type == "information":
            # 信息查询请求
            return await self._handle_info_request(request_data)
        
        elif request_type == "tool_execution":
            # 工具执行请求
            tool_id = request_data.get("tool_id")
            parameters = request_data.get("parameters", {})
            
            if self.tool_manager:
                result = await self.tool_manager.execute_tool(
                    tool_id=tool_id,
                    parameters=parameters,
                    agent_id=agent_id,
                    task_id=task_id
                )
                return result.model_dump()
        
        elif request_type == "agent_handoff":
            # 智能体交接请求
            target_capability = request_data.get("capability")
            agents = await self.agent_manager.find_agents_by_capability(target_capability)
            
            if agents:
                target_agent = agents[0]
                success = await self.handoff_task(
                    task_id=task_id,
                    from_agent_id=agent_id,
                    to_agent_id=target_agent.id,
                    handoff_context=request_data.get("context", {})
                )
                return {"success": success, "target_agent": target_agent.id}
            else:
                return {"success": False, "error": f"No agent with capability: {target_capability}"}
        
        elif request_type == "memory_query":
            # 记忆查询请求
            query = request_data.get("query")
            if self.memory_manager:
                memories = await self.memory_manager.search_long_term_memory(
                    query=query,
                    top_k=request_data.get("top_k", 5)
                )
                return {"memories": memories}
        
        return {"success": False, "error": f"Unknown request type: {request_type}"}
    
    async def _handle_info_request(self, request_data: Dict[str, Any]) -> Dict[str, Any]:
        """处理信息请求"""
        query = request_data.get("query")
        
        # 从全局状态搜索
        results = []
        for task_id, state in self._global_state.items():
            if query.lower() in str(state).lower():
                results.append({
                    "task_id": task_id,
                    "data": state
                })
        
        return {"results": results}
    
    async def get_global_state(self, task_id: str = None) -> Dict[str, Any]:
        """获取全局状态"""
        if task_id:
            return self._global_state.get(task_id, {})
        return self._global_state.copy()
    
    async def update_global_state(
        self,
        task_id: str,
        data: Dict[str, Any]
    ):
        """更新全局状态"""
        if task_id not in self._global_state:
            self._global_state[task_id] = {}
        
        self._global_state[task_id].update(data)
        self._global_state[task_id]["last_update"] = datetime.now().isoformat()
    
    async def execute_parallel(
        self,
        agent_ids: List[str],
        task_input: str,
        context: Dict[str, Any] = None
    ) -> List[Dict[str, Any]]:
        """
        并行执行多个智能体
        
        Args:
            agent_ids: 智能体ID列表
            task_input: 任务输入
            context: 上下文
            
        Returns:
            执行结果列表
        """
        if len(agent_ids) > self._max_agents:
            raise Exception(f"Too many agents. Max: {self._max_agents}")
        
        # 并行执行
        tasks = [
            self.agent_manager.execute_task(
                agent_id=agent_id,
                task_input=task_input,
                context=context or {}
            )
            for agent_id in agent_ids
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        return [
            {"success": not isinstance(r, Exception), "result": r if not isinstance(r, Exception) else str(r)}
            for r in results
        ]
    
    async def get_collaboration_stats(self) -> Dict[str, Any]:
        """获取协作统计"""
        return {
            "global_state_tasks": len(self._global_state),
            "max_agents": self._max_agents,
            "active_handoffs": len(self._handoff_callbacks)
        }
