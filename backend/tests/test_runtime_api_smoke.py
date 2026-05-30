from fastapi.testclient import TestClient

from app.main import app


def test_runtime_api_surface_smoke():
    client = TestClient(app)

    root = client.get("/")
    assert root.status_code == 200
    assert root.json()["name"] == "Axi Agent Platform"

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "healthy"

    openapi = client.get("/openapi.json")
    assert openapi.status_code == 200
    paths = set(openapi.json()["paths"])

    for expected_path in [
        "/api/v1/agents",
        "/api/v1/tasks",
        "/api/v1/tools",
        "/api/v1/memory/sessions",
        "/api/v1/mcp/axi-agent/status",
        "/api/v1/workstation/agent-tasks/quality-gate",
        "/subagent/worktree/stats",
    ]:
        assert expected_path in paths
