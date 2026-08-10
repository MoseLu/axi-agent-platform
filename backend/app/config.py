"""
配置管理模块
"""
import os
from typing import Optional
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """应用配置类"""
    
    # 应用配置
    APP_NAME: str = "Axi Agent Platform"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    
    # 服务器配置
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    
    # 数据库配置
    DATABASE_URL: str = "sqlite:///./axi_agent_platform.db"
    VECTOR_DB_PATH: str = "./chroma_db"
    
    # miniMax API配置
    MINIMAX_API_KEY: str = ""
    MINIMAX_API_URL: str = "https://api.minimaxi.com/v1"
    MINIMAX_DEFAULT_MODEL: str = "abab6-chat"
    
    OPENAI_API_KEY: str = ""
    OPENAI_DEFAULT_MODEL: str = "gpt-4"
    
    # Qwen/DashScope API配置
    QWEN_API_KEY: str = ""
    QWEN_API_URL: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    QWEN_DEFAULT_MODEL: str = "qwen-plus"
    
    # 安全配置
    SECRET_KEY: str = "your-secret-key-here"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    # Workflow-first internal boundary. Empty values fail closed for bounded runs.
    WORKFLOW_ROUTE_CREDENTIAL_SECRET: str = ""
    WORKFLOW_INTERNAL_EVENT_TOKEN: str = ""
    # Complete Workbench internal-event endpoint. When this is absent local
    # development keeps the event publisher inert; when configured, delivery
    # failures are surfaced to the calling bounded runtime.
    WORKFLOW_EVENT_SINK_URL: str = ""
    # Credential used only when publishing outbound lifecycle events to the
    # Workbench internal-event endpoint. Keep it separate from the inbound
    # workflow token so the two authenticated directions cannot be confused.
    WORKFLOW_EVENT_SINK_TOKEN: str = ""
    WORKFLOW_EVENT_SINK_TIMEOUT_SECONDS: float = 5.0
    
    # 智能体配置
    MAX_AGENTS: int = 10
    DEFAULT_TEMPERATURE: float = 0.7
    DEFAULT_MAX_TOKENS: int = 2048
    
    # 记忆配置
    MAX_SESSION_MEMORY: int = 100
    VECTOR_SIMILARITY_TOP_K: int = 5
    
    # SubAgent 模式配置（代码开发协作）
    REPOSITORY_PATH: str = "./projects"  # 代码仓库路径
    MAX_WORKTREES: int = 10  # 最大 worktree 数量
    MAX_PARALLEL_AGENTS: int = 8  # 最大并行智能体数
    DEFAULT_BASE_BRANCH: str = "main"  # 默认基础分支
    WORKTREES_CLEANUP_HOURS: int = 24  # worktree 自动清理时间（小时）

    # Axi Agent MCP service client 配置
    AXI_AGENT_MCP_COMMAND: str = "node"
    AXI_AGENT_MCP_ARGS: Optional[str] = None
    AXI_AGENT_MCP_CWD: Optional[str] = None
    AXI_AGENT_MCP_TIMEOUT_SECONDS: float = 5.0
    AXI_AGENT_MCP_PROTOCOL_VERSION: str = "2024-11-05"
    
    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    """获取配置实例（单例模式）"""
    return Settings()


settings = get_settings()
