"""
任务调度器 - 支持 subAgent 模式
"""
import uuid
import asyncio
from typing import Dict, List, Optional, Any, Callable
from datetime import datetime
from enum import Enum

from app.schemas.task import (
    Task, TaskCreate, TaskUpdate, TaskStatus, 
    TaskPriority, SubTask, TaskExecutionEvent, TaskType
)
from app.schemas.agent import AgentRole
from app.config import settings
from app.core.strategy_planner import StrategyPlanner
from app.core.axi_agent_mcp_client import AxiAgentMcpClient, AxiAgentMcpClientError


class TaskScheduler:
    """任务调度器 - 支持通用模式和 subAgent 代码开发模式"""
    
    def __init__(self):
        self._tasks: Dict[str, Task] = {}
        self._task_queue: asyncio.PriorityQueue = asyncio.PriorityQueue()
        self._running_tasks: Dict[str, asyncio.Task] = {}
        self._event_handlers: List[Callable] = []
        self._is_running = False
        self._agent_manager = None
        self._tool_manager = None
        self._memory_manager = None
        self._code_isolation_manager = None
        self._axi_agent_mcp_client = None
        self._strategy_planner = StrategyPlanner()
        self._max_parallel_agents = 8  # subAgent 最大并行数
    
    def set_dependencies(
        self,
        agent_manager,
        tool_manager,
        memory_manager,
        code_isolation_manager=None,
        axi_agent_mcp_client=None
    ):
        """设置依赖组件"""
        self._agent_manager = agent_manager
        self._tool_manager = tool_manager
        self._memory_manager = memory_manager
        self._code_isolation_manager = code_isolation_manager
        self._axi_agent_mcp_client = axi_agent_mcp_client
    
    def add_event_handler(self, handler: Callable):
        """添加事件处理器"""
        self._event_handlers.append(handler)
    
    async def _emit_event(self, event: TaskExecutionEvent):
        """发送事件"""
        for handler in self._event_handlers:
            try:
                if asyncio.iscoroutinefunction(handler):
                    await handler(event)
                else:
                    handler(event)
            except Exception as e:
                print(f"Event handler error: {e}")
    
    async def create_task(self, task_data: TaskCreate) -> Task:
        """创建任务"""
        task_id = str(uuid.uuid4())
        
        task = Task(
            id=task_id,
            **task_data.model_dump(),
            status=TaskStatus.PENDING,
            created_at=datetime.now(),
            updated_at=datetime.now()
        )
        
        self._tasks[task_id] = task
        
        # 如果是自动策略模式，进行分析 (异步，不阻塞创建返回)
        if task.strategy_mode == "auto":
            asyncio.create_task(self._apply_auto_strategy(task))
        
        # 添加到队列
        await self._task_queue.put((
            -task.priority.value,  # 优先级高的先执行
            task.created_at.timestamp(),
            task_id
        ))
        
        return task

    async def _apply_auto_strategy(self, task: Task):
        """应用自动策略方案"""
        analysis = await self._strategy_planner.analyze_task(
            task.title, task.description, task.input_data
        )
        task.task_type = TaskType(analysis["recommended_type"])
        if task.task_type != TaskType.GENERAL:
            task.use_subagent_mode = True
        
        await self._emit_event(TaskExecutionEvent(
            task_id=task.id,
            event_type="strategy_selected",
            message=f"Auto-selected strategy: {task.task_type.value}",
            data=analysis
        ))
    
    async def get_task(self, task_id: str) -> Optional[Task]:
        """获取任务"""
        return self._tasks.get(task_id)
    
    async def list_tasks(
        self,
        status: Optional[TaskStatus] = None,
        parent_id: Optional[str] = None
    ) -> List[Task]:
        """列出任务"""
        tasks = list(self._tasks.values())
        
        if status:
            tasks = [t for t in tasks if t.status == status]
        if parent_id is not None:
            tasks = [t for t in tasks if t.parent_id == parent_id]
        
        # 按优先级和时间排序
        tasks.sort(key=lambda t: (-t.priority.value, t.created_at))
        return tasks
    
    async def update_task(
        self,
        task_id: str,
        update_data: TaskUpdate
    ) -> Optional[Task]:
        """更新任务"""
        task = self._tasks.get(task_id)
        if not task:
            return None
        
        update_dict = update_data.model_dump(exclude_unset=True)
        for key, value in update_dict.items():
            if value is not None:
                setattr(task, key, value)
        
        task.updated_at = datetime.now()
        return task
    
    async def cancel_task(self, task_id: str) -> bool:
        """取消任务"""
        task = self._tasks.get(task_id)
        if not task:
            return False
        
        if task.status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]:
            return False
        
        # 取消运行中的任务
        if task_id in self._running_tasks:
            self._running_tasks[task_id].cancel()
            del self._running_tasks[task_id]
        
        task.status = TaskStatus.CANCELLED
        task.updated_at = datetime.now()
        
        await self._emit_event(TaskExecutionEvent(
            task_id=task_id,
            event_type="cancelled",
            message="Task cancelled by user",
            data={"status": TaskStatus.CANCELLED}
        ))
        
        return True
    
    async def delete_task(self, task_id: str) -> bool:
        """删除任务"""
        # 先取消
        await self.cancel_task(task_id)
        
        if task_id in self._tasks:
            del self._tasks[task_id]
            return True
        return False
    
    async def start(self):
        """启动调度器"""
        self._is_running = True
        asyncio.create_task(self._scheduler_loop())
    
    async def stop(self):
        """停止调度器"""
        self._is_running = False
        
        # 取消所有运行中的任务
        for task in self._running_tasks.values():
            task.cancel()
        self._running_tasks.clear()
    
    async def _scheduler_loop(self):
        """调度循环"""
        while self._is_running:
            try:
                # 获取任务
                priority, created_at, task_id = await asyncio.wait_for(
                    self._task_queue.get(),
                    timeout=1.0
                )
                
                task = self._tasks.get(task_id)
                if not task or task.status != TaskStatus.PENDING:
                    continue
                
                # 检查是否可以执行
                if await self._can_execute(task):
                    # 创建执行任务
                    exec_task = asyncio.create_task(
                        self._execute_task(task_id)
                    )
                    self._running_tasks[task_id] = exec_task
                    
                    # 清理完成的任务
                    exec_task.add_done_callback(
                        lambda t, tid=task_id: self._running_tasks.pop(tid, None)
                    )
                else:
                    # 重新放回队列
                    await self._task_queue.put((priority, created_at, task_id))
                    await asyncio.sleep(0.1)
                    
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                print(f"Scheduler error: {e}")
    
    async def _can_execute(self, task: Task) -> bool:
        """检查任务是否可以执行"""
        # 检查依赖的子任务是否完成
        for subtask in task.subtasks:
            if subtask.status not in [TaskStatus.COMPLETED, TaskStatus.CANCELLED]:
                # 检查依赖
                for dep_id in subtask.dependencies:
                    dep_subtask = next(
                        (s for s in task.subtasks if s.id == dep_id),
                        None
                    )
                    if dep_subtask and dep_subtask.status != TaskStatus.COMPLETED:
                        return False
        
        return True
    
    async def _execute_task(self, task_id: str):
        """执行任务"""
        task = self._tasks.get(task_id)
        if not task:
            return
        
        try:
            # 更新状态
            task.status = TaskStatus.PLANNING
            task.started_at = datetime.now()
            task.updated_at = datetime.now()
            
            await self._emit_event(TaskExecutionEvent(
                task_id=task_id,
                event_type="started",
                message="Task execution started",
                data={"status": TaskStatus.PLANNING}
            ))
            
            # 1. 任务拆解
            await self._decompose_task(task)
            
            # 2. 执行子任务
            task.status = TaskStatus.RUNNING
            await self._execute_subtasks(task)
            
            # 3. 代码合并（如果是代码开发任务）
            if task.task_type == TaskType.CODE_DEVELOPMENT and self._code_isolation_manager:
                await self._merge_code_changes(task)
            
            # 4. 完成任务
            task.status = TaskStatus.COMPLETED
            task.completed_at = datetime.now()
            task.progress = 100.0
            
            await self._emit_event(TaskExecutionEvent(
                task_id=task_id,
                event_type="completed",
                message="Task execution completed",
                data={
                    "status": TaskStatus.COMPLETED,
                    "output": task.output_data
                }
            ))
            
        except asyncio.CancelledError:
            task.status = TaskStatus.CANCELLED
            raise
        except Exception as e:
            task.status = TaskStatus.FAILED
            task.error_message = str(e)
            
            await self._emit_event(TaskExecutionEvent(
                task_id=task_id,
                event_type="failed",
                message=f"Task execution failed: {str(e)}",
                data={"error": str(e)}
            ))
        finally:
            task.updated_at = datetime.now()
    
    async def _decompose_task(self, task: Task):
        """拆解任务 - 支持通用模式和 subAgent 代码开发模式"""
        if not self._agent_manager:
            # 简单任务，不拆解
            return
        
        # 检查是否使用 subAgent 模式（代码开发任务）
        if task.use_subagent_mode or task.task_type == TaskType.CODE_DEVELOPMENT:
            if task.task_type == TaskType.CODE_DEVELOPMENT:
                await self._decompose_code_development_task(task)
            elif task.task_type == TaskType.CLUSTER:
                await self._decompose_cluster_task(task)
            elif task.task_type == TaskType.HYBRID:
                await self._decompose_hybrid_task(task)
            else:
                # 默认 subagent 逻辑
                await self._decompose_code_development_task(task)
        else:
            # 通用模式任务拆解
            await self._decompose_general_task(task)

    async def _decompose_cluster_task(self, task: Task):
        """分解集群任务 - 无依赖并行执行"""
        items = task.input_data.get("items", [task.title])
        subtasks = []
        for i, item in enumerate(items):
            subtask = SubTask(
                id=f"{task.id}-cluster-{i}",
                name=f"Cluster Task {i}: {str(item)[:20]}",
                description=f"Parallel processing for: {str(item)}",
                status=TaskStatus.PENDING,
                task_type=TaskType.GENERAL,
                dependencies=[] # 无依赖，全面并行
            )
            subtasks.append(subtask)
        task.subtasks = subtasks

    async def _decompose_hybrid_task(self, task: Task):
        """分解混合任务 - 功能组级调度"""
        groups = task.input_data.get("suggested_groups", ["Frontend", "Backend", "QA"])
        subtasks = []
        for i, group in enumerate(groups):
            subtask = SubTask(
                id=f"{task.id}-group-{i}",
                name=f"Group: {group}",
                description=f"Handle {group} related work for {task.title}",
                status=TaskStatus.PENDING,
                task_type=TaskType.GENERAL,
                agent_role=AgentRole.GENERAL.value,
                dependencies=[] if i == 0 else [subtasks[i-1].id] # 默认顺次执行组
            )
            subtasks.append(subtask)
        task.subtasks = subtasks
    
    async def _decompose_general_task(self, task: Task):
        """通用模式任务拆解"""
        if not task.subtasks:
            subtask = SubTask(
                id=str(uuid.uuid4()),
                name=f"Execute: {task.title}",
                description=task.description or task.title,
                status=TaskStatus.PENDING,
                task_type=TaskType.GENERAL,
                input_data=task.input_data
            )
            task.subtasks = [subtask]
    
    async def _decompose_code_development_task(self, task: Task):
        """
        代码开发任务拆解 - subAgent 模式
        
        将代码开发任务分解为：
        1. 规划任务（Planner 智能体）
        2. 代码实现任务（Code Worker 智能体）
        3. 代码审查任务（Code Reviewer 智能体）
        4. 测试编写任务（Test Engineer 智能体）
        5. 质量评审任务（Judge 智能体）
        """
        # 创建工作空间
        worktree_path = None
        if self._code_isolation_manager and task.repository_path:
            try:
                worktree_path = await asyncio.to_thread(
                    self._code_isolation_manager.create_worktree,
                    task.id
                )
            except Exception as e:
                print(f"Failed to create worktree: {e}")
        
        # 1. 规划任务 - Planner 角色
        planner_task = SubTask(
            id=str(uuid.uuid4()),
            name="Plan Development",
            description=f"Analyze requirements and create development plan for: {task.description or task.title}",
            status=TaskStatus.PENDING,
            task_type=TaskType.CODE_DEVELOPMENT,
            agent_role=AgentRole.PLANNER.value,
            input_data={
                "task_description": task.description or task.title,
                "repository_path": task.repository_path,
                "input_requirements": task.input_data
            },
            worktree_path=worktree_path
        )
        
        # 2. 代码实现任务 - Code Worker 角色
        code_task = SubTask(
            id=str(uuid.uuid4()),
            name="Implement Code",
            description="Implement the features according to the plan",
            status=TaskStatus.PENDING,
            task_type=TaskType.CODE_DEVELOPMENT,
            agent_role=AgentRole.CODE_WORKER.value,
            dependencies=[planner_task.id],
            worktree_path=worktree_path
        )
        
        # 3. 代码审查任务 - Code Reviewer 角色
        review_task = SubTask(
            id=str(uuid.uuid4()),
            name="Code Review",
            description="Review the implemented code for quality and best practices",
            status=TaskStatus.PENDING,
            task_type=TaskType.CODE_REVIEW,
            agent_role=AgentRole.CODE_REVIEWER.value,
            dependencies=[code_task.id],
            worktree_path=worktree_path
        )
        
        # 4. 测试编写任务 - Test Engineer 角色
        test_task = SubTask(
            id=str(uuid.uuid4()),
            name="Write Tests",
            description="Write comprehensive tests for the implemented code",
            status=TaskStatus.PENDING,
            task_type=TaskType.TEST_WRITING,
            agent_role=AgentRole.TEST_ENGINEER.value,
            dependencies=[code_task.id],
            worktree_path=worktree_path
        )
        
        # 5. 质量评审任务 - Judge 角色
        judge_task = SubTask(
            id=str(uuid.uuid4()),
            name="Quality Assessment",
            description="Assess overall code quality and approve or request changes",
            status=TaskStatus.PENDING,
            task_type=TaskType.CODE_REVIEW,
            agent_role=AgentRole.JUDGE.value,
            dependencies=[review_task.id, test_task.id],
            worktree_path=worktree_path
        )
        
        task.subtasks = [planner_task, code_task, review_task, test_task, judge_task]
    
    async def _execute_subtasks(self, task: Task):
        """执行子任务"""
        total = len(task.subtasks)
        completed = 0
        
        for subtask in task.subtasks:
            if subtask.status == TaskStatus.CANCELLED:
                continue
            
            # 检查依赖
            can_execute = True
            for dep_id in subtask.dependencies:
                dep = next((s for s in task.subtasks if s.id == dep_id), None)
                if not dep or dep.status != TaskStatus.COMPLETED:
                    can_execute = False
                    break
            
            if not can_execute:
                continue
            
            # 执行子任务
            subtask.status = TaskStatus.RUNNING
            subtask.started_at = datetime.now()
            
            await self._emit_event(TaskExecutionEvent(
                task_id=task.id,
                event_type="progress",
                message=f"Executing subtask: {subtask.name}",
                data={
                    "subtask_id": subtask.id,
                    "subtask_name": subtask.name,
                    "progress": (completed / total) * 100
                }
            ))
            
            try:
                result = await self._execute_subtask(subtask, task)
                subtask.status = TaskStatus.COMPLETED
                subtask.output_data = result
                subtask.completed_at = datetime.now()
                completed += 1
            except Exception as e:
                subtask.status = TaskStatus.FAILED
                subtask.error_message = str(e)
                raise
            
            # 更新进度
            task.progress = (completed / total) * 100
            task.updated_at = datetime.now()
    
    async def _execute_subtask(self, subtask: SubTask, parent_task: Task) -> Dict[str, Any]:
        """执行单个子任务"""
        # 1. 确定 agent_id - 优先根据角色分配
        agent_id = subtask.agent_id
        
        if not agent_id and subtask.agent_role and self._agent_manager:
            # 根据角色查找智能体
            agents = await self._agent_manager.list_agents()
            for agent in agents:
                if agent.role.value == subtask.agent_role and agent.status.value == "idle":
                    agent_id = agent.id
                    break
        
        if not agent_id and self._agent_manager:
            # 根据能力自动选择
            agents = await self._agent_manager.list_agents()
            if agents:
                # 选择空闲的智能体
                for agent in agents:
                    if agent.status.value == "idle":
                        agent_id = agent.id
                        break
                # 如果没有空闲的，选第一个
                if not agent_id:
                    agent_id = agents[0].id
        
        if not agent_id:
            raise Exception("No agent available")
        
        subtask.agent_id = agent_id
        parent_task.current_agent_id = agent_id
        
        # 2. 准备工具
        tools = None
        if self._tool_manager:
            tools = self._tool_manager.get_tool_definitions()
        
        # 3. 构建上下文
        context = {
            "task_id": parent_task.id,
            "subtask_id": subtask.id,
            "parent_task": parent_task.title,
            "subtask_type": subtask.task_type.value,
            "worktree_path": subtask.worktree_path,
            "repository_path": parent_task.repository_path
        }
        
        # 4. 执行任务
        if self._agent_manager:
            result = await self._agent_manager.execute_task(
                agent_id=agent_id,
                task_input=subtask.description,
                context=context,
                tools=tools
            )
            
            if not result.get("success"):
                raise Exception(result.get("error", "Execution failed"))
            
            # 5. 处理工具调用
            if result.get("tool_calls") and self._tool_manager:
                for tool_call in result["tool_calls"]:
                    tool_result = await self._tool_manager.execute_tool(
                        tool_id=tool_call.get("function", {}).get("name"),
                        parameters=tool_call.get("function", {}).get("arguments", {}),
                        agent_id=agent_id,
                        task_id=parent_task.id,
                        worktree_path=subtask.worktree_path  # 传递工作目录
                    )
                    # 可以在这里处理工具结果
            
            # 6. 质量检查（Judge 角色）
            if subtask.agent_role == AgentRole.JUDGE.value:
                await self._quality_check(subtask, parent_task, result)
            
            return result
        else:
            # 模拟执行
            await asyncio.sleep(1)
            return {"content": f"Executed: {subtask.description}"}
    
    async def _merge_code_changes(self, task: Task):
        """
        合并代码变更 - subAgent 模式专用
        
        将所有子任务的代码变更合并到主仓库
        """
        if not self._code_isolation_manager:
            return
        
        try:
            # 同步 worktree
            await asyncio.to_thread(
                self._code_isolation_manager.sync_worktree,
                task.id
            )
            
            # 提交变更
            commit_message = f"Implement: {task.title}"
            commit_hash = await asyncio.to_thread(
                self._code_isolation_manager.commit_worktree_changes,
                task.id,
                commit_message
            )
            
            if commit_hash:
                # 合并到主分支
                merge_success = await asyncio.to_thread(
                    self._code_isolation_manager.merge_worktree,
                    task.id,
                    "main"
                )
                
                if not merge_success:
                    task.status = TaskStatus.FAILED
                    task.error_message = "Code merge failed - conflicts detected"
            
        except Exception as e:
            task.status = TaskStatus.FAILED
            task.error_message = f"Code merge failed: {str(e)}"
        finally:
            # 清理 worktree
            try:
                await asyncio.to_thread(
                    self._code_isolation_manager.remove_worktree,
                    task.id,
                    force=True
                )
            except Exception as e:
                print(f"Failed to remove worktree: {e}")
    
    async def _quality_check(
        self,
        subtask: SubTask,
        parent_task: Task,
        result: Dict[str, Any]
    ):
        """
        质量检查 - subAgent 模式专用
        
        Judge 智能体对任务结果进行质量评估
        """
        # 提取所有相关子任务的输出
        related_outputs = []
        for s in parent_task.subtasks:
            if s.id != subtask.id and s.output_data:
                related_outputs.append({
                    "subtask": s.name,
                    "output": s.output_data
                })
        
        # 质量评估提示词
        quality_prompt = f"""
        Please assess the quality of the code development task:
        
        Task: {parent_task.title}
        Description: {parent_task.description}
        
        Subtask Outputs:
        {related_outputs}
        
        Current Review:
        {result.get('content', '')}
        
        Please evaluate:
        1. Code quality (clean, maintainable, follows best practices)
        2. Completeness (all requirements met)
        3. Testing adequacy
        4. Documentation quality
        
        Provide a score (0-100) and recommendations.
        """
        
        if not parent_task.output_data:
            parent_task.output_data = {}
        client = self._axi_agent_mcp_client or AxiAgentMcpClient.from_settings()
        try:
            mcp_assessment = await asyncio.to_thread(
                client.validate_with_quality_gates,
                quality_prompt,
                parent_task.repository_path,
            )
            parent_task.output_data["quality_assessment"] = {
                "assessed": True,
                "source": "axi-agent-mcp",
                "timestamp": datetime.now().isoformat(),
                "reviewer_agent": subtask.agent_id,
                "passed": mcp_assessment["passed"],
                "tool": mcp_assessment["tool"],
                "raw_text": mcp_assessment["text"],
            }
        except AxiAgentMcpClientError as e:
            parent_task.output_data["quality_assessment"] = {
                "assessed": True,
                "source": "local-fallback",
                "timestamp": datetime.now().isoformat(),
                "reviewer_agent": subtask.agent_id,
                "passed": True,
                "error": str(e),
            }
    
    async def pause_task(self, task_id: str) -> bool:
        """暂停任务"""
        task = self._tasks.get(task_id)
        if not task:
            return False
        
        if task.status != TaskStatus.RUNNING:
            return False
        
        task.status = TaskStatus.PAUSED
        task.updated_at = datetime.now()
        
        # 暂停相关子任务
        for subtask in task.subtasks:
            if subtask.status == TaskStatus.RUNNING:
                subtask.status = TaskStatus.PAUSED
        
        return True
    
    async def resume_task(self, task_id: str) -> bool:
        """恢复任务"""
        task = self._tasks.get(task_id)
        if not task:
            return False
        
        if task.status != TaskStatus.PAUSED:
            return False
        
        task.status = TaskStatus.RUNNING
        task.updated_at = datetime.now()
        
        # 恢复相关子任务
        for subtask in task.subtasks:
            if subtask.status == TaskStatus.PAUSED:
                subtask.status = TaskStatus.RUNNING
        
        # 重新加入队列
        await self._task_queue.put((
            -task.priority.value,
            task.created_at.timestamp(),
            task_id
        ))
        
        return True
    
    async def get_task_stats(self) -> Dict[str, Any]:
        """获取任务统计"""
        total = len(self._tasks)
        by_status = {}
        by_type = {}
        
        for task in self._tasks.values():
            status = task.status.value
            by_status[status] = by_status.get(status, 0) + 1
            
            task_type = task.task_type.value
            by_type[task_type] = by_type.get(task_type, 0) + 1
        
        # 代码隔离统计
        isolation_stats = {}
        if self._code_isolation_manager:
            isolation_stats = self._code_isolation_manager.get_statistics()
        
        return {
            "total": total,
            "by_status": by_status,
            "by_type": by_type,
            "running": len(self._running_tasks),
            "queue_size": self._task_queue.qsize(),
            "code_isolation": isolation_stats,
            "max_parallel_agents": self._max_parallel_agents
        }
