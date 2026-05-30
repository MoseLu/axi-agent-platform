from fastapi.testclient import TestClient

from app.api.workstation import get_axi_agent_mcp_client
from app.main import app


class FakeQualityGateClient:
    def validate_with_quality_gates(self, content, gate_ids=None):
        assert content == "review function add(a, b) { return a + b; }"
        assert gate_ids == ["code_quality"]
        return {
            "source": "axi-agent-mcp",
            "tool": "swarm_validate_with_gates",
            "passed": True,
            "text": "质量门控验证结果\n**验证状态**: ✅ 通过",
        }


class FakeToolResultClient:
    def run_workstation_readonly_tool(self, tool_name, arguments=None):
        assert tool_name == "swarm_git_status"
        assert arguments == {"repoPath": "/tmp/axi-agent"}
        return {
            "source": "axi-agent-mcp",
            "tool": "swarm_git_status",
            "passed": True,
            "text": "📊 Git 状态\n分支：dev\n\n✅ 工作区干净",
        }


def test_workstation_quality_gate_task_uses_axi_agent_mcp_contract():
    app.dependency_overrides[get_axi_agent_mcp_client] = lambda: FakeQualityGateClient()
    try:
        response = TestClient(app).post(
            "/api/v1/workstation/agent-tasks/quality-gate",
            json={
                "agentTaskId": "agent-task-1",
                "prompt": "review function add(a, b) { return a + b; }",
                "gateIds": ["code_quality"],
                "source": "axi-workstation",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["agentTaskId"] == "agent-task-1"
    assert payload["runtime"] == "axi_agent_mcp"
    assert payload["status"] == "succeeded"
    assert payload["passed"] is True
    assert payload["source"] == "axi-agent-mcp"
    assert payload["tool"] == "swarm_validate_with_gates"


def test_workstation_tool_result_task_uses_readonly_axi_agent_mcp_contract():
    app.dependency_overrides[get_axi_agent_mcp_client] = lambda: FakeToolResultClient()
    try:
        response = TestClient(app).post(
            "/api/v1/workstation/agent-tasks/tool-result",
            json={
                "agentTaskId": "agent-task-tool-1",
                "prompt": "run readonly git status",
                "toolName": "swarm_git_status",
                "toolArguments": {"repoPath": "/tmp/axi-agent"},
                "source": "axi-workstation",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["agentTaskId"] == "agent-task-tool-1"
    assert payload["runtime"] == "axi_agent_mcp"
    assert payload["status"] == "succeeded"
    assert payload["passed"] is True
    assert payload["source"] == "axi-agent-mcp"
    assert payload["tool"] == "swarm_git_status"
