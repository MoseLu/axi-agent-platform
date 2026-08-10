from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.api.workstation import (
    get_axi_agent_mcp_client,
    get_task_routing_guard,
    get_workflow_lifecycle_event_publisher,
)
from app.core.task_routing import TaskRoutingGuard
from app.main import app
from app.schemas.task import TaskRouteCredential, TaskRouteDecision


def workflow_envelope():
    secret = "test-route-secret"
    decision = TaskRouteDecision(
        route="bounded_agent",
        reasonCode="read_only_open_exploration",
        policyVersion="task-execution-routing/v1",
        traceId="trace-workstation-test",
        idempotencyKey="idempotency-workstation-test",
        contextRefs=[],
        toolAllowlist=["swarm_git_status", "swarm_validate_with_gates"],
        sandbox="read_only",
        limits={"maxSteps": 5, "maxWallTimeMs": 60_000, "maxModelTokens": 1_000, "maxEstimatedCost": 1},
    )
    now = datetime.now(timezone.utc)
    credential = TaskRouteCredential(
        credentialId="credential-workstation-test",
        subject="axi-workbench-workflow-engine",
        decisionDigest=TaskRoutingGuard.decision_digest(decision),
        issuedAt=now.isoformat(),
        expiresAt=(now + timedelta(minutes=5)).isoformat(),
        signature="0" * 64,
    )
    credential.signature = TaskRoutingGuard.credential_signature(credential, secret)
    return {
        "routeDecision": decision.model_dump(by_alias=True, mode="json"),
        "routeCredential": credential.model_dump(by_alias=True, mode="json"),
    }


def install_workflow_guard():
    app.dependency_overrides[get_task_routing_guard] = lambda: TaskRoutingGuard(
        credential_secret="test-route-secret",
        internal_event_token="test-event-token",
    )


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


class CapturingLifecyclePublisher:
    def __init__(self):
        self.events = []

    async def publish(self, event):
        self.events.append(event)


def test_workstation_quality_gate_task_uses_axi_agent_mcp_contract():
    app.dependency_overrides[get_axi_agent_mcp_client] = lambda: FakeQualityGateClient()
    install_workflow_guard()
    try:
        response = TestClient(app).post(
            "/api/v1/workstation/agent-tasks/quality-gate",
            json={
                "agentTaskId": "agent-task-1",
                "prompt": "review function add(a, b) { return a + b; }",
                "gateIds": ["code_quality"],
                "source": "axi-workstation",
                **workflow_envelope(),
            },
            headers={"X-Axi-Workflow-Token": "test-event-token"},
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
    install_workflow_guard()
    try:
        response = TestClient(app).post(
            "/api/v1/workstation/agent-tasks/tool-result",
            json={
                "agentTaskId": "agent-task-tool-1",
                "prompt": "run readonly git status",
                "toolName": "swarm_git_status",
                "toolArguments": {"repoPath": "/tmp/axi-agent"},
                "source": "axi-workstation",
                **workflow_envelope(),
            },
            headers={"X-Axi-Workflow-Token": "test-event-token"},
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


def test_workstation_direct_tool_request_cannot_bypass_workflow_guard():
    app.dependency_overrides[get_axi_agent_mcp_client] = lambda: FakeToolResultClient()
    install_workflow_guard()
    try:
        response = TestClient(app).post(
            "/api/v1/workstation/agent-tasks/tool-result",
            json={
                "agentTaskId": "direct-agent-task",
                "prompt": "run readonly git status",
                "toolName": "swarm_git_status",
                "toolArguments": {"repoPath": "/tmp/axi-agent"},
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "workflow_required"


def test_workstation_emits_minimal_authenticated_lifecycle_metadata():
    publisher = CapturingLifecyclePublisher()
    app.dependency_overrides[get_axi_agent_mcp_client] = lambda: FakeToolResultClient()
    app.dependency_overrides[get_workflow_lifecycle_event_publisher] = lambda: publisher
    install_workflow_guard()
    try:
        response = TestClient(app).post(
            "/api/v1/workstation/agent-tasks/tool-result",
            json={
                "agentTaskId": "agent-task-events-1",
                "prompt": "this prompt must never enter lifecycle telemetry",
                "toolName": "swarm_git_status",
                "toolArguments": {"repoPath": "/tmp/axi-agent"},
                **workflow_envelope(),
            },
            headers={"X-Axi-Workflow-Token": "test-event-token"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert [event.event_type for event in publisher.events] == ["started", "completed"]
    assert publisher.events[0].trace_id == "trace-workstation-test"
    assert publisher.events[1].data["tool"] == "swarm_git_status"
    assert "prompt" not in publisher.events[1].data
