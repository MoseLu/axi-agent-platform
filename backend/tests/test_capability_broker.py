"""Tests for ``app.core.capability_broker``.

Coverage:

* ``compute_action_digest`` is deterministic, length-64 hex, and includes
  the tool id (so it differs from a bare ``sha256(json.dumps(params))``).
* ``issue`` rejects unknown tools, quarantined tools, and duplicate
  idempotency keys.
* ``consume`` rejects wrong ``action_digest``, wrong ``target``, expired
  capabilities, exhausted capabilities, and revoked capabilities.
* ``default_manifest`` includes every built-in tool id read from
  ``backend/app/tools/builtin/__init__.py``.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone

import pytest

from app.core.capability_broker import (
    ActionDigestMismatchError,
    Capability,
    CapabilityBroker,
    CapabilityExhaustedError,
    ExpiredCapabilityError,
    QuarantinedToolError,
    ReplayIdempotencyKeyError,
    TargetMismatchError,
    ToolManifest,
    ToolManifestEntry,
    UnknownToolError,
)


# ---------- fixtures ----------


@pytest.fixture
def manifest() -> ToolManifest:
    """Small manifest for unit tests."""
    return ToolManifest(
        manifest_id="test-2026-09-29",
        issued_at=datetime.now(timezone.utc),
        tools={
            "read_file": ToolManifestEntry(
                tool_id="read_file", danger_level="read", side_effects=[]
            ),
            "write_file": ToolManifestEntry(
                tool_id="write_file",
                danger_level="local_write",
                side_effects=["writes_filesystem"],
            ),
            "destructive_drop_table": ToolManifestEntry(
                tool_id="destructive_drop_table",
                danger_level="destructive",
                side_effects=["drops_table"],
            ),
        },
        quarantine=["legacy_uncaught_tool"],
    )


@pytest.fixture
def broker(manifest: ToolManifest) -> CapabilityBroker:
    return CapabilityBroker(manifest)


def _seed_cap(
    broker: CapabilityBroker,
    *,
    tool: str = "write_file",
    action_digest: str | None = None,
    target: str = "/tmp/foo.txt",
    subject: str = "agent-1",
    plan_digest: str = "plan-deadbeef" + "0" * 56,
) -> Capability:
    if action_digest is None:
        action_digest = CapabilityBroker.compute_action_digest(tool, {"path": target, "content": "x"})
    return broker.issue(
        subject=subject,
        tool=tool,
        plan_digest=plan_digest,
        action_digest=action_digest,
        allowed_target=target,
        idempotency_key=None,
        ttl_seconds=300,
    )


# ---------- compute_action_digest ----------


def test_compute_action_digest_is_deterministic():
    a = CapabilityBroker.compute_action_digest(
        "write_file", {"path": "/tmp/a.txt", "content": "hello"}
    )
    b = CapabilityBroker.compute_action_digest(
        "write_file", {"path": "/tmp/a.txt", "content": "hello"}
    )
    assert a == b


def test_compute_action_digest_is_length_64_hex():
    d = CapabilityBroker.compute_action_digest("read_file", {"path": "/etc/hosts"})
    assert len(d) == 64
    int(d, 16)  # must parse as hex


def test_compute_action_digest_includes_tool_id():
    """The digest MUST bind to the tool id; the same parameters under a
    different tool id MUST produce a different digest."""
    params = {"path": "/tmp/a.txt", "content": "hello"}
    a = CapabilityBroker.compute_action_digest("write_file", params)
    b = CapabilityBroker.compute_action_digest("read_file", params)
    assert a != b
    # And it must differ from a bare ``sha256(json.dumps(...))`` because of
    # the leading tool-name separator.
    bare = hashlib.sha256(json.dumps(params, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    assert a != bare


# ---------- issue ----------


def test_issue_rejects_unknown_tool(broker: CapabilityBroker):
    with pytest.raises(UnknownToolError):
        broker.issue(
            subject="agent-1",
            tool="not_in_manifest",
            plan_digest="p" * 64,
            action_digest="a" * 64,
            allowed_target="x",
        )


def test_issue_rejects_quarantined_tool(broker: CapabilityBroker):
    with pytest.raises(QuarantinedToolError):
        broker.issue(
            subject="agent-1",
            tool="legacy_uncaught_tool",
            plan_digest="p" * 64,
            action_digest="a" * 64,
            allowed_target="x",
        )


def test_issue_rejects_duplicate_idempotency_key(broker: CapabilityBroker):
    target = "/tmp/a.txt"
    action_digest = CapabilityBroker.compute_action_digest(
        "write_file", {"path": target, "content": "x"}
    )
    broker.issue(
        subject="agent-1",
        tool="write_file",
        plan_digest="p" * 64,
        action_digest=action_digest,
        allowed_target=target,
        idempotency_key="idem-1234567890",
    )
    with pytest.raises(ReplayIdempotencyKeyError):
        broker.issue(
            subject="agent-1",
            tool="write_file",
            plan_digest="p" * 64,
            action_digest=action_digest,
            allowed_target=target,
            idempotency_key="idem-1234567890",
        )


def test_issue_sets_max_uses_to_one(broker: CapabilityBroker):
    cap = _seed_cap(broker)
    assert cap.max_uses == 1


# ---------- consume ----------


def test_consume_rejects_wrong_action_digest(broker: CapabilityBroker):
    cap = _seed_cap(broker)
    with pytest.raises(ActionDigestMismatchError):
        broker.consume(
            cap.capability_id, action_digest="0" * 64, target="/tmp/foo.txt"
        )


def test_consume_rejects_wrong_target(broker: CapabilityBroker):
    cap = _seed_cap(broker)
    target = "/tmp/foo.txt"
    action_digest = CapabilityBroker.compute_action_digest(
        "write_file", {"path": target, "content": "x"}
    )
    with pytest.raises(TargetMismatchError):
        broker.consume(
            cap.capability_id, action_digest=action_digest, target="/tmp/bar.txt"
        )


def test_consume_rejects_expired_capability(broker: CapabilityBroker):
    """Manually inject an already-expired capability into the broker."""
    target = "/tmp/foo.txt"
    action_digest = CapabilityBroker.compute_action_digest(
        "write_file", {"path": target, "content": "x"}
    )
    cap = broker.issue(
        subject="agent-1",
        tool="write_file",
        plan_digest="p" * 64,
        action_digest=action_digest,
        allowed_target=target,
        idempotency_key="idem-expired-test",
        ttl_seconds=1,
    )
    # Fast-forward the clock by mutating the capability directly.
    cap.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    with pytest.raises(ExpiredCapabilityError):
        broker.consume(
            cap.capability_id, action_digest=action_digest, target=target
        )


def test_consume_rejects_exhausted_capability(broker: CapabilityBroker):
    target = "/tmp/foo.txt"
    action_digest = CapabilityBroker.compute_action_digest(
        "write_file", {"path": target, "content": "x"}
    )
    cap = broker.issue(
        subject="agent-1",
        tool="write_file",
        plan_digest="p" * 64,
        action_digest=action_digest,
        allowed_target=target,
        idempotency_key="idem-exhausted-test",
    )
    # First consume succeeds.
    broker.consume(cap.capability_id, action_digest=action_digest, target=target)
    # Second consume must be rejected because max_uses=1.
    with pytest.raises(CapabilityExhaustedError):
        broker.consume(cap.capability_id, action_digest=action_digest, target=target)


def test_consume_rejects_revoked_capability(broker: CapabilityBroker):
    cap = _seed_cap(broker)
    target = "/tmp/foo.txt"
    action_digest = CapabilityBroker.compute_action_digest(
        "write_file", {"path": target, "content": "x"}
    )
    broker.revoke(cap.capability_id, reason="test")
    with pytest.raises(Exception) as excinfo:
        broker.consume(cap.capability_id, action_digest=action_digest, target=target)
    # Revoked surfaces as the base CapabilityError, not a narrower type.
    assert "revoked" in str(excinfo.value).lower()


# ---------- default manifest ----------


def test_default_manifest_contains_every_builtin_tool():
    """The default manifest MUST list every tool id from
    ``backend/app/tools/builtin/__init__.py``. If a built-in tool is added
    without updating the broker, the runtime would silently allow it
    without server-side enforcement; this test guards that."""
    from app.tools.builtin import get_builtin_tools

    expected = {tool.id for tool in get_builtin_tools()}
    manifest = CapabilityBroker.default_manifest()
    actual = set(manifest.tools.keys())
    missing = expected - actual
    assert not missing, (
        f"default_manifest() is missing built-in tools: {sorted(missing)}. "
        f"Update CapabilityBroker.default_manifest() in lockstep with "
        f"app/tools/builtin/__init__.py."
    )


def test_default_manifest_is_quarantine_free():
    manifest = CapabilityBroker.default_manifest()
    assert manifest.quarantine == []


# ---------- roundtrip ----------


def test_issue_then_consume_roundtrip(broker: CapabilityBroker):
    target = "/tmp/foo.txt"
    action_digest = CapabilityBroker.compute_action_digest(
        "write_file", {"path": target, "content": "x"}
    )
    cap = broker.issue(
        subject="agent-1",
        tool="write_file",
        plan_digest="p" * 64,
        action_digest=action_digest,
        allowed_target=target,
    )
    returned = broker.consume(cap.capability_id, action_digest=action_digest, target=target)
    assert returned.capability_id == cap.capability_id
    assert returned.uses == 1