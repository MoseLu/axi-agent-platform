"""
Axi Agent MCP service client.

The platform owns runtime orchestration; axi-agent-mcp owns MCP tools. This
client verifies the service boundary over MCP stdio without importing or
duplicating the service implementation.
"""
import json
import os
import shlex
import subprocess
import threading
import queue
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import settings


AXI_AGENT_MCP_REQUIRED_TOOLS = {
    "swarm_chat",
    "swarm_chat_with_model",
    "swarm_analyze_task",
    "swarm_validate_with_gates",
    "swarm_git_status",
    "swarm_run_test",
}

AXI_AGENT_MCP_MUTATING_TOOLS = {
    "swarm_write_file",
    "swarm_modify_file",
    "swarm_git_commit",
    "swarm_git_create_branch",
    "swarm_autofix_lint",
    "swarm_vector_upsert",
}

AXI_AGENT_MCP_WORKSTATION_SAFE_TOOLS = {
    "swarm_git_status",
}


class AxiAgentMcpClientError(RuntimeError):
    """Raised when the external Axi Agent MCP service cannot be reached."""


def default_axi_agent_mcp_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "infra" / "axi-agent-mcp"
        if (candidate / "package.json").exists():
            return candidate
    return Path(__file__).resolve().parents[3] / "infra" / "axi-agent-mcp"


def default_axi_agent_mcp_args(service_root: Path) -> List[str]:
    if (service_root / "dist" / "index.js").exists():
        return ["dist/index.js"]
    return ["--import", "tsx", "src/index.ts"]


