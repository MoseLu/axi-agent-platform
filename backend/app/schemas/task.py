"""
任务数据模型
"""
from enum import Enum
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


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


class TaskRoute(str, Enum):
    """task-execution-routing/v1 的控制流归属。"""
    WORKFLOW = "workflow"
    BOUNDED_AGENT = "bounded_agent"
    ESCALATE = "escalate"


class TaskExecutionLimits(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    max_steps: int = Field(..., alias="maxSteps", ge=0, le=100)
    max_wall_time_ms: int = Field(..., alias="maxWallTimeMs", ge=0, le=3_600_000)
    max_model_tokens: int = Field(..., alias="maxModelTokens", ge=0, le=1_000_000)
    max_estimated_cost: float = Field(..., alias="maxEstimatedCost", ge=0, le=10_000)


class TaskContextReference(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(..., min_length=1)
    version: str = Field(..., min_length=1)
    uri: Optional[str] = Field(None, max_length=2048)


class TaskRouteDecision(BaseModel):
    """工作流签发的权威路由决定；历史策略字段不能替代它。"""
    model_config = ConfigDict(populate_by_name=True)

    schema_version: Literal["task-execution-routing/v1"] = Field(
        "task-execution-routing/v1", alias="schemaVersion"
    )
    route: TaskRoute
    reason_code: str = Field(..., alias="reasonCode", min_length=1)
    policy_version: str = Field(..., alias="policyVersion", min_length=1)
    trace_id: str = Field(..., alias="traceId", min_length=8, max_length=128)
    idempotency_key: str = Field(..., alias="idempotencyKey", min_length=8, max_length=256)
    context_refs: List[TaskContextReference] = Field(default_factory=list, alias="contextRefs")
    tool_allowlist: List[str] = Field(default_factory=list, alias="toolAllowlist")
    sandbox: Literal["none", "read_only"]
    limits: TaskExecutionLimits


class TaskRouteCredential(BaseModel):
    """短期路由凭证；签名由工作流和运行时共享的内部密钥校验。"""
    model_config = ConfigDict(populate_by_name=True)

    credential_id: str = Field(..., alias="credentialId", min_length=8)
    subject: str = Field(..., min_length=1)
    decision_digest: str = Field(..., alias="decisionDigest", pattern=r"^[a-f0-9]{64}$")
    issued_at: str = Field(..., alias="issuedAt", min_length=20)
    expires_at: str = Field(..., alias="expiresAt", min_length=20)
    signature: str = Field(..., min_length=32)


class EffectProposal(BaseModel):
    """受限 Agent 可以提出、但绝不能直接执行的副作用。"""
    model_config = ConfigDict(populate_by_name=True)

    schema_version: Literal["task-execution-routing/v1"] = Field(
        "task-execution-routing/v1", alias="schemaVersion"
    )
    proposal_id: str = Field(..., alias="proposalId", min_length=8)
    trace_id: str = Field(..., alias="traceId", min_length=8, max_length=128)
    idempotency_key: str = Field(..., alias="idempotencyKey", min_length=8, max_length=256)
    summary: str = Field(..., min_length=1, max_length=4000)
    action: Dict[str, Any]
    action_digest: str = Field(..., alias="actionDigest", pattern=r"^[a-f0-9]{64}$")


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
    use_subagent_mode: bool = Field(default=False, description="历史兼容建议；不能授权子 Agent 或执行路径")
    strategy_mode: str = Field(default="auto", description="历史兼容建议；工作流路由不会按该字段选择策略")
    repository_path: Optional[str] = Field(None, description="代码仓库路径(代码开发任务)")
    route_decision: Optional[TaskRouteDecision] = Field(None, alias="routeDecision")
    route_credential: Optional[TaskRouteCredential] = Field(None, alias="routeCredential")


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
    model_config = ConfigDict(populate_by_name=True)

    task_id: str
    event_type: str = Field(..., description="事件类型: started, progress, agent_switch, completed, failed")
    message: str
    data: Dict[str, Any] = Field(default={})
    schema_version: str = Field(default="task-execution-routing/v1", alias="schemaVersion")
    producer: str = Field(default="agent-platform")
    trace_id: Optional[str] = Field(None, alias="traceId")
    idempotency_key: Optional[str] = Field(None, alias="idempotencyKey")
    route: Optional[TaskRoute] = None
    policy_version: Optional[str] = Field(None, alias="policyVersion")
    timestamp: datetime = Field(default_factory=datetime.now)
