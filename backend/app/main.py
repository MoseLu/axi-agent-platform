"""
FastAPI 应用入口
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db, VectorStore
from app.api import agents_router, tasks_router, tools_router, memory_router
from app.api.subagent import router as subagent_router, get_code_isolation_manager
from app.core import AgentManager, TaskScheduler, MemoryManager, CodeIsolationManager
from app.tools import ToolManager, get_builtin_tools
from app.models import MiniMaxConnector


# 全局组件实例
vector_store = VectorStore()
memory_manager = MemoryManager()
tool_manager = ToolManager()
agent_manager = AgentManager()
task_scheduler = TaskScheduler()
code_isolation_manager = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    global code_isolation_manager
    
    # 启动时初始化
    print("🚀 Starting Agent Swarm Server...")
    
    # 初始化数据库
    init_db()
    print("✅ Database initialized")
    
    # 初始化向量存储
    await memory_manager.initialize(vector_store)
    print("✅ Vector store initialized")
    
    # 初始化工具管理器
    await tool_manager.initialize(vector_store)
    print(f"✅ Tool manager initialized with {len(get_builtin_tools())} builtin tools")
    
    # 设置智能体管理器模型工厂
    def get_model_connector(model_name: str):
        if "abab" in model_name.lower():
            return MiniMaxConnector()
        else:
            from app.models import OpenAIConnector
            return OpenAIConnector()
    
    agent_manager.set_model_factory(get_model_connector)
    print("✅ Agent manager initialized")
    
    # 初始化代码隔离管理器（subAgent 模式）
    repo_path = getattr(settings, 'REPOSITORY_PATH', './projects')
    try:
        code_isolation_manager = CodeIsolationManager(
            base_repo_path=repo_path,
            max_worktrees=10
        )
        print(f"✅ Code isolation manager initialized (repo: {repo_path})")
    except Exception as e:
        print(f"⚠️  Code isolation manager initialization failed: {e}")
        print("⚠️  subAgent mode will be unavailable")
    
    # 设置任务调度器依赖（包括代码隔离管理器）
    task_scheduler.set_dependencies(
        agent_manager=agent_manager,
        tool_manager=tool_manager,
        memory_manager=memory_manager,
        code_isolation_manager=code_isolation_manager
    )
    await task_scheduler.start()
    print("✅ Task scheduler started")
    
    yield
    
    # 关闭时清理
    print("🛑 Shutting down Agent Swarm Server...")
    await task_scheduler.stop()
    print("✅ Task scheduler stopped")


# 创建 FastAPI 应用
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="基于 miniMax + OpenAI Swarm + LangChain 的多智能体协作系统",
    lifespan=lifespan
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应限制具体域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(agents_router, prefix="/api/v1")
app.include_router(tasks_router, prefix="/api/v1")
app.include_router(tools_router, prefix="/api/v1")
app.include_router(memory_router, prefix="/api/v1")
app.include_router(subagent_router)  # subAgent 模式专用接口


@app.get("/")
async def root():
    """根路径"""
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "running",
        "docs": "/docs"
    }


@app.get("/health")
async def health_check():
    """健康检查"""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat()
    }


@app.get("/api/v1/stats")
async def get_system_stats():
    """获取系统统计"""
    from datetime import datetime
    
    task_stats = await task_scheduler.get_task_stats()
    memory_stats = await memory_manager.get_memory_stats()
    
    return {
        "tasks": task_stats,
        "memory": memory_stats,
        "agents": {
            "total": len(await agent_manager.list_agents()),
            "running": len([a for a in await agent_manager.list_agents() 
                          if a.status.value == "idle" or a.status.value == "busy"])
        },
        "tools": {
            "total": len(await tool_manager.list_tools(enabled_only=False)),
            "enabled": len(await tool_manager.list_tools(enabled_only=True))
        },
        "timestamp": datetime.now().isoformat()
    }


if __name__ == "__main__":
    import uvicorn
    from datetime import datetime
    
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level="info"
    )
