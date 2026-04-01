"""
工具数据模型
"""
from enum import Enum
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field


class ToolType(str, Enum):
    """工具类型枚举"""
    BUILTIN = "builtin"     # 内置工具
    CUSTOM = "custom"       # 自定义工具


class ToolCategory(str, Enum):
    """工具类别枚举"""
    SEARCH = "search"       # 搜索
    FILE = "file"           # 文件操作
    CALCULATE = "calculate" # 计算
    CODE = "code"           # 代码执行
    DATA = "data"           # 数据处理
    WEB = "web"             # 网络请求
    SYSTEM = "system"       # 系统操作
    OTHER = "other"         # 其他


class ToolBase(BaseModel):
    """工具基础模型"""
    name: str = Field(..., min_length=1, max_length=100, description="工具名称")
    description: str = Field(..., min_length=1, max_length=500, description="工具描述")
    category: ToolCategory = Field(default=ToolCategory.OTHER)
    tool_type: ToolType = Field(default=ToolType.CUSTOM)
    parameters: Dict[str, Any] = Field(default={}, description="参数Schema")
    required_permissions: List[str] = Field(default=[], description="所需权限")
    enabled: bool = Field(default=True)


class ToolCreate(ToolBase):
    """创建工具请求模型"""
    code: Optional[str] = Field(None, description="自定义工具代码")


class ToolUpdate(BaseModel):
    """更新工具请求模型"""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, min_length=1, max_length=500)
    category: Optional[ToolCategory] = None
    parameters: Optional[Dict[str, Any]] = None
    required_permissions: Optional[List[str]] = None
    enabled: Optional[bool] = None
    code: Optional[str] = None


class Tool(ToolBase):
    """工具完整模型"""
    id: str = Field(..., description="工具唯一标识")
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    use_count: int = Field(default=0, description="使用次数")
    
    class Config:
        from_attributes = True


class ToolExecution(BaseModel):
    """工具执行请求和响应"""
    tool_id: str = Field(..., description="工具ID")
    parameters: Dict[str, Any] = Field(default={}, description="执行参数")
    agent_id: Optional[str] = Field(None, description="调用智能体ID")
    task_id: Optional[str] = Field(None, description="任务ID")


class ToolExecutionResult(BaseModel):
    """工具执行结果"""
    success: bool
    result: Any = None
    error: Optional[str] = None
    execution_time: float = Field(..., description="执行时间(秒)")
