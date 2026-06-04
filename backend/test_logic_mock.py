
import asyncio
import json
import uuid
from datetime import datetime
from enum import Enum
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
import pytest

# --- MOCK SCHEMAS ---
class TaskStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"

class TaskType(str, Enum):
    GENERAL = "general"
    CODE_DEVELOPMENT = "code_development"
    CLUSTER = "cluster"
    HYBRID = "hybrid"

class TaskPriority(int, Enum):
    NORMAL = 2

class AgentRole(str, Enum):
    GENERAL = "general"

@dataclass
class SubTask:
    id: str
    name: str
    description: str
    status: TaskStatus = TaskStatus.PENDING
    task_type: TaskType = TaskType.GENERAL
    dependencies: List[str] = field(default_factory=list)
    agent_role: Optional[str] = None

@dataclass
class Task:
    id: str
    title: str
    description: str
    task_type: TaskType
    use_subagent_mode: bool = False
    strategy_mode: str = "manual"
    input_data: Dict[str, Any] = field(default_factory=dict)
    subtasks: List[SubTask] = field(default_factory=list)

# --- MOCK LOGIC (Extracted from TaskScheduler) ---
async def decompose_cluster_task(task: Task):
    """分解集群任务 - 无依赖并行执行"""
    items = task.input_data.get("items", [task.title])
    subtasks = []
    for i, item in enumerate(items):
        subtask = SubTask(
            id=f"{task.id}-cluster-{i}",
            name=f"Cluster Task {i}: {str(item)[:20]}",
            description=f"Parallel processing for: {str(item)}",
            status=TaskStatus.PENDING,
            task_type=TaskType.GENERAL,
            dependencies=[]
        )
        subtasks.append(subtask)
    task.subtasks = subtasks

async def decompose_hybrid_task(task: Task):
    """分解混合任务 - 功能组级调度"""
    groups = task.input_data.get("suggested_groups", ["Frontend", "Backend", "QA"])
    subtasks = []
    for i, group in enumerate(groups):
        subtask = SubTask(
            id=f"{task.id}-group-{i}",
            name=f"Group: {group}",
            description=f"Handle {group} related work for {task.title}",
            status=TaskStatus.PENDING,
            task_type=TaskType.GENERAL,
            agent_role=AgentRole.GENERAL,
            dependencies=[] if i == 0 else [subtasks[i-1].id]
        )
        subtasks.append(subtask)
    task.subtasks = subtasks

# --- TEST RUNNER ---
@pytest.mark.asyncio
async def test_logic():
    print("🧪 Starting Core Logic Test (Self-Mocking Mode)...\n")
    
    # 1. Test Cluster Decomp
    print("--- 1. Testing Cluster Decomposition ---")
    task1 = Task(
        id=str(uuid.uuid4()),
        title="Batch Process",
        description="Parallel test",
        task_type=TaskType.CLUSTER,
        input_data={"items": ["Task A", "Task B", "Task C"]}
    )
    await decompose_cluster_task(task1)
    print(f"Subtasks: {len(task1.subtasks)}")
    for s in task1.subtasks:
        print(f"  - {s.id}: {s.name} (Deps: {s.dependencies})")
    assert len(task1.subtasks) == 3
    assert all(len(s.dependencies) == 0 for s in task1.subtasks)
    print("✅ Cluster Mode Logic Verified!\n")

    # 2. Test Hybrid Decomp
    print("--- 2. Testing Hybrid Decomposition ---")
    task2 = Task(
        id=str(uuid.uuid4()),
        title="Full Project",
        description="Sequential groups",
        task_type=TaskType.HYBRID,
        input_data={"suggested_groups": ["Design", "Dev", "Test"]}
    )
    await decompose_hybrid_task(task2)
    print(f"Subtasks: {len(task2.subtasks)}")
    for i, s in enumerate(task2.subtasks):
        print(f"  - {s.id}: {s.name} (Deps: {s.dependencies})")
        if i > 0:
            assert task2.subtasks[i-1].id in s.dependencies
    assert len(task2.subtasks) == 3
    print("✅ Hybrid Mode Logic Verified!\n")

    print("✨ Core Decomposition logic verified successfully!")

if __name__ == "__main__":
    asyncio.run(test_logic())
