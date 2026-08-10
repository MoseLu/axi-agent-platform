from fastapi.testclient import TestClient

from app.main import app


def test_legacy_agent_and_tool_execution_endpoints_require_workflow_routing():
    client = TestClient(app)

    agent = client.post(
        "/api/v1/agents/agent-legacy/execute",
        params={"task_input": "attempt a direct model call"},
    )
    tool = client.post(
        "/api/v1/tools/tool-legacy/execute",
        json={"parameters": {}},
    )

    assert agent.status_code == 409
    assert agent.json()["detail"]["code"] == "workflow_required"
    assert tool.status_code == 409
    assert tool.json()["detail"]["code"] == "workflow_required"


def test_legacy_worktree_command_endpoint_requires_approved_effect():
    response = TestClient(app).post(
        "/subagent/worktree/commit",
        json={"agent_id": "agent-legacy", "message": "must not commit directly"},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "approval_required"
