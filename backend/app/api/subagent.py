"""
SubAgent 模式 API - 代码开发协作模式专用接口
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field

from app.core.code_isolation_manager import CodeIsolationManager
from app.config import settings

router = APIRouter(prefix="/subagent", tags=["subagent"])


class CreateWorktreeRequest(BaseModel):
    """创建 worktree 请求"""
    agent_id: str = Field(..., description="智能体 ID")
    branch_name: Optional[str] = Field(None, description="分支名称")
    base_branch: str = Field(default="main", description="基础分支")


class SyncWorktreeRequest(BaseModel):
    """同步 worktree 请求"""
    agent_id: str = Field(..., description="智能体 ID")
    fetch: bool = Field(default=True, description="是否 fetch 远程仓库")


class CommitWorktreeRequest(BaseModel):
    """提交 worktree 请求"""
    agent_id: str = Field(..., description="智能体 ID")
    message: str = Field(..., description="提交信息")


class MergeWorktreeRequest(BaseModel):
    """合并 worktree 请求"""
    agent_id: str = Field(..., description="智能体 ID")
    target_branch: str = Field(default="main", description="目标分支")


class CodeQualityAssessment(BaseModel):
    """代码质量评估"""
    code_score: float = Field(..., ge=0, le=100, description="代码质量分数")
    completeness_score: float = Field(..., ge=0, le=100, description="完整性分数")
    test_score: float = Field(..., ge=0, le=100, description="测试覆盖率分数")
    documentation_score: float = Field(..., ge=0, le=100, description="文档质量分数")
    comments: List[str] = Field(default=[], description="评价和改进建议")
    approved: bool = Field(..., description="是否通过评审")


# 全局代码隔离管理器实例
_code_isolation_manager: Optional[CodeIsolationManager] = None


def get_code_isolation_manager() -> CodeIsolationManager:
    """获取代码隔离管理器实例"""
    global _code_isolation_manager
    if _code_isolation_manager is None:
        # 初始化管理器
        repo_path = getattr(settings, 'REPOSITORY_PATH', './projects')
        _code_isolation_manager = CodeIsolationManager(
            base_repo_path=repo_path,
            max_worktrees=10
        )
    return _code_isolation_manager


@router.get("/worktree/stats")
async def get_worktree_stats(
    manager: CodeIsolationManager = Depends(get_code_isolation_manager)
):
    """
    获取 worktree 统计信息
    
    Returns:
        worktree 数量、可用数量、详细信息等
    """
    try:
        stats = manager.get_statistics()
        return {"success": True, "data": stats}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/worktree/create")
async def create_worktree(
    request: CreateWorktreeRequest,
    manager: CodeIsolationManager = Depends(get_code_isolation_manager)
):
    """
    为智能体创建独立的 worktree
    
    Args:
        request: 创建请求
        
    Returns:
        worktree 路径和相关信息
    """
    try:
        # 验证仓库
        if not manager.validate_repository():
            raise HTTPException(
                status_code=400,
                detail="Not a valid Git repository"
            )
        
        # 创建 worktree
        worktree_path = await manager.create_worktree(
            agent_id=request.agent_id,
            branch_name=request.branch_name,
            base_branch=request.base_branch
        )
        
        return {
            "success": True,
            "data": {
                "agent_id": request.agent_id,
                "worktree_path": worktree_path,
                "branch": request.branch_name or f"agent-{request.agent_id}"
            }
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/worktree/{agent_id}")
async def get_worktree(
    agent_id: str,
    manager: CodeIsolationManager = Depends(get_code_isolation_manager)
):
    """
    获取智能体的 worktree 信息
    
    Args:
        agent_id: 智能体 ID
        
    Returns:
        worktree 路径和相关信息
    """
    try:
        worktree_path = manager.get_worktree_path(agent_id)
        
        if not worktree_path:
            raise HTTPException(
                status_code=404,
                detail=f"Worktree for agent {agent_id} not found"
            )
        
        return {
            "success": True,
            "data": {
                "agent_id": agent_id,
                "worktree_path": worktree_path
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/worktree/sync")
async def sync_worktree(
    request: SyncWorktreeRequest,
    manager: CodeIsolationManager = Depends(get_code_isolation_manager)
):
    """
    同步 worktree 与远程仓库
    
    Args:
        request: 同步请求
        
    Returns:
        同步结果
    """
    try:
        await manager.sync_worktree(
            agent_id=request.agent_id,
            fetch=request.fetch
        )
        
        return {
            "success": True,
            "message": f"Worktree for agent {request.agent_id} synced successfully"
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/worktree/{agent_id}/changes")
async def get_worktree_changes(
    agent_id: str,
    manager: CodeIsolationManager = Depends(get_code_isolation_manager)
):
    """
    获取 worktree 的代码变更
    
    Args:
        agent_id: 智能体 ID
        
    Returns:
        新增、修改、删除的文件列表
    """
    try:
        changes = manager.get_worktree_changes(agent_id)
        
        return {
            "success": True,
            "data": {
                "agent_id": agent_id,
                "changes": changes
            }
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/worktree/commit")
async def commit_worktree(
    request: CommitWorktreeRequest,
    manager: CodeIsolationManager = Depends(get_code_isolation_manager)
):
    """
    提交 worktree 的代码变更
    
    Args:
        request: 提交请求
        
    Returns:
        commit hash
    """
    try:
        commit_hash = await manager.commit_worktree_changes(
            agent_id=request.agent_id,
            message=request.message
        )
        
        return {
            "success": True,
            "data": {
                "agent_id": request.agent_id,
                "commit_hash": commit_hash,
                "message": request.message
            }
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/worktree/merge")
async def merge_worktree(
    request: MergeWorktreeRequest,
    manager: CodeIsolationManager = Depends(get_code_isolation_manager)
):
    """
    将 worktree 合并到目标分支
    
    Args:
        request: 合并请求
        
    Returns:
        合并结果
    """
    try:
        merge_success = await manager.merge_worktree(
            agent_id=request.agent_id,
            target_branch=request.target_branch
        )
        
        if not merge_success:
            return {
                "success": False,
                "message": "Merge failed due to conflicts",
                "data": {
                    "agent_id": request.agent_id,
                    "target_branch": request.target_branch
                }
            }
        
        return {
            "success": True,
            "message": "Merge completed successfully",
            "data": {
                "agent_id": request.agent_id,
                "target_branch": request.target_branch
            }
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/worktree/{agent_id}")
async def remove_worktree(
    agent_id: str,
    force: bool = False,
    manager: CodeIsolationManager = Depends(get_code_isolation_manager)
):
    """
    删除智能体的 worktree
    
    Args:
        agent_id: 智能体 ID
        force: 是否强制删除
        
    Returns:
        删除结果
    """
    try:
        await manager.remove_worktree(agent_id=agent_id, force=force)
        
        return {
            "success": True,
            "message": f"Worktree for agent {agent_id} removed successfully"
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/worktree/cleanup")
async def cleanup_old_worktrees(
    older_than_hours: int = 24,
    manager: CodeIsolationManager = Depends(get_code_isolation_manager)
):
    """
    清理旧的 worktree
    
    Args:
        older_than_hours: 清理超过此小时数的 worktree
        
    Returns:
        被清理的 agent_id 列表
    """
    try:
        removed_ids = manager.cleanup_old_worktrees(older_than_hours)
        
        return {
            "success": True,
            "data": {
                "removed_count": len(removed_ids),
                "removed_ids": removed_ids
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/quality/assess")
async def assess_code_quality(assessment: CodeQualityAssessment):
    """
    提交代码质量评估结果
    
    Args:
        assessment: 质量评估结果
        
    Returns:
        评估结果保存确认
    """
    try:
        # 这里可以将评估结果保存到数据库或发送到任务调度器
        return {
            "success": True,
            "data": {
                "assessment": assessment.model_dump(),
                "message": "Quality assessment recorded"
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config")
async def get_subagent_config():
    """
    获取 subAgent 模式配置
    
    Returns:
        subAgent 模式的配置信息
    """
    return {
        "success": True,
        "data": {
            "max_parallel_agents": 8,
            "supported_roles": [
                "planner",
                "worker",
                "code_worker",
                "code_reviewer",
                "test_engineer",
                "doc_generator",
                "judge"
            ],
            "task_types": [
                "general",
                "code_development",
                "code_review",
                "test_writing",
                "doc_generation"
            ],
            "max_worktrees": 10,
            "default_base_branch": "main"
        }
    }
