"""
代码隔离管理器 - 基于 Git worktrees 实现代码环境隔离
"""
import os
import subprocess
from typing import Dict, Optional
from datetime import datetime
import shutil


class WorktreeInfo:
    """Worktree 信息"""
    def __init__(self, path: str, branch: str, agent_id: str, created_at: datetime):
        self.path = path
        self.branch = branch
        self.agent_id = agent_id
        self.created_at = created_at


class CodeIsolationManager:
    """
    代码隔离管理器
    
    使用 Git worktrees 为每个智能体创建独立的代码工作环境，
    避免多智能体同时修改同一代码文件时的冲突。
    """
    
    def __init__(self, base_repo_path: str, max_worktrees: int = 10):
        """
        初始化代码隔离管理器
        
        Args:
            base_repo_path: 基础仓库路径
            max_worktrees: 最大 worktree 数量
        """
        self.base_repo_path = os.path.abspath(base_repo_path)
        self.max_worktrees = max_worktrees
        self.worktrees: Dict[str, WorktreeInfo] = {}  # agent_id -> WorktreeInfo
        self.worktrees_dir = os.path.join(self.base_repo_path, ".worktrees")
        
        # 初始化目录
        self._init_directories()
        
    def _init_directories(self):
        """初始化必要的目录结构"""
        os.makedirs(self.worktrees_dir, exist_ok=True)
    
    def _run_git_command(self, args: list, cwd: Optional[str] = None) -> subprocess.CompletedProcess:
        """
        执行 Git 命令
        
        Args:
            args: 命令参数列表
            cwd: 工作目录，默认为基础仓库路径
            
        Returns:
            subprocess.CompletedProcess
            
        Raises:
            subprocess.CalledProcessError: Git 命令执行失败
        """
        if cwd is None:
            cwd = self.base_repo_path
        
        result = subprocess.run(
            ["git"] + args,
            cwd=cwd,
            capture_output=True,
            text=True,
            check=True
        )
        return result
    
    def validate_repository(self) -> bool:
        """
        验证基础仓库是否是一个有效的 Git 仓库
        
        Returns:
            bool: 是否为有效的 Git 仓库
        """
        if not os.path.exists(os.path.join(self.base_repo_path, ".git")):
            return False
        
        try:
            self._run_git_command(["status"])
            return True
        except subprocess.CalledProcessError:
            return False
    
    def create_worktree(
        self,
        agent_id: str,
        branch_name: Optional[str] = None,
        base_branch: str = "main"
    ) -> str:
        """
        为智能体创建独立的 Git worktree
        
        Args:
            agent_id: 智能体 ID
            branch_name: 创建的新分支名称，如果为 None 则基于 agent_id 生成
            base_branch: 基础分支名称
            
        Returns:
            str: worktree 路径
            
        Raises:
            ValueError: worktree 已存在或超过最大数量
            subprocess.CalledProcessError: Git 命令执行失败
        """
        # 检查 worktree 是否已存在
        if agent_id in self.worktrees:
            raise ValueError(f"Worktree for agent {agent_id} already exists")
        
        # 检查是否超过最大数量
        if len(self.worktrees) >= self.max_worktrees:
            raise ValueError(f"Maximum worktrees limit ({self.max_worktrees}) reached")
        
        # 生成分支名称
        if branch_name is None:
            branch_name = f"agent-{agent_id}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        # 创建 worktree 路径
        worktree_path = os.path.join(self.worktrees_dir, agent_id)
        
        try:
            # 创建新的 worktree
            self._run_git_command([
                "worktree", "add",
                "-b", branch_name,
                worktree_path,
                base_branch
            ])
            
            # 保存 worktree 信息
            self.worktrees[agent_id] = WorktreeInfo(
                path=worktree_path,
                branch=branch_name,
                agent_id=agent_id,
                created_at=datetime.now()
            )
            
            return worktree_path
            
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"Failed to create worktree: {e.stderr}")
    
    def get_worktree_path(self, agent_id: str) -> Optional[str]:
        """
        获取智能体的 worktree 路径
        
        Args:
            agent_id: 智能体 ID
            
        Returns:
            Optional[str]: worktree 路径，如果不存在则返回 None
        """
        worktree_info = self.worktrees.get(agent_id)
        return worktree_info.path if worktree_info else None
    
    def get_all_worktrees(self) -> Dict[str, WorktreeInfo]:
        """
        获取所有 worktree 信息
        
        Returns:
            Dict[str, WorktreeInfo]: agent_id -> WorktreeInfo
        """
        return self.worktrees.copy()
    
    def sync_worktree(self, agent_id: str, fetch: bool = True) -> None:
        """
        同步智能体的 worktree 与基础仓库
        
        Args:
            agent_id: 智能体 ID
            fetch: 是否先 fetch 远程仓库
            
        Raises:
            ValueError: worktree 不存在
            subprocess.CalledProcessError: Git 命令执行失败
        """
        worktree_info = self.worktrees.get(agent_id)
        if not worktree_info:
            raise ValueError(f"Worktree for agent {agent_id} not found")
        
        try:
            # 先 fetch 远程变更（可选）
            if fetch:
                self._run_git_command(["fetch", "origin"])
            
            # 拉取最新变更到 worktree
            self._run_git_command(
                ["pull", "origin", worktree_info.branch],
                cwd=worktree_info.path
            )
            
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"Failed to sync worktree: {e.stderr}")
    
    def get_worktree_changes(self, agent_id: str) -> Dict[str, str]:
        """
        获取 worktree 中的变更
        
        Args:
            agent_id: 智能体 ID
            
        Returns:
            Dict[str, str]: {"added": [], "modified": [], "deleted": []}
            
        Raises:
            ValueError: worktree 不存在
        """
        worktree_info = self.worktrees.get(agent_id)
        if not worktree_info:
            raise ValueError(f"Worktree for agent {agent_id} not found")
        
        try:
            # 获取修改的文件
            modified = self._run_git_command(
                ["diff", "--name-only"],
                cwd=worktree_info.path
            ).stdout.strip().split("\n") if self._run_git_command(
                ["diff", "--name-only"],
                cwd=worktree_info.path
            ).stdout.strip() else []
            
            # 获取新增的文件
            added = self._run_git_command(
                ["ls-files", "--others", "--exclude-standard"],
                cwd=worktree_info.path
            ).stdout.strip().split("\n") if self._run_git_command(
                ["ls-files", "--others", "--exclude-standard"],
                cwd=worktree_info.path
            ).stdout.strip() else []
            
            # 获取删除的文件
            deleted = self._run_git_command(
                ["diff", "--name-only", "--diff-filter=D"],
                cwd=worktree_info.path
            ).stdout.strip().split("\n") if self._run_git_command(
                ["diff", "--name-only", "--diff-filter=D"],
                cwd=worktree_info.path
            ).stdout.strip() else []
            
            return {
                "added": [f for f in added if f],
                "modified": [f for f in modified if f],
                "deleted": [f for f in deleted if f]
            }
            
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"Failed to get worktree changes: {e.stderr}")
    
    def commit_worktree_changes(self, agent_id: str, message: str) -> str:
        """
        提交 worktree 的变更
        
        Args:
            agent_id: 智能体 ID
            message: 提交信息
            
        Returns:
            str: commit hash
            
        Raises:
            ValueError: worktree 不存在
            subprocess.CalledProcessError: Git 命令执行失败
        """
        worktree_info = self.worktrees.get(agent_id)
        if not worktree_info:
            raise ValueError(f"Worktree for agent {agent_id} not found")
        
        try:
            # 添加所有变更
            self._run_git_command(["add", "."], cwd=worktree_info.path)
            
            # 提交变更
            result = self._run_git_command(
                ["commit", "-m", message],
                cwd=worktree_info.path
            )
            
            # 提取 commit hash
            commit_hash = result.stdout.strip()
            if "nothing to commit" in commit_hash.lower():
                return ""
            
            # 从输出中提取 hash
            for line in result.stdout.split("\n"):
                if line.startswith("[") and "]" in line:
                    hash_part = line.split("]")[1].strip().split()[0]
                    return hash_part
            
            return result.stdout.strip()
            
        except subprocess.CalledProcessError as e:
            if "nothing to commit" in e.stderr.lower():
                return ""
            raise RuntimeError(f"Failed to commit changes: {e.stderr}")
    
    def merge_worktree(self, agent_id: str, target_branch: str = "main") -> bool:
        """
        将智能体的 worktree 合并到目标分支
        
        Args:
            agent_id: 智能体 ID
            target_branch: 目标分支名称
            
        Returns:
            bool: 是否成功合并
            
        Raises:
            ValueError: worktree 不存在
            subprocess.CalledProcessError: Git 命令执行失败
        """
        worktree_info = self.worktrees.get(agent_id)
        if not worktree_info:
            raise ValueError(f"Worktree for agent {agent_id} not found")
        
        try:
            # 先同步基础仓库
            self._run_git_command(["checkout", target_branch])
            self._run_git_command(["pull", "origin", target_branch])
            
            # 合并 worktree 分支
            try:
                self._run_git_command(["merge", worktree_info.branch])
                return True
            except subprocess.CalledProcessError:
                # 合并冲突，尝试中止
                self._run_git_command(["merge", "--abort"])
                return False
                
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"Failed to merge worktree: {e.stderr}")
    
    def remove_worktree(self, agent_id: str, force: bool = False) -> None:
        """
        删除智能体的 worktree
        
        Args:
            agent_id: 智能体 ID
            force: 是否强制删除（即使有未提交的变更）
            
        Raises:
            ValueError: worktree 不存在
            subprocess.CalledProcessError: Git 命令执行失败
        """
        worktree_info = self.worktrees.get(agent_id)
        if not worktree_info:
            raise ValueError(f"Worktree for agent {agent_id} not found")
        
        try:
            args = ["worktree", "remove"]
            if force:
                args.append("--force")
            args.append(worktree_info.path)
            
            self._run_git_command(args)
            
            # 删除信息
            del self.worktrees[agent_id]
            
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"Failed to remove worktree: {e.stderr}")
    
    def cleanup_old_worktrees(self, older_than_hours: int = 24) -> List[str]:
        """
        清理旧的 worktree
        
        Args:
            older_than_hours: 清理超过此小时数的 worktree
            
        Returns:
            List[str]: 被清理的 agent_id 列表
        """
        from datetime import timedelta
        
        now = datetime.now()
        threshold = now - timedelta(hours=older_than_hours)
        removed_ids = []
        
        for agent_id, worktree_info in list(self.worktrees.items()):
            if worktree_info.created_at < threshold:
                try:
                    self.remove_worktree(agent_id, force=True)
                    removed_ids.append(agent_id)
                except Exception as e:
                    print(f"Failed to remove worktree for {agent_id}: {e}")
        
        return removed_ids
    
    def get_statistics(self) -> Dict[str, any]:
        """
        获取统计信息
        
        Returns:
            Dict[str, any]: 统计信息字典
        """
        return {
            "total_worktrees": len(self.worktrees),
            "max_worktrees": self.max_worktrees,
            "available_worktrees": self.max_worktrees - len(self.worktrees),
            "base_repo_path": self.base_repo_path,
            "worktrees": [
                {
                    "agent_id": wi.agent_id,
                    "branch": wi.branch,
                    "path": wi.path,
                    "created_at": wi.created_at.isoformat()
                }
                for wi in self.worktrees.values()
            ]
        }
