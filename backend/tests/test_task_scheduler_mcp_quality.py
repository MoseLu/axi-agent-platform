import asyncio

from app.core.axi_agent_mcp_client import AxiAgentMcpClientError
from app.core.task_scheduler import TaskScheduler
from app.schemas.agent import AgentRole
from app.schemas.task import SubTask, Task, TaskPriority, TaskStatus, TaskType


class FakeMcpQualityClient:
    def __init__(self):
        self.calls = []

    def validate_with_quality_gates(self, content, project_root=None, gate_ids=None):
        self.calls.append(
            {
                "content": content,
                "project_root": project_root,
                "gate_ids": gate_ids,
            }
        )
        return {
            "source": "axi-agent-mcp",
            "tool": "swarm_validate_with_gates",
            "passed": True,
            "text": "质量门控验证结果\n**验证状态**: ✅ 通过",
        }


class FailingMcpQualityClient:
    def validate_with_quality_gates(self, content, project_root=None, gate_ids=None):
        raise AxiAgentMcpClientError("mcp unavailable")


def make_quality_task():
    implementation = SubTask(
        id="impl",
        name="Implement Code",
        description="Implement feature",
        status=TaskStatus.COMPLETED,
        output_data={"content": "implemented code"},
    )
    judge = SubTask(
        id="judge",
        name="Quality Assessment",
        description="Assess implementation",
        status=TaskStatus.RUNNING,
        agent_id="judge-agent",
        agent_role=AgentRole.JUDGE.value,
        output_data={"content": "judge review"},
    )
    task = Task(
        id="task-1",
        title="Build feature",
        description="Build a feature with tests",
        priority=TaskPriority.NORMAL,
        task_type=TaskType.CODE_DEVELOPMENT,
        strategy_mode="manual",
        repository_path="/tmp/example-repo",
        subtasks=[implementation, judge],
    )
    return task, judge


def test_quality_check_uses_axi_agent_mcp_client():
    client = FakeMcpQualityClient()
    scheduler = TaskScheduler()
    scheduler.set_dependencies(None, None, None, axi_agent_mcp_client=client)
    task, judge = make_quality_task()

    asyncio.run(scheduler._quality_check(judge, task, {"content": "judge review"}))

    assessment = task.output_data["quality_assessment"]
    assert assessment["source"] == "axi-agent-mcp"
    assert assessment["tool"] == "swarm_validate_with_gates"
    assert assessment["passed"] is True
    assert "质量门控验证结果" in assessment["raw_text"]
    assert client.calls[0]["project_root"] == "/tmp/example-repo"
    assert "implemented code" in client.calls[0]["content"]


def test_quality_check_falls_back_when_axi_agent_mcp_unavailable():
    scheduler = TaskScheduler()
    scheduler.set_dependencies(None, None, None, axi_agent_mcp_client=FailingMcpQualityClient())
    task, judge = make_quality_task()

    asyncio.run(scheduler._quality_check(judge, task, {"content": "judge review"}))

    assessment = task.output_data["quality_assessment"]
    assert assessment["source"] == "local-fallback"
    assert assessment["passed"] is True
    assert assessment["error"] == "mcp unavailable"
