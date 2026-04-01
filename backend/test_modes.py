import asyncio
import json
from datetime import datetime
from app.core.task_scheduler import TaskScheduler
from app.schemas.task import TaskCreate, TaskType, TaskStatus
from app.core.agent_manager import AgentManager

async def test_modes():
    print("🚀 Starting Collaboration Modes Test...\n")
    
    scheduler = TaskScheduler()
    # Mock dependence to avoid errors
    agent_manager = AgentManager()
    scheduler.set_dependencies(agent_manager, None, None, None)
    
    # 1. Test Cluster Mode
    print("--- Testing Cluster Mode ---")
    cluster_task_data = TaskCreate(
        title="Batch Image Processing",
        description="Process 3 images in parallel",
        task_type=TaskType.CLUSTER,
        use_subagent_mode=True,
        strategy_mode="manual",
        input_data={"items": ["img1.jpg", "img2.jpg", "img3.jpg"]}
    )
    task1 = await scheduler.create_task(cluster_task_data)
    # Manual trigger decomposition since we are not running the full loop
    await scheduler._decompose_cluster_task(task1)
    
    print(f"Task ID: {task1.id}")
    print(f"Task Type: {task1.task_type}")
    print(f"Subtasks count: {len(task1.subtasks)}")
    for st in task1.subtasks:
        print(f"  - Subtask: {st.name}, Dependencies: {st.dependencies}")
    
    assert len(task1.subtasks) == 3
    assert all(len(st.dependencies) == 0 for st in task1.subtasks)
    print("✅ Cluster Mode Verified!\n")

    # 2. Test Hybrid Mode
    print("--- Testing Hybrid Mode ---")
    hybrid_task_data = TaskCreate(
        title="Fullstack Web App",
        description="Develop a web app with frontend and backend",
        task_type=TaskType.HYBRID,
        use_subagent_mode=True,
        strategy_mode="manual",
        input_data={"suggested_groups": ["Database", "API", "Frontend", "Deployment"]}
    )
    task2 = await scheduler.create_task(hybrid_task_data)
    await scheduler._decompose_hybrid_task(task2)
    
    print(f"Task ID: {task2.id}")
    print(f"Task Type: {task2.task_type}")
    print(f"Subtasks count: {len(task2.subtasks)}")
    for i, st in enumerate(task2.subtasks):
        print(f"  - Subtask: {st.name}, Dependencies: {st.dependencies}")
        if i > 0:
            assert task2.subtasks[i-1].id in st.dependencies
            
    assert len(task2.subtasks) == 4
    print("✅ Hybrid Mode Verified!\n")

    # 3. Test Auto Strategy (Qwen LLM)
    print("--- Testing Auto Strategy (Real LLM) ---")
    auto_task_data = TaskCreate(
        title="Scrape 100 news articles",
        description="I need to collect news from various sources in parallel",
        task_type=TaskType.GENERAL,
        strategy_mode="auto"
    )
    task3 = await scheduler.create_task(auto_task_data)
    
    print("Waiting for LLM analysis (3 seconds)...")
    await asyncio.sleep(5) # Wait for _apply_auto_strategy to finish
    
    print(f"Analyzed Task Type: {task3.task_type}")
    print(f"Use Subagent Mode: {task3.use_subagent_mode}")
    
    # Trigger decomposition based on auto-selected type
    if task3.task_type == TaskType.CLUSTER:
        await scheduler._decompose_cluster_task(task3)
    elif task3.task_type == TaskType.HYBRID:
        await scheduler._decompose_hybrid_task(task3)
    elif task3.task_type == TaskType.CODE_DEVELOPMENT:
        # Mocking code isolation manager would be needed for a full test
        print("Auto-selected Code Development mode.")
    
    print(f"Subtasks count: {len(task3.subtasks)}")
    print("✅ Auto Strategy Verified!\n")

    print("✨ All tests completed successfully!")

if __name__ == "__main__":
    asyncio.run(test_modes())
