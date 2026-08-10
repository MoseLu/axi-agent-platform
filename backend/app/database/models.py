"""
SQLAlchemy 数据库模型
"""
import json
from datetime import datetime
from typing import Optional, List
from sqlalchemy import (
    Column, String, Integer, Float, DateTime, 
    Text, Boolean, ForeignKey, JSON, create_engine
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from app.config import settings

Base = declarative_base()


class JSONEncodedDict:
    """JSON编码器，用于存储列表和字典"""
    @staticmethod
    def process_bind_param(value, dialect):
        if value is None:
            return '{}'
        return json.dumps(value, ensure_ascii=False)
    
    @staticmethod
    def process_result_value(value, dialect):
        if value is None:
            return {}
        return json.loads(value)


class AgentModel(Base):
    """智能体数据库模型"""
    __tablename__ = "agents"
    
    id = Column(String(36), primary_key=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    system_prompt = Column(Text, nullable=False)
    model_name = Column(String(50), default="abab6-chat")
    temperature = Column(Float, default=0.7)
    max_tokens = Column(Integer, default=2048)
    tools = Column(JSON, default=list)
    capabilities = Column(JSON, default=list)
    metadata_json = Column("metadata", JSON, default=dict)
    status = Column(String(20), default="idle")
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    last_active = Column(DateTime, nullable=True)
    task_count = Column(Integer, default=0)
    success_count = Column(Integer, default=0)
    
    # 关系
    tasks = relationship("TaskModel", back_populates="agent")


class TaskModel(Base):
    """任务数据库模型"""
    __tablename__ = "tasks"
    
    id = Column(String(36), primary_key=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    priority = Column(Integer, default=2)
    status = Column(String(20), default="pending")
    parent_id = Column(String(36), ForeignKey("tasks.id"), nullable=True)
    current_agent_id = Column(String(36), ForeignKey("agents.id"), nullable=True)
    input_data = Column(JSON, default=dict)
    output_data = Column(JSON, default=dict)
    subtasks = Column(JSON, default=list)
    progress = Column(Float, default=0.0)
    tags = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    
    # 关系
    agent = relationship("AgentModel", back_populates="tasks")
    parent = relationship("TaskModel", remote_side=[id], backref="children")


class TaskRouteDecisionRecord(Base):
    """Durable, credential-free audit record for task-execution-routing/v1."""

    __tablename__ = "task_route_decisions"

    task_id = Column(String(36), primary_key=True)
    schema_version = Column(String(64), nullable=False)
    route = Column(String(32), nullable=False)
    reason_code = Column(String(128), nullable=False)
    policy_version = Column(String(128), nullable=False)
    trace_id = Column(String(128), nullable=False)
    idempotency_key = Column(String(256), nullable=False)
    decision_json = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class ToolModel(Base):
    """工具数据库模型"""
    __tablename__ = "tools"
    
    id = Column(String(36), primary_key=True)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=False)
    category = Column(String(20), default="other")
    tool_type = Column(String(20), default="custom")
    parameters = Column(JSON, default=dict)
    required_permissions = Column(JSON, default=list)
    code = Column(Text, nullable=True)
    enabled = Column(Boolean, default=True)
    use_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class SessionModel(Base):
    """会话数据库模型"""
    __tablename__ = "sessions"
    
    id = Column(String(36), primary_key=True)
    title = Column(String(200), nullable=True)
    messages = Column(JSON, default=list)
    context = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    is_active = Column(Boolean, default=True)


# 数据库引擎和会话
engine = create_engine(
    settings.DATABASE_URL.replace("sqlite+aiosqlite://", "sqlite://"),
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}
)

async_engine = create_async_engine(
    settings.DATABASE_URL.replace("sqlite://", "sqlite+aiosqlite://"),
    echo=False
)

AsyncSessionLocal = async_sessionmaker(
    async_engine,
    class_=AsyncSession,
    expire_on_commit=False
)


def init_db():
    """初始化数据库"""
    Base.metadata.create_all(bind=engine)


async def get_db():
    """获取数据库会话"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
