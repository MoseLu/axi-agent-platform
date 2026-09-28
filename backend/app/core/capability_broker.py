"""Server-side enforcement primitive for side-effect tool calls.

The ``CapabilityBroker`` replaces the current "Agent calls ``ToolManager.execute_tool``
or ``AxiAgentMcpClient.call_tool`` with an arbitrary tool name" pattern with a
server-side capability check: a one-shot, action-digest-bound, TTL-bounded
``Capability`` MUST be presented at the call boundary, or the call fails with
a typed exception. The motivation is the agent-governance principle that
"没有 Capability 的工具调用必须在服务端失败" — the check MUST live in the
server's call path, not in the Agent prompt or the client.

This module ships only the primitives:

* ``ToolManifest`` / ``ToolManifestEntry`` — what tools exist and how
  dangerous each one is.
* ``Capability`` — the issued ticket.
* ``CapabilityBroker.issue`` — gate against the manifest and produce a
  ``Capability``.
* ``CapabilityBroker.consume`` — verify a ``Capability`` and atomically
  consume one of its ``max_uses`` slots.
* ``CapabilityBroker.compute_action_digest`` — canonical SHA-256 of a
  ``(tool, parameters)`` pair, the binding that prevents a re-issued
  capability from being used against a different action.

Wiring ``ToolManager.execute_tool`` / ``AxiAgentMcpClient.call_tool`` to
require a ``Capability`` at the boundary is deferred to commit 4 of
agent-governance Phase 1.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional


# ---------- exception hierarchy ----------

class CapabilityError(Exception):
    """Base class for all capability-broker errors. Callers MUST catch this
    before any narrower exception type so the wire protocol stays stable."""


class UnknownToolError(CapabilityError):
    """The tool id is not in the manifest. Always a hard deny."""


class QuarantinedToolError(CapabilityError):
    """The tool id is in ``manifest.quarantine``: deliberately not migrated
    into the Broker. Any ``issue`` call against it MUST fail closed."""


class ExpiredCapabilityError(CapabilityError):
    """``now > capability.expires_at``. The holder MUST re-issue."""


class ReplayIdempotencyKeyError(CapabilityError):
    """The idempotency key has already been redeemed. Treat as a replay
    attack and refuse the new ``issue``."""


class ActionDigestMismatchError(CapabilityError):
    """The holder's ``action_digest`` does not match the digest the caller
    produced from the live ``(tool, parameters)`` payload. The capability
    was issued for a different action."""


class TargetMismatchError(CapabilityError):
    """The caller is targeting a different file/branch/URL than the one the
    capability was scoped to. Capability is not transferable."""


class CapabilityExhaustedError(CapabilityError):
    """``uses >= max_uses``. The one-shot budget is spent."""


# ---------- data classes ----------

@dataclass
class Capability:
    """A one-shot capability ticket.

    ``max_uses`` is intentionally a mutable constructor argument but in
    practice MUST stay at 1 — every consumer in this commit enforces it.
    """

    capability_id: str
    tool: str
    subject: str
    plan_digest: str
    action_digest: str
    allowed_target: str
    issued_at: datetime
    expires_at: datetime
    max_uses: int = 1
    uses: int = 0
    revoked: bool = False

    def to_dict(self) -> dict:
        return {
            "capabilityId": self.capability_id,
            "tool": self.tool,
            "subject": self.subject,
            "planDigest": self.plan_digest,
            "actionDigest": self.action_digest,
            "allowedTarget": self.allowed_target,
            "issuedAt": self.issued_at.isoformat(),
            "expiresAt": self.expires_at.isoformat(),
            "maxUses": self.max_uses,
            "uses": self.uses,
            "revoked": self.revoked,
        }


@dataclass
class ToolManifestEntry:
    """One row in the manifest: declares the danger level, side effects,
    and required scopes for a tool id."""

    tool_id: str
    danger_level: str  # read / local_write / git / external_message / deploy / permission_elevation / destructive
    side_effects: List[str] = field(default_factory=list)
    required_scopes: List[str] = field(default_factory=list)


@dataclass
class ToolManifest:
    """The full set of tools the Broker can issue capabilities for.

    ``quarantine`` is the list of tool ids that callers must NOT be able to
    invoke through the Broker. They live in the manifest so ``UnknownToolError``
    doesn't catch them (which would silently regress the legacy fallback
    behavior); ``QuarantinedToolError`` is reserved for them."""

    manifest_id: str
    issued_at: datetime
    tools: Dict[str, ToolManifestEntry]
    quarantine: List[str] = field(default_factory=list)


# ---------- broker ----------

class CapabilityBroker:
    """The server-side gate for side-effect tool calls."""

    DEFAULT_TTL_SECONDS = 300

    def __init__(self, manifest: ToolManifest):
        self.manifest = manifest
        self._caps: Dict[str, Capability] = {}
        # idempotency_key -> capability_id (the one issued for that key).
        self._idempotency_keys: Dict[str, str] = {}

    # --- issuance ---

    def issue(
        self,
        *,
        subject: str,
        tool: str,
        plan_digest: str,
        action_digest: str,
        allowed_target: str,
        idempotency_key: Optional[str] = None,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
    ) -> Capability:
        """Issue a one-shot capability. Validates against the manifest first."""
        if tool in self.manifest.quarantine:
            raise QuarantinedToolError(f"tool {tool!r} is quarantined; not migrated")
        if tool not in self.manifest.tools:
            raise UnknownToolError(f"tool {tool!r} not in manifest")
        if idempotency_key is not None:
            if idempotency_key in self._idempotency_keys:
                raise ReplayIdempotencyKeyError(
                    f"idempotency_key {idempotency_key!r} already issued as capability "
                    f"{self._idempotency_keys[idempotency_key]!r}"
                )
        capability_id = self._compute_capability_id(
            subject, tool, plan_digest, action_digest, allowed_target
        )
        now = datetime.now(timezone.utc)
        cap = Capability(
            capability_id=capability_id,
            tool=tool,
            subject=subject,
            plan_digest=plan_digest,
            action_digest=action_digest,
            allowed_target=allowed_target,
            issued_at=now,
            expires_at=now + timedelta(seconds=ttl_seconds),
            max_uses=1,
        )
        self._caps[capability_id] = cap
        if idempotency_key is not None:
            self._idempotency_keys[idempotency_key] = capability_id
        return cap

    # --- consumption ---

    def consume(
        self,
        capability_id: str,
        *,
        action_digest: str,
        target: str,
    ) -> Capability:
        """Consume a capability. Validates expiry, target, action_digest, and uses."""
        cap = self._caps.get(capability_id)
        if cap is None:
            raise UnknownToolError(f"unknown capability {capability_id!r}")
        now = datetime.now(timezone.utc)
        if cap.revoked:
            raise CapabilityError(f"capability {capability_id!r} revoked")
        if now > cap.expires_at:
            raise ExpiredCapabilityError(
                f"capability {capability_id!r} expired at {cap.expires_at.isoformat()}"
            )
        if cap.action_digest != action_digest:
            raise ActionDigestMismatchError(
                f"action_digest mismatch: holder {cap.action_digest!r} vs caller {action_digest!r}"
            )
        if cap.allowed_target != target:
            raise TargetMismatchError(
                f"target mismatch: holder {cap.allowed_target!r} vs caller {target!r}"
            )
        if cap.uses >= cap.max_uses:
            raise CapabilityExhaustedError(
                f"capability {capability_id!r} exhausted (uses={cap.uses} >= max_uses={cap.max_uses})"
            )
        cap.uses += 1
        return cap

    def revoke(self, capability_id: str, reason: str) -> None:
        """Revoke a capability; future consume calls MUST fail.

        ``reason`` is currently kept on the call for the audit-log contract;
        the Broker does not persist it."""
        cap = self._caps.get(capability_id)
        if cap is not None:
            cap.revoked = True

    # --- diagnostics ---

    def has_capability(self, capability_id: str) -> bool:
        return capability_id in self._caps

    def get_capability(self, capability_id: str) -> Optional[Capability]:
        return self._caps.get(capability_id)

    # --- helpers ---

    @staticmethod
    def compute_action_digest(tool: str, parameters: dict) -> str:
        """Canonical SHA-256 of a ``(tool, parameters)`` action.

        NOT interchangeable with ``sha256(json.dumps(parameters))``: this
        digest includes the tool id and uses ``\\x00`` as a separator so a
        parameter dict that happens to contain the tool id as a key cannot
        collide with another tool's digest."""
        canonical = json.dumps(parameters, sort_keys=True, separators=(",", ":"))
        h = hashlib.sha256()
        h.update(tool.encode("utf-8"))
        h.update(b"\x00")
        h.update(canonical.encode("utf-8"))
        return h.hexdigest()

    @staticmethod
    def _compute_capability_id(
        subject: str,
        tool: str,
        plan_digest: str,
        action_digest: str,
        allowed_target: str,
    ) -> str:
        h = hashlib.sha256()
        for part in (subject, tool, plan_digest, action_digest, allowed_target):
            h.update(part.encode("utf-8"))
            h.update(b"\x00")
        return h.hexdigest()

    # --- default manifest ---

    @classmethod
    def default_manifest(cls) -> ToolManifest:
        """Built-in manifest covering every tool id reachable from any
        current call site. This list MUST stay in sync with the union of
        ``backend/app/tools/builtin/__init__.py`` and the MCP tools registered
        in ``infra/axi-agent-mcp/src/index.ts``; the broker refuses to issue
        a capability for any tool not listed here.

        Danger levels follow the agent-governance taxonomy:

        * ``read`` — non-mutating, safe to allow under any route.
        * ``local_write`` — mutates local filesystem, no remote effect.
        * ``git`` — creates commits / branches; reversible but loud.
        * ``external_message`` — emits to a remote service (chat, search,
          embedding store, etc.); not deployable but may be costly.
        * ``deploy`` — would push artifacts to a deploy target. (Not
          currently exposed; reserved for future migration.)
        * ``permission_elevation`` — would change credentials / scopes.
        * ``destructive`` — irreversible, including workspace-wide deletes
          and force-push.
        """
        def entry(tool_id: str, danger: str, side_effects: List[str]) -> ToolManifestEntry:
            return ToolManifestEntry(
                tool_id=tool_id,
                danger_level=danger,
                side_effects=side_effects,
                required_scopes=[],
            )

        tools: Dict[str, ToolManifestEntry] = {}

        # --- built-in tools (backend/app/tools/builtin/__init__.py) ---
        tools["search_web"] = entry(
            "search_web",
            "external_message",
            ["calls_search_api", "network_egress"],
        )
        tools["read_file"] = entry(
            "read_file", "read", ["reads_filesystem"]
        )
        tools["write_file"] = entry(
            "write_file", "local_write", ["writes_filesystem"]
        )
        tools["calculate"] = entry(
            "calculate", "read", ["evaluates_expression"]
        )
        tools["run_python"] = entry(
            "run_python", "local_write", ["spawns_subprocess", "writes_tempfile"]
        )
        tools["parse_json"] = entry(
            "parse_json", "read", ["evaluates_json"]
        )
        tools["parse_csv"] = entry(
            "parse_csv", "read", ["evaluates_csv"]
        )

        # --- MCP read-only tools (axi_agent_mcp_client.AXI_AGENT_MCP_REQUIRED_TOOLS) ---
        tools["swarm_chat"] = entry(
            "swarm_chat", "external_message", ["calls_model_api", "consumes_budget"]
        )
        tools["swarm_chat_with_model"] = entry(
            "swarm_chat_with_model", "external_message", ["calls_model_api", "consumes_budget"]
        )
        tools["swarm_analyze_task"] = entry(
            "swarm_analyze_task", "external_message", ["calls_model_api"]
        )
        tools["swarm_validate_with_gates"] = entry(
            "swarm_validate_with_gates", "read", ["runs_quality_gates"]
        )
        tools["swarm_git_status"] = entry(
            "swarm_git_status", "read", ["reads_git_state"]
        )
        tools["swarm_run_test"] = entry(
            "swarm_run_test", "external_message", ["spawns_subprocess"]
        )

        # --- MCP mutating tools (AXI_AGENT_MCP_MUTATING_TOOLS) ---
        tools["swarm_write_file"] = entry(
            "swarm_write_file", "local_write", ["writes_filesystem"]
        )
        tools["swarm_modify_file"] = entry(
            "swarm_modify_file", "local_write", ["writes_filesystem"]
        )
        tools["swarm_git_commit"] = entry(
            "swarm_git_commit", "git", ["creates_git_commit"]
        )
        tools["swarm_git_create_branch"] = entry(
            "swarm_git_create_branch", "git", ["creates_git_branch"]
        )
        tools["swarm_autofix_lint"] = entry(
            "swarm_autofix_lint", "local_write", ["writes_filesystem"]
        )
        tools["swarm_vector_upsert"] = entry(
            "swarm_vector_upsert", "external_message", ["writes_vector_store"]
        )

        # --- additional MCP tools discovered in infra/axi-agent-mcp/src/index.ts
        # that the Agent runtime MAY reach via the broader ``call_tool``
        # surface. The broker enforces a closed-world posture: any tool id
        # not in this list raises ``UnknownToolError``. Read-only by default. ---
        read_only_extras = [
            "swarm_get_stats",
            "swarm_reset_circuit_breaker",
            "swarm_get_metrics",
            "swarm_get_logs",
            "swarm_execute_workflow",
            "swarm_list_workflows",
            "swarm_validate_workflow",
            "swarm_read_file",
            "swarm_list_directory",
            "swarm_search_files",
            "swarm_search_code",
            "swarm_build_index",
            "swarm_analyze_workspace",
            "swarm_detect_tech_stack",
            "swarm_generate_mr_description",
            "swarm_run_lint",
            "swarm_get_lock_stats",
            "swarm_list_agents",
            "swarm_recommend_agent",
            "swarm_create_dynamic_agents",
            "swarm_execute_swarm",
            "swarm_generate_agent_roles",
            "swarm_list_workflow_catalog",
            "swarm_recommend_workflow",
            "swarm_list_skills",
            "swarm_execute_skill",
            "swarm_list_gates",
            "swarm_db_stats",
            "swarm_vector_search",
            "swarm_cache_stats",
            "swarm_code_stats",
        ]
        for tool_id in read_only_extras:
            tools[tool_id] = entry(tool_id, "read", ["reads_service_state"])

        return ToolManifest(
            manifest_id="builtin-2026-09-29",
            issued_at=datetime.now(timezone.utc),
            tools=tools,
            quarantine=[],
        )


__all__ = [
    "CapabilityError",
    "UnknownToolError",
    "QuarantinedToolError",
    "ExpiredCapabilityError",
    "ReplayIdempotencyKeyError",
    "ActionDigestMismatchError",
    "TargetMismatchError",
    "CapabilityExhaustedError",
    "Capability",
    "ToolManifestEntry",
    "ToolManifest",
    "CapabilityBroker",
]