class AxiAgentMcpClient:
    def __init__(
        self,
        command: str = "node",
        args: Optional[List[str]] = None,
        cwd: Optional[Path] = None,
        timeout_seconds: float = 5.0,
        protocol_version: str = "2024-11-05",
    ):
        self.cwd = Path(cwd) if cwd else default_axi_agent_mcp_root()
        self.command = command
        self.args = args if args is not None else default_axi_agent_mcp_args(self.cwd)
        self.timeout_seconds = timeout_seconds
        self.protocol_version = protocol_version

    @classmethod
    def from_settings(cls) -> "AxiAgentMcpClient":
        cwd = Path(settings.AXI_AGENT_MCP_CWD) if settings.AXI_AGENT_MCP_CWD else default_axi_agent_mcp_root()
        args = (
            shlex.split(settings.AXI_AGENT_MCP_ARGS)
            if settings.AXI_AGENT_MCP_ARGS
            else default_axi_agent_mcp_args(cwd)
        )
        return cls(
            command=settings.AXI_AGENT_MCP_COMMAND,
            args=args,
            cwd=cwd,
            timeout_seconds=settings.AXI_AGENT_MCP_TIMEOUT_SECONDS,
            protocol_version=settings.AXI_AGENT_MCP_PROTOCOL_VERSION,
        )

    @property
    def command_line(self) -> List[str]:
        return [self.command, *self.args]

    def list_tools(self) -> Dict[str, Any]:
        response = self._request_mcp(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {},
            }
        )
        tools = response.get("tools", [])
        if not isinstance(tools, list):
            raise AxiAgentMcpClientError("Axi Agent MCP tools/list returned an invalid tools payload")
        return response

    def call_tool(self, name: str, arguments: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        result = self._request_mcp(
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": name,
                    "arguments": arguments or {},
                },
            }
        )
        content_items = result.get("content", [])
        if not isinstance(content_items, list):
            raise AxiAgentMcpClientError(f"Axi Agent MCP tool returned invalid content: {result!r}")
        text = "\n".join(
            item.get("text", "")
            for item in content_items
            if isinstance(item, dict) and item.get("type") == "text"
        ).strip()
        return {**result, "text": text}

    def validate_with_quality_gates(
        self,
        content: str,
        project_root: Optional[str] = None,
        gate_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        arguments: Dict[str, Any] = {"content": content}
        if project_root:
            arguments["projectRoot"] = project_root
        if gate_ids:
            arguments["gateIds"] = gate_ids

        result = self.call_tool("swarm_validate_with_gates", arguments)
        text = result.get("text", "")
        passed = "验证状态**: ✅ 通过" in text or (
            "✅ 通过" in text and "❌ 未通过" not in text
        )
        return {
            "source": "axi-agent-mcp",
            "tool": "swarm_validate_with_gates",
            "passed": passed,
            "text": text,
            "raw_result": result,
        }

    def run_workstation_readonly_tool(
        self,
        tool_name: str,
        arguments: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if tool_name not in AXI_AGENT_MCP_WORKSTATION_SAFE_TOOLS:
            raise AxiAgentMcpClientError(f"Axi Workstation cannot call mutating or unapproved MCP tool: {tool_name}")

        result = self.call_tool(tool_name, arguments or {})
        text = result.get("text", "")
        passed = not text.lstrip().startswith("❌")
        return {
            "source": "axi-agent-mcp",
            "tool": tool_name,
            "passed": passed,
            "text": text,
            "raw_result": result,
        }

    def get_service_summary(self) -> Dict[str, Any]:
        tools_result = self.list_tools()
        tools = tools_result["tools"]
        tool_names = sorted(tool.get("name") for tool in tools if isinstance(tool, dict) and tool.get("name"))
        missing_required = sorted(AXI_AGENT_MCP_REQUIRED_TOOLS - set(tool_names))
        missing_mutating = sorted(AXI_AGENT_MCP_MUTATING_TOOLS - set(tool_names))
        return {
            "service": "axi-agent-mcp",
            "command": self.command_line,
            "cwd": str(self.cwd),
            "tool_count": len(tool_names),
            "required_tools_present": not missing_required,
            "missing_required_tools": missing_required,
            "mutating_tools": sorted(AXI_AGENT_MCP_MUTATING_TOOLS),
            "missing_mutating_tools": missing_mutating,
        }

    def _request_mcp(self, request: Dict[str, Any]) -> Dict[str, Any]:
        if not self.cwd.exists():
            raise AxiAgentMcpClientError(f"Axi Agent MCP cwd does not exist: {self.cwd}")

        process = subprocess.Popen(
            self.command_line,
            cwd=self.cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=self._service_env(),
        )
        try:
            initialize = self._send_request(
                process,
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": self.protocol_version,
                        "capabilities": {},
                        "clientInfo": {
                            "name": "axi-agent-platform",
                            "version": settings.APP_VERSION,
                        },
                    },
                },
            )
            server_info = initialize.get("serverInfo", {})
            if server_info.get("name") != "axi-agent-mcp":
                raise AxiAgentMcpClientError(f"Unexpected MCP server: {server_info!r}")

            self._write_json(
                process,
                {
                    "jsonrpc": "2.0",
                    "method": "notifications/initialized",
                    "params": {},
                },
            )
            return self._send_request(process, request)
        finally:
            self._stop_process(process)

    def _service_env(self) -> Dict[str, str]:
        env = os.environ.copy()
        env.setdefault("NO_COLOR", "1")
        return env

    def _send_request(self, process: subprocess.Popen, payload: Dict[str, Any]) -> Dict[str, Any]:
        self._write_json(process, payload)
        response = self._read_json(process)
        if "error" in response:
            raise AxiAgentMcpClientError(f"Axi Agent MCP request failed: {response['error']}")
        result = response.get("result")
        if not isinstance(result, dict):
            raise AxiAgentMcpClientError(f"Axi Agent MCP response missing result: {response!r}")
        return result

    def _write_json(self, process: subprocess.Popen, payload: Dict[str, Any]) -> None:
        if process.stdin is None:
            raise AxiAgentMcpClientError("Axi Agent MCP stdin is unavailable")
        process.stdin.write(json.dumps(payload) + "\n")
        process.stdin.flush()

    def _read_json(self, process: subprocess.Popen) -> Dict[str, Any]:
        if process.stdout is None:
            raise AxiAgentMcpClientError("Axi Agent MCP stdout is unavailable")
        line = self._readline_with_timeout(process.stdout)
        if not line:
            stderr = self._safe_read_stderr(process)
            raise AxiAgentMcpClientError(f"Axi Agent MCP closed stdout before response: {stderr}")
        try:
            return json.loads(line)
        except json.JSONDecodeError as exc:
            raise AxiAgentMcpClientError(f"Axi Agent MCP returned non-JSON stdout: {line!r}") from exc

    def _readline_with_timeout(self, pipe) -> str:
        result_queue: "queue.Queue[str]" = queue.Queue(maxsize=1)

        def read_line() -> None:
            result_queue.put(pipe.readline())

        reader = threading.Thread(target=read_line, daemon=True)
        reader.start()
        try:
            return result_queue.get(timeout=self.timeout_seconds)
        except queue.Empty as exc:
            raise AxiAgentMcpClientError("Timed out waiting for Axi Agent MCP response") from exc

    def _safe_read_stderr(self, process: subprocess.Popen) -> str:
        if process.stderr is None:
            return ""
        if process.poll() is None:
            return ""
        try:
            return process.stderr.read(2000)
        except Exception:
            return ""

    def _stop_process(self, process: subprocess.Popen) -> None:
        if process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=1)
