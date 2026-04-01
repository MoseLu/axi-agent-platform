"""
任务数据模型
"""
from enum import Enum
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    """任务状态枚举"""
    PENDING = "pending"         # 待处理
    PLANNING = "planning"       # 规划中
    RUNNING = "running"         # 执行中
    PAUSED = "paused"           # 暂停
    COMPLETED = "completed"     # 已完成
    FAILED = "failed"           # 失败
    CANCELLED = "cancelled"     # 已取消
    REVIEWING = "reviewing"     # 审查中
    MERGING = "merging"         # 合并中


class TaskType(str, Enum):
    """任务类型枚举"""
    GENERAL = "general"                 # 通用任务
    CODE_DEVELOPMENT = "code_development"  # 代码开发任务
    CODE_REVIEW = "code_review"           # 代码审查任务
    TEST_WRITING = "test_writing"         # 测试编写任务
    DOC_GENERATION = "doc_generation"     # 文档生成任务
    CLUSTER = "cluster"                   # 并行集群任务
    HYBRID = "hybrid"                     # 混合/组合任务


class TaskPriority(int, Enum):
    """任务优先级枚举"""
    LOW = 1
    NORMAL = 2
    HIGH = 3
    URGENT = 4


class SubTask(BaseModel):
    """子任务模型"""
    id: str = Field(..., description="子任务ID")
    name: str = Field(..., description="子任务名称")
    description: str = Field(..., description="子任务描述")
    agent_id: Optional[str] = Field(None, description="分配的智能体ID")
    agent_role: Optional[str] = Field(None, description="需要的智能体角色")
    status: TaskStatus = Field(default=TaskStatus.PENDING)
    dependencies: List[str] = Field(default=[], description="依赖的子任务ID")
    task_type: TaskType = Field(default=TaskType.GENERAL, description="子任务类型")
    input_data: Dict[str, Any] = Field(default={})
    output_data: Optional[Dict[str, Any]] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    worktree_path: Optional[str] = Field(None, description="代码隔离工作目录路径")


class TaskBase(BaseModel):
    """任务基础模型"""
    title: str = Field(..., min_length=1, max_length=200, description="任务标题")
    description: Optional[str] = Field(None, max_length=2000, description="任务描述")
    priority: TaskPriority = Field(default=TaskPriority.NORMAL, description="优先级")
    task_type: TaskType = Field(default=TaskType.GENERAL, description="任务类型")
    input_data: Dict[str, Any] = Field(default={}, description="输入数据")
    tags: List[str] = Field(default=[], description="标签")
    use_subagent_mode: bool = Field(default=False, description="是否使用subAgent模式")
    strategy_mode: str = Field(default="auto", description="协作策略选择模式: auto, manual")
    repository_path: Optional[str] = Field(None, description="代码仓库路径(代码开发任务)")


class TaskCreate(TaskBase):
    """创建任务请求模型"""
    parent_id: Optional[str] = Field(None, description="父任务ID")


class TaskUpdate(BaseModel):
    """更新任务请求模型"""
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    priority: Optional[TaskPriority] = None
    status: Optional[TaskStatus] = None
    tags: Optional[List[str]] = None
    task_type: Optional[TaskType] = None


class Task(TaskBase):
    """任务完整模型"""
    id: str = Field(..., description="任务唯一标识")
    status: TaskStatus = Field(default=TaskStatus.PENDING)
    parent_id: Optional[str] = Field(None, description="父任务ID")
    subtasks: List[SubTask] = Field(default=[], description="子任务列表")
    current_agent_id: Optional[str] = Field(None, description="当前执行智能体")
    output_data: Dict[str, Any] = Field(default={}, description="输出数据")
    progress: float = Field(default=0.0, ge=0, le=100, description="进度百分比")
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    
    class Config:
        from_attributes = True


class TaskExecutionEvent(BaseModel):
    """任务执行事件"""
    task_id: str
    event_type: str = Field(..., description="事件类型: started, progress, agent_switch, completed, failed")
    message: str
    data: Dict[str, Any] = Field(default={})
    timestamp: datetime = Field(default_factory=datetime.now)
