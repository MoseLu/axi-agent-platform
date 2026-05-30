"""
代码隔离管理器 - 基于 Git worktrees 实现代码环境隔离
"""
import os
import re
import subprocess
from typing import Dict, List, Optional
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
    _IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
    _BRANCH_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,191}$")
    
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
        self.worktrees_dir = os.path.abspath(os.path.join(self.base_repo_path, ".worktrees"))
        
        # 初始化目录
        self._init_directories()
        
    def _init_directories(self):
        """初始化必要的目录结构"""
        os.makedirs(self.worktrees_dir, exist_ok=True)
        self._ensure_worktrees_excluded()

    def _ensure_worktrees_excluded(self) -> None:
        git_dir = os.path.join(self.base_repo_path, ".git")
        if not os.path.isdir(git_dir):
            return

        info_dir = os.path.join(git_dir, "info")
        exclude_path = os.path.join(info_dir, "exclude")
        exclude_entry = f"{os.path.relpath(self.worktrees_dir, self.base_repo_path).replace(os.sep, '/')}/"
        os.makedirs(info_dir, exist_ok=True)

        existing = ""
        if os.path.exists(exclude_path):
            with open(exclude_path, "r", encoding="utf-8") as exclude_file:
                existing = exclude_file.read()

        if exclude_entry in {line.strip() for line in existing.splitlines()}:
            return

        with open(exclude_path, "a", encoding="utf-8") as exclude_file:
            if existing and not existing.endswith("\n"):
                exclude_file.write("\n")
            exclude_file.write(f"\n# Axi Agent managed worktrees\n{exclude_entry}\n")

    def _validate_identifier(self, value: str, field_name: str) -> str:
        """Validate IDs that are later used as local directory names."""
        if not isinstance(value, str) or not value:
            raise ValueError(f"{field_name} is required")
        if value != value.strip():
            raise ValueError(f"{field_name} must not contain leading or trailing whitespace")
        if value.endswith(".lock") or ".." in value:
            raise ValueError(f"{field_name} contains an unsafe path segment")
        if os.sep in value or (os.altsep and os.altsep in value):
            raise ValueError(f"{field_name} must not contain path separators")
        if not self._IDENTIFIER_RE.fullmatch(value):
            raise ValueError(f"{field_name} contains unsupported characters")
        return value

    def _validate_branch_name(self, value: str, field_name: str) -> str:
        """Validate git ref names before passing them to checkout/merge/worktree."""
        if not isinstance(value, str) or not value:
            raise ValueError(f"{field_name} is required")
        if value != value.strip():
            raise ValueError(f"{field_name} must not contain leading or trailing whitespace")
        if (
            value.startswith("-")
            or value.startswith("/")
            or value.endswith("/")
            or value.endswith(".")
            or value.endswith(".lock")
            or ".." in value
            or "@{" in value
            or "\\" in value
        ):
            raise ValueError(f"{field_name} is not a safe branch name")
        parts = value.split("/")
        if any(part in {"", ".", ".."} or part.endswith(".lock") for part in parts):
            raise ValueError(f"{field_name} is not a safe branch name")
        if not self._BRANCH_RE.fullmatch(value):
            raise ValueError(f"{field_name} contains unsupported characters")
        return value

    def _safe_worktree_path(self, agent_id: str) -> str:
        agent_id = self._validate_identifier(agent_id, "agent_id")
        worktree_path = os.path.abspath(os.path.join(self.worktrees_dir, agent_id))
        if os.path.commonpath([self.worktrees_dir, worktree_path]) != self.worktrees_dir:
            raise ValueError("worktree path must stay under the managed worktrees directory")
        return worktree_path

    def _assert_managed_worktree_path(self, path: str) -> str:
        path = os.path.abspath(path)
        if path == self.worktrees_dir or os.path.commonpath([self.worktrees_dir, path]) != self.worktrees_dir:
            raise ValueError("Refusing to operate on an unmanaged worktree path")
        return path

    def _normalize_git_cwd(self, cwd: Optional[str]) -> str:
        if cwd is None:
            return self.base_repo_path

        cwd = os.path.abspath(cwd)
        if cwd == self.base_repo_path:
            return cwd
        if cwd != self.worktrees_dir and os.path.commonpath([self.worktrees_dir, cwd]) == self.worktrees_dir:
            return cwd
        raise ValueError("Refusing to run git outside the base repository or managed worktrees")

    def _is_managed_worktrees_status_line(self, line: str) -> bool:
        managed_dir = os.path.relpath(self.worktrees_dir, self.base_repo_path).replace(os.sep, "/")
        status_path = line[3:] if len(line) > 3 else ""
        if " -> " in status_path:
            status_path = status_path.rsplit(" -> ", 1)[1]
        status_path = status_path.strip().strip('"')
        return status_path == managed_dir or status_path.startswith(f"{managed_dir}/")

    def _git_status_porcelain(self, cwd: str) -> str:
        cwd = os.path.abspath(cwd)
        lines = self._run_git_command(["status", "--porcelain"], cwd=cwd).stdout.splitlines()
        if cwd == self.base_repo_path:
            lines = [
                line
                for line in lines
                if not self._is_managed_worktrees_status_line(line)
            ]
        return "\n".join(lines).strip()

    def _is_git_path_dirty(self, cwd: str) -> bool:
        return bool(self._git_status_porcelain(cwd))

    def _assert_clean_git_path(self, cwd: str, label: str) -> None:
        if self._is_git_path_dirty(cwd):
            raise RuntimeError(f"Refusing to operate on dirty {label}")
    
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
        cwd = self._normalize_git_cwd(cwd)
        
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
        agent_id = self._validate_identifier(agent_id, "agent_id")
        base_branch = self._validate_branch_name(base_branch, "base_branch")

        if agent_id in self.worktrees:
            raise ValueError(f"Worktree for agent {agent_id} already exists")
        
        # 检查是否超过最大数量
        if len(self.worktrees) >= self.max_worktrees:
            raise ValueError(f"Maximum worktrees limit ({self.max_worktrees}) reached")
        
        # 生成分支名称
        if branch_name is None:
            branch_name = f"agent-{agent_id}-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        branch_name = self._validate_branch_name(branch_name, "branch_name")
        
        # 创建 worktree 路径
        worktree_path = self._safe_worktree_path(agent_id)
        
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

    def is_worktree_dirty(self, agent_id: str) -> bool:
        """
        检查指定 worktree 是否存在未提交变更。

        Args:
            agent_id: 智能体 ID

        Returns:
            bool: 是否存在未提交变更
        """
        agent_id = self._validate_identifier(agent_id, "agent_id")
        worktree_info = self.worktrees.get(agent_id)
        if not worktree_info:
            raise ValueError(f"Worktree for agent {agent_id} not found")
        worktree_info.path = self._assert_managed_worktree_path(worktree_info.path)
        return self._is_git_path_dirty(worktree_info.path)
    
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
        agent_id = self._validate_identifier(agent_id, "agent_id")
        worktree_info = self.worktrees.get(agent_id)
        if not worktree_info:
            raise ValueError(f"Worktree for agent {agent_id} not found")
        worktree_info.path = self._assert_managed_worktree_path(worktree_info.path)
        worktree_info.branch = self._validate_branch_name(worktree_info.branch, "branch_name")
        
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
        agent_id = self._validate_identifier(agent_id, "agent_id")
        worktree_info = self.worktrees.get(agent_id)
        if not worktree_info:
            raise ValueError(f"Worktree for agent {agent_id} not found")
        worktree_info.path = self._assert_managed_worktree_path(worktree_info.path)
        
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
        agent_id = self._validate_identifier(agent_id, "agent_id")
        worktree_info = self.worktrees.get(agent_id)
        if not worktree_info:
            raise ValueError(f"Worktree for agent {agent_id} not found")
        worktree_info.path = self._assert_managed_worktree_path(worktree_info.path)
        
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
        agent_id = self._validate_identifier(agent_id, "agent_id")
        target_branch = self._validate_branch_name(target_branch, "target_branch")
        worktree_info = self.worktrees.get(agent_id)
        if not worktree_info:
            raise ValueError(f"Worktree for agent {agent_id} not found")
        worktree_info.path = self._assert_managed_worktree_path(worktree_info.path)
        worktree_info.branch = self._validate_branch_name(worktree_info.branch, "branch_name")
        
        try:
            self._assert_clean_git_path(self.base_repo_path, "base repository before merge")
            self._assert_clean_git_path(worktree_info.path, "worktree before merge")

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
    
    def remove_worktree(
        self,
        agent_id: str,
        force: bool = False,
        dry_run: bool = False,
        require_clean: bool = False
    ) -> Optional[Dict[str, object]]:
        """
        删除智能体的 worktree
        
        Args:
            agent_id: 智能体 ID
            force: 是否强制删除（即使有未提交的变更）
            dry_run: 仅返回将执行的操作，不删除
            require_clean: 删除前要求 worktree 没有未提交变更
            
        Raises:
            ValueError: worktree 不存在
            subprocess.CalledProcessError: Git 命令执行失败
        """
        agent_id = self._validate_identifier(agent_id, "agent_id")
        worktree_info = self.worktrees.get(agent_id)
        if not worktree_info:
            raise ValueError(f"Worktree for agent {agent_id} not found")
        worktree_info.path = self._assert_managed_worktree_path(worktree_info.path)
        dirty = self._is_git_path_dirty(worktree_info.path) if (dry_run or require_clean) else False
        if require_clean and dirty:
            raise RuntimeError(f"Refusing to remove dirty worktree for agent {agent_id}")
        
        try:
            args = ["worktree", "remove"]
            if force:
                args.append("--force")
            args.append(worktree_info.path)

            if dry_run:
                return {
                    "agent_id": agent_id,
                    "path": worktree_info.path,
                    "branch": worktree_info.branch,
                    "force": force,
                    "dirty": dirty,
                    "command": ["git"] + args,
                }
            
            self._run_git_command(args)
            
            # 删除信息
            del self.worktrees[agent_id]
            return None
            
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"Failed to remove worktree: {e.stderr}")
    
    def cleanup_old_worktrees(
        self,
        older_than_hours: int = 24,
        dry_run: bool = False,
        require_clean: bool = False
    ) -> List[str]:
        """
        清理旧的 worktree
        
        Args:
            older_than_hours: 清理超过此小时数的 worktree
            dry_run: 仅返回将清理的 agent_id，不删除
            require_clean: 删除前要求 worktree 没有未提交变更
            
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
                    self.remove_worktree(
                        agent_id,
                        force=True,
                        dry_run=dry_run,
                        require_clean=require_clean
                    )
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
