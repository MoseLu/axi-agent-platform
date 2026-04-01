"""
智能体数据模型
"""
from enum import Enum
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field


class AgentStatus(str, Enum):
    """智能体状态枚举"""
    IDLE = "idle"           # 空闲
    BUSY = "busy"           # 忙碌
    PAUSED = "paused"       # 暂停
    ERROR = "error"         # 错误
    OFFLINE = "offline"     # 离线


class AgentRole(str, Enum):
    """智能体角色枚举"""
    GENERAL = "general"                 # 通用智能体
    PLANNER = "planner"                 # subAgent: 规划者
    WORKER = "worker"                   # subAgent: 工作者
    CODE_WORKER = "code_worker"         # subAgent: 代码工作者
    CODE_REVIEWER = "code_reviewer"     # subAgent: 代码审查者
    TEST_ENGINEER = "test_engineer"     # subAgent: 测试工程师
    DOC_GENERATOR = "doc_generator"     # subAgent: 文档生成者
    JUDGE = "judge"                     # subAgent: 裁判


class AgentBase(BaseModel):
    """智能体基础模型"""
    name: str = Field(..., min_length=1, max_length=100, description="智能体名称")
    description: Optional[str] = Field(None, max_length=500, description="智能体描述")
    system_prompt: str = Field(..., min_length=1, description="系统提示词")
    model_name: str = Field(default="abab6-chat", description="使用的模型名称")
    temperature: float = Field(default=0.7, ge=0, le=2, description="温度参数")
    max_tokens: int = Field(default=2048, ge=1, le=8192, description="最大令牌数")
    tools: List[str] = Field(default=[], description="可调用的工具列表")
    capabilities: List[str] = Field(default=[], description="能力标签")
    role: AgentRole = Field(default=AgentRole.GENERAL, description="智能体角色")
    metadata: Dict[str, Any] = Field(default={}, description="元数据")


class AgentCreate(AgentBase):
    """创建智能体请求模型"""
    pass


class AgentUpdate(BaseModel):
    """更新智能体请求模型"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    system_prompt: Optional[str] = None
    model_name: Optional[str] = None
    temperature: Optional[float] = Field(None, ge=0, le=2)
    max_tokens: Optional[int] = Field(None, ge=1, le=8192)
    tools: Optional[List[str]] = None
    capabilities: Optional[List[str]] = None
    metadata: Optional[Dict[str, Any]] = None


class Agent(AgentBase):
    """智能体完整模型"""
    id: str = Field(..., description="智能体唯一标识")
    status: AgentStatus = Field(default=AgentStatus.IDLE, description="当前状态")
    created_at: datetime = Field(default_factory=datetime.now, description="创建时间")
    updated_at: datetime = Field(default_factory=datetime.now, description="更新时间")
    last_active: Optional[datetime] = Field(None, description="最后活跃时间")
    task_count: int = Field(default=0, description="任务计数")
    success_count: int = Field(default=0, description="成功任务数")
    
    class Config:
        from_attributes = True


class AgentExecutionRequest(BaseModel):
    """智能体执行请求"""
    task_id: str = Field(..., description="任务ID")
    input: str = Field(..., description="输入内容")
    context: Dict[str, Any] = Field(default={}, description="上下文信息")
