from app.core.axi_agent_mcp_client import (
    AXI_AGENT_MCP_MUTATING_TOOLS,
    AXI_AGENT_MCP_REQUIRED_TOOLS,
    AxiAgentMcpClient,
    default_axi_agent_mcp_root,
)


def test_default_axi_agent_mcp_root_points_to_service_owner():
    service_root = default_axi_agent_mcp_root()

    assert service_root.name == "axi-agent-mcp"
    assert (service_root / "package.json").exists()
    assert (service_root / "src" / "index.ts").exists()


def test_axi_agent_mcp_client_lists_external_service_tools():
    client = AxiAgentMcpClient(timeout_seconds=10)

    summary = client.get_service_summary()

    assert summary["service"] == "axi-agent-mcp"
    assert summary["tool_count"] == 43
    assert summary["required_tools_present"] is True
    assert summary["missing_required_tools"] == []
    assert summary["missing_mutating_tools"] == []
    assert set(summary["mutating_tools"]) == AXI_AGENT_MCP_MUTATING_TOOLS
    assert "swarm_write_file" in AXI_AGENT_MCP_MUTATING_TOOLS


def test_axi_agent_mcp_client_calls_quality_gate_tool():
    client = AxiAgentMcpClient(timeout_seconds=10)

    result = client.validate_with_quality_gates(
        "function add(a, b) { return a + b; }",
        gate_ids=["code_quality"],
    )

    assert result["source"] == "axi-agent-mcp"
    assert result["tool"] == "swarm_validate_with_gates"
    assert "质量门控验证结果" in result["text"]
    assert "code_quality" in result["text"] or "代码质量" in result["text"]
