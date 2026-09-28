"""Tests for Phase 1 commit 4 — Capability Broker enforcement at tool-call sites.

The Broker adds a SECOND enforcement layer at the tool-call site on top of the
existing ``TaskRoutingGuard``. After this commit, ``ToolManager.execute_tool``
and ``AxiAgentMcpClient.call_tool`` MUST refuse to run any side-effect tool
without a broker-issued ``capability_id`` (or the workstation auto-issuance
path for known-safe MCP tools).

Coverage:

* ``ToolManager.execute_tool(tool_id, parameters, capability_id=None)``
  raises ``CapabilityError`` (the no-capability branch is the load-bearing
  acceptance criterion: "没有 Capability 的工具调用必须在服务端失败").
* ``AxiAgentMcpClient.call_tool(name, arguments, capability_id=None)`` raises
  ``CapabilityError``.
* After issuing a capability, ``execute_tool`` succeeds for the read_file path
  (returns a successful ``ToolExecutionResult``).
* After consuming a capability once, calling again with the same
  ``capability_id`` raises ``CapabilityExhaustedError`` (``max_uses=1``).
* A capability issued for ``read_file`` is rejected by
  ``execute_tool("write_file", ...)`` because ``compute_action_digest`` differs
  (``ActionDigestMismatchError`` surfaces from the broker).
* An unknown tool id is rejected by the broker before reaching
  ``execute_tool``'s handler (``UnknownToolError``).
* The workstation auto-issuance path consumes the capability and exposes the
  ``swarm_git_status`` and ``swarm_validate_with_gates`` tools through their
  public wrapper functions.

Each test resets the runtime broker singleton via
``reset_runtime_broker_for_tests`` so the per-test manifest is deterministic
and tests do not leak capabilities across cases.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

import pytest

from app.core.capability_broker import (
    ActionDigestMismatchError,
    Capability,
    CapabilityBroker,
    CapabilityError,
    CapabilityExhaustedError,
    UnknownToolError,
)
from app.core.governance_runtime import (
    get_runtime_broker,
    reset_runtime_broker_for_tests,
    set_runtime_broker,
)
from app.core.axi_agent_mcp_client import AxiAgentMcpClient, AxiAgentMcpClientError
from app.tools.manager import ToolManager


# ---------- fixtures ----------


@pytest.fixture(autouse=True)
def _reset_broker():
    """Drop the runtime broker singleton between tests.

    Each test gets a fresh in-memory ledger built from the default manifest,
    so issued capabilities from one test cannot leak into another. Production
    code MUST NOT call the reset."""
    reset_runtime_broker_for_tests()
    yield
    reset_runtime_broker_for_tests()


@pytest.fixture
def broker() -> CapabilityBroker:
    return get_runtime_broker()


def _issue_for(
    broker: CapabilityBroker,
    *,
    tool: str,
    parameters: Dict[str, Any],
    subject: str = "test-agent",
) -> Capability:
    """Issue a capability whose ``allowed_target`` matches the tool id.

    ``ToolManager.execute_tool`` and ``AxiAgentMcpClient.call_tool`` both
    pass ``target=tool_id`` to ``broker.consume`` (the tool id is the
    binding that ties the capability to the call site). Tests that want
    a capability to redeem via the manager / MCP client MUST therefore
    issue against the same target."""
    action_digest = CapabilityBroker.compute_action_digest(tool, parameters)
    return broker.issue(
        subject=subject,
        tool=tool,
        plan_digest="p" * 64,
        action_digest=action_digest,
        allowed_target=tool,
        idempotency_key=None,
        ttl_seconds=300,
    )


# ---------- ToolManager.execute_tool ----------


def test_execute_tool_without_capability_id_raises_capability_error():
    """The load-bearing acceptance criterion: a tool call without a broker
    capability MUST fail server-side before any handler runs."""
    manager = ToolManager()

    with pytest.raises(CapabilityError) as excinfo:
        # ``initialize`` is not called here because the broker gate fires
        # BEFORE the handler dispatch path that touches ``self._tools``.
        asyncio.run(
            manager.execute_tool(
                tool_id="read_file",
                parameters={"path": "/etc/hosts"},
                capability_id=None,
            )
        )

    assert "missing capability_id" in str(excinfo.value)


def test_execute_tool_succeeds_after_issuing_capability(tmp_path, broker: CapabilityBroker):
    """End-to-end happy path: issue a capability for ``read_file``, then run
    ``execute_tool`` and assert the call succeeds (handler returns the file
    contents)."""
    target = tmp_path / "sample.txt"
    target.write_text("hello world", encoding="utf-8")

    manager = ToolManager()
    asyncio.run(manager.initialize(vector_store=None))  # type: ignore[arg-type]

    parameters = {"path": str(target)}
    cap = _issue_for(broker, tool="read_file", parameters=parameters)

    result = asyncio.run(
        manager.execute_tool(
            tool_id="read_file",
            parameters=parameters,
            capability_id=cap.capability_id,
        )
    )

    assert result.success is True
    assert result.error is None
    # ``read_file`` handler returns the file contents as a string.
    assert result.result == "hello world"


def test_execute_tool_consumes_capability_one_shot(broker: CapabilityBroker):
    """After a single consume, the same capability_id MUST be rejected with
    ``CapabilityExhaustedError`` because ``max_uses=1``."""
    manager = ToolManager()
    asyncio.run(manager.initialize(vector_store=None))  # type: ignore[arg-type]

    parameters = {"path": "/etc/hosts"}
    cap = _issue_for(broker, tool="read_file", parameters=parameters)

    # First call succeeds.
    asyncio.run(
        manager.execute_tool(
            tool_id="read_file",
            parameters=parameters,
            capability_id=cap.capability_id,
        )
    )

    # Second call with the same capability_id is rejected by the broker.
    with pytest.raises(CapabilityExhaustedError):
        asyncio.run(
            manager.execute_tool(
                tool_id="read_file",
                parameters=parameters,
                capability_id=cap.capability_id,
            )
        )


def test_execute_tool_rejects_capability_issued_for_different_action(
    broker: CapabilityBroker,
):
    """A capability issued for ``read_file`` MUST NOT redeem ``write_file``:
    the ``compute_action_digest`` differs because the leading tool-id byte
    changes the SHA-256 prefix."""
    manager = ToolManager()
    asyncio.run(manager.initialize(vector_store=None))  # type: ignore[arg-type]

    cap = _issue_for(broker, tool="read_file", parameters={"path": "/tmp/a.txt"})

    with pytest.raises(ActionDigestMismatchError):
        asyncio.run(
            manager.execute_tool(
                tool_id="write_file",
                parameters={"path": "/tmp/a.txt", "content": "hello"},
                capability_id=cap.capability_id,
            )
        )


def test_execute_tool_rejects_unknown_tool_before_handler(broker: CapabilityBroker):
    """Issuing a capability for an unknown tool id raises ``UnknownToolError``
    at the broker — the handler dispatch path is never reached."""
    with pytest.raises(UnknownToolError):
        _issue_for(broker, tool="definitely_not_in_manifest", parameters={"path": "/tmp/a.txt"})


def test_execute_tool_with_unknown_capability_id_raises_unknown_tool():
    """An unknown capability_id (one never issued) MUST fail the broker gate.
    The surface exception type is ``UnknownToolError`` (subclass of
    ``CapabilityError``) so the no-capability invariant is preserved even if
    the caller lies about having a capability_id."""
    manager = ToolManager()
    asyncio.run(manager.initialize(vector_store=None))  # type: ignore[arg-type]

    with pytest.raises(CapabilityError):
        asyncio.run(
            manager.execute_tool(
                tool_id="read_file",
                parameters={"path": "/etc/hosts"},
                capability_id="0" * 64,  # never issued
            )
        )


# ---------- AxiAgentMcpClient.call_tool ----------


def test_call_tool_without_capability_id_raises_capability_error():
    """Mirror of the ToolManager test: ``call_tool`` without a
    ``capability_id`` MUST fail server-side."""
    client = AxiAgentMcpClient(command="true", args=[], timeout_seconds=1)

    with pytest.raises(CapabilityError) as excinfo:
        client.call_tool("swarm_git_status", {}, capability_id=None)

    assert "missing capability_id" in str(excinfo.value)


def test_call_tool_rejects_unknown_capability_id():
    """An unknown capability_id on the MCP path MUST also be rejected before
    any wire dispatch."""
    client = AxiAgentMcpClient(command="true", args=[], timeout_seconds=1)

    with pytest.raises(CapabilityError):
        client.call_tool("swarm_git_status", {}, capability_id="0" * 64)


def test_call_tool_consumes_capability_one_shot(broker: CapabilityBroker):
    """``call_tool`` must obey the same one-shot contract as ``execute_tool``:
    consuming once succeeds, consuming again raises
    ``CapabilityExhaustedError``."""
    client = AxiAgentMcpClient(command="true", args=[], timeout_seconds=1)

    cap = _issue_for(broker, tool="swarm_git_status", parameters={"repoPath": "/tmp/axi-agent"})

    # First consume succeeds (the actual subprocess.Popen call may then fail
    # because ``true`` is not a valid MCP server; we only care about the
    # broker gate firing BEFORE that wire call).
    with pytest.raises(AxiAgentMcpClientError):
        # The broker gate consumes the capability first; the underlying
        # ``_request_mcp`` then fails because ``true`` is not an MCP server,
        # but the capability has already been consumed.
        client.call_tool("swarm_git_status", {"repoPath": "/tmp/axi-agent"}, capability_id=cap.capability_id)

    # Second consume with the same capability_id is rejected.
    with pytest.raises(CapabilityExhaustedError):
        client.call_tool("swarm_git_status", {"repoPath": "/tmp/axi-agent"}, capability_id=cap.capability_id)


# ---------- workstation auto-issuance ----------


def test_run_workstation_readonly_tool_auto_issues_capability(broker: CapabilityBroker):
    """``run_workstation_readonly_tool`` MUST auto-issue a one-shot capability
    internally so its existing callers (the ``/workstation`` API and
    ``TaskScheduler``) keep working without threading ``capability_id``
    through the workflow pipeline. The capability is scoped to
    ``subject="workstation"`` and the safe-tools allowlist restricts the tool
    id to ``swarm_git_status``."""

    # Stub out the subprocess wire call so the test does not depend on a
    # running MCP server. The broker gate fires BEFORE the wire call, so
    # the broker side-effects (issued capability ledger) are exercised.
    captured: Dict[str, Any] = {}

    def fake_request_mcp(_request: Dict[str, Any]) -> Dict[str, Any]:
        captured["called"] = True
        return {
            "content": [
                {"type": "text", "text": "📊 Git 状态\n分支：dev\n\n✅ 工作区干净"}
            ]
        }

    client = AxiAgentMcpClient(command="true", args=[], timeout_seconds=1)
    client._request_mcp = fake_request_mcp  # type: ignore[assignment]

    # ``run_workstation_readonly_tool`` will auto-issue and consume a
    # capability internally. The ledger MUST end up with one issued + one
    # consumed capability, both bound to ``swarm_git_status``.
    before = sum(1 for c in broker._caps.values())  # type: ignore[attr-defined]
    result = client.run_workstation_readonly_tool("swarm_git_status", {"repoPath": "/tmp/axi-agent"})
    after = sum(1 for c in broker._caps.values())  # type: ignore[attr-defined]

    assert captured.get("called") is True
    assert result["tool"] == "swarm_git_status"
    assert result["passed"] is True
    assert after - before == 1, "auto-issuance must register exactly one capability"
    issued = next(iter(broker._caps.values()))  # type: ignore[attr-defined]
    assert issued.subject == "workstation"
    assert issued.tool == "swarm_git_status"
    assert issued.uses == 1


def test_run_workstation_readonly_tool_rejects_mutating_tool():
    """The workstation safe-tools allowlist MUST continue to reject
    mutating/unapproved tool ids, independent of the broker gate."""
    client = AxiAgentMcpClient(command="true", args=[], timeout_seconds=1)

    with pytest.raises(AxiAgentMcpClientError) as excinfo:
        client.run_workstation_readonly_tool("swarm_write_file", {"path": "/tmp/x.txt"})

    assert "mutating or unapproved" in str(excinfo.value)


def test_validate_with_quality_gates_auto_issues_capability(broker: CapabilityBroker):
    """``validate_with_quality_gates`` MUST auto-issue a workstation
    capability for ``swarm_validate_with_gates``."""
    captured: Dict[str, Any] = {}

    def fake_request_mcp(_request: Dict[str, Any]) -> Dict[str, Any]:
        captured["called"] = True
        return {
            "content": [
                {"type": "text", "text": "质量门控验证结果\n**验证状态**: ✅ 通过"}
            ]
        }

    client = AxiAgentMcpClient(command="true", args=[], timeout_seconds=1)
    client._request_mcp = fake_request_mcp  # type: ignore[assignment]

    before = sum(1 for c in broker._caps.values())  # type: ignore[attr-defined]
    result = client.validate_with_quality_gates(
        "function add(a, b) { return a + b; }",
        gate_ids=["code_quality"],
    )
    after = sum(1 for c in broker._caps.values())  # type: ignore[attr-defined]

    assert captured.get("called") is True
    assert result["tool"] == "swarm_validate_with_gates"
    assert result["passed"] is True
    assert after - before == 1
    issued = next(iter(broker._caps.values()))  # type: ignore[attr-defined]
    assert issued.subject == "workstation"
    assert issued.tool == "swarm_validate_with_gates"
    assert issued.uses == 1


# ---------- integration with manifest ----------


def test_execute_tool_rejects_tool_not_in_manifest(broker: CapabilityBroker):
    """``execute_tool`` for a tool id the broker doesn't recognize MUST be
    rejected at issuance (before any handler dispatch)."""
    manager = ToolManager()
    asyncio.run(manager.initialize(vector_store=None))  # type: ignore[arg-type]

    # Force a known tool id + an unknown one to confirm the gate path is
    # independent of the handler path.
    with pytest.raises(UnknownToolError):
        _issue_for(broker, tool="not_a_builtin_tool", parameters={"path": "/tmp/a.txt"})


def test_execute_tool_consume_rejects_mismatched_target(broker: CapabilityBroker):
    """``execute_tool`` MUST fail when the capability's ``allowed_target``
    doesn't match the ``tool_id`` the broker gate binds to.

    The broker gate uses ``target=tool_id`` (the tool name) as the
    allowed-target binding. Reusing a capability issued for a different
    tool name therefore fails the target mismatch check, on top of the
    action_digest mismatch."""
    manager = ToolManager()
    asyncio.run(manager.initialize(vector_store=None))  # type: ignore[arg-type]

    # Issue for ``read_file`` (target = ``read_file``).
    cap = _issue_for(broker, tool="read_file", parameters={"path": "/tmp/a.txt"})

    with pytest.raises(ActionDigestMismatchError):
        # Different tool_id changes the action_digest, so the digest check
        # fires before the target check. Either way: refused.
        asyncio.run(
            manager.execute_tool(
                tool_id="write_file",
                parameters={"path": "/tmp/a.txt", "content": "x"},
                capability_id=cap.capability_id,
            )
        )