import os
import subprocess
from datetime import datetime
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).resolve().parents[1] / "app" / "core" / "code_isolation_manager.py"
SPEC = spec_from_file_location("code_isolation_manager", MODULE_PATH)
assert SPEC and SPEC.loader
code_isolation_manager = module_from_spec(SPEC)
SPEC.loader.exec_module(code_isolation_manager)

CodeIsolationManager = code_isolation_manager.CodeIsolationManager
WorktreeInfo = code_isolation_manager.WorktreeInfo


def make_manager(tmp_path):
    return CodeIsolationManager(str(tmp_path / "repo"))


def completed(args):
    return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")


def run_git(cwd, *args):
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=True,
    )


def init_git_repo(path, remote_path=None):
    path.mkdir(parents=True, exist_ok=True)
    run_git(path, "init", "--initial-branch=main")
    run_git(path, "config", "user.email", "axi-agent@example.test")
    run_git(path, "config", "user.name", "Axi Agent Test")
    run_git(path, "config", "pull.rebase", "false")
    if remote_path:
        run_git(path, "remote", "add", "origin", str(remote_path))


def test_create_worktree_rejects_path_traversal_agent_id(tmp_path):
    manager = make_manager(tmp_path)

    with pytest.raises(ValueError, match="agent_id"):
        manager.create_worktree("../outside", branch_name="feature/safe", base_branch="main")

    assert not (tmp_path / "outside").exists()


def test_create_worktree_rejects_unsafe_branch_names(tmp_path):
    manager = make_manager(tmp_path)

    invalid_values = ["../branch", "-branch", "feature//branch", "feature branch", "feature@{1}"]
    for branch_name in invalid_values:
        with pytest.raises(ValueError, match="branch_name"):
            manager.create_worktree("agent-1", branch_name=branch_name, base_branch="main")

    with pytest.raises(ValueError, match="base_branch"):
        manager.create_worktree("agent-1", branch_name="feature/safe", base_branch="../main")


def test_create_worktree_uses_managed_path_and_safe_git_args(tmp_path):
    manager = make_manager(tmp_path)
    calls = []

    def fake_git(args, cwd=None):
        calls.append((args, cwd))
        return completed(["git"] + args)

    manager._run_git_command = fake_git

    path = manager.create_worktree(
        "agent-1",
        branch_name="feature/agent-1",
        base_branch="origin/main",
    )

    assert path == os.path.join(manager.worktrees_dir, "agent-1")
    assert os.path.commonpath([manager.worktrees_dir, path]) == manager.worktrees_dir
    assert calls == [
        (
            [
                "worktree",
                "add",
                "-b",
                "feature/agent-1",
                path,
                "origin/main",
            ],
            None,
        )
    ]
    assert manager.worktrees["agent-1"].path == path


def test_remove_worktree_refuses_unmanaged_path_before_git(tmp_path):
    manager = make_manager(tmp_path)
    calls = []

    def fake_git(args, cwd=None):
        calls.append((args, cwd))
        return completed(["git"] + args)

    manager._run_git_command = fake_git
    manager.worktrees["agent-1"] = WorktreeInfo(
        path=str(tmp_path / "outside"),
        branch="feature/agent-1",
        agent_id="agent-1",
        created_at=datetime.now(),
    )

    with pytest.raises(ValueError, match="unmanaged"):
        manager.remove_worktree("agent-1", force=True)

    assert calls == []
    assert "agent-1" in manager.worktrees


def test_remove_worktree_dry_run_returns_command_without_removing(tmp_path):
    manager = make_manager(tmp_path)
    calls = []
    worktree_path = os.path.join(manager.worktrees_dir, "agent-1")
    manager.worktrees["agent-1"] = WorktreeInfo(
        path=worktree_path,
        branch="feature/agent-1",
        agent_id="agent-1",
        created_at=datetime.now(),
    )

    def fake_git(args, cwd=None):
        calls.append((args, cwd))
        if args == ["status", "--porcelain"]:
            return subprocess.CompletedProcess(args=args, returncode=0, stdout=" M file.txt\n", stderr="")
        return completed(["git"] + args)

    manager._run_git_command = fake_git

    result = manager.remove_worktree("agent-1", force=True, dry_run=True)

    assert result["dirty"] is True
    assert result["command"] == ["git", "worktree", "remove", "--force", worktree_path]
    assert "agent-1" in manager.worktrees
    assert calls == [(["status", "--porcelain"], worktree_path)]


def test_remove_worktree_require_clean_refuses_dirty_worktree(tmp_path):
    manager = make_manager(tmp_path)
    calls = []
    worktree_path = os.path.join(manager.worktrees_dir, "agent-1")
    manager.worktrees["agent-1"] = WorktreeInfo(
        path=worktree_path,
        branch="feature/agent-1",
        agent_id="agent-1",
        created_at=datetime.now(),
    )

    def fake_git(args, cwd=None):
        calls.append((args, cwd))
        return subprocess.CompletedProcess(args=args, returncode=0, stdout=" M file.txt\n", stderr="")

    manager._run_git_command = fake_git

    with pytest.raises(RuntimeError, match="dirty worktree"):
        manager.remove_worktree("agent-1", force=True, require_clean=True)

    assert calls == [(["status", "--porcelain"], worktree_path)]
    assert "agent-1" in manager.worktrees


def test_merge_worktree_refuses_dirty_base_repo_before_checkout(tmp_path):
    manager = make_manager(tmp_path)
    calls = []
    worktree_path = os.path.join(manager.worktrees_dir, "agent-1")
    manager.worktrees["agent-1"] = WorktreeInfo(
        path=worktree_path,
        branch="feature/agent-1",
        agent_id="agent-1",
        created_at=datetime.now(),
    )

    def fake_git(args, cwd=None):
        calls.append((args, cwd))
        if args == ["status", "--porcelain"] and cwd == manager.base_repo_path:
            return subprocess.CompletedProcess(args=args, returncode=0, stdout=" M app.py\n", stderr="")
        return completed(["git"] + args)

    manager._run_git_command = fake_git

    with pytest.raises(RuntimeError, match="dirty base repository"):
        manager.merge_worktree("agent-1", target_branch="main")

    assert calls == [(["status", "--porcelain"], manager.base_repo_path)]


def test_cleanup_old_worktrees_dry_run_keeps_entries(tmp_path):
    from datetime import timedelta

    manager = make_manager(tmp_path)
    worktree_path = os.path.join(manager.worktrees_dir, "agent-1")
    manager.worktrees["agent-1"] = WorktreeInfo(
        path=worktree_path,
        branch="feature/agent-1",
        agent_id="agent-1",
        created_at=datetime.now() - timedelta(hours=48),
    )

    def fake_git(args, cwd=None):
        if args == ["status", "--porcelain"]:
            return completed(args)
        raise AssertionError(f"unexpected git call: {args}")

    manager._run_git_command = fake_git

    removed_ids = manager.cleanup_old_worktrees(older_than_hours=24, dry_run=True)

    assert removed_ids == ["agent-1"]
    assert "agent-1" in manager.worktrees


def test_run_git_command_rejects_unmanaged_cwd(tmp_path):
    manager = make_manager(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()

    with pytest.raises(ValueError, match="Refusing to run git"):
        manager._run_git_command(["status"], cwd=str(outside))


def test_merge_worktree_aborts_real_git_conflict_and_leaves_base_clean(tmp_path):
    remote_path = tmp_path / "remote.git"
    subprocess.run(
        ["git", "init", "--bare", "--initial-branch=main", str(remote_path)],
        capture_output=True,
        text=True,
        check=True,
    )

    base_path = tmp_path / "repo"
    init_git_repo(base_path, remote_path)
    shared_file = base_path / "shared.txt"
    shared_file.write_text("initial\n", encoding="utf-8")
    run_git(base_path, "add", "shared.txt")
    run_git(base_path, "commit", "-m", "initial")
    run_git(base_path, "push", "-u", "origin", "main")

    manager = CodeIsolationManager(str(base_path))
    worktree_path = Path(
        manager.create_worktree(
            "agent-1",
            branch_name="feature/agent-1",
            base_branch="main",
        )
    )

    (worktree_path / "shared.txt").write_text("agent change\n", encoding="utf-8")
    run_git(worktree_path, "add", "shared.txt")
    run_git(worktree_path, "commit", "-m", "agent change")

    shared_file.write_text("main change\n", encoding="utf-8")
    run_git(base_path, "add", "shared.txt")
    run_git(base_path, "commit", "-m", "main change")

    assert manager.merge_worktree("agent-1", target_branch="main") is False
    assert run_git(base_path, "status", "--porcelain").stdout == ""
    assert run_git(base_path, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip() == "main"
    assert shared_file.read_text(encoding="utf-8") == "main change\n"
