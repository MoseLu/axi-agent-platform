"""Runtime singleton accessor for the ``CapabilityBroker``.

The broker is process-global because every component that wants to
``issue`` or ``consume`` a capability must agree on the same store;
otherwise the capability_id issued by one component cannot be redeemed
by another. ``get_runtime_broker`` lazily builds the default manifest
on first access.

Tests use ``reset_runtime_broker_for_tests`` to drop the singleton so
each test gets a clean ledger; production code MUST NOT call the reset.
"""
from __future__ import annotations

from typing import Optional

from app.core.capability_broker import CapabilityBroker, ToolManifest


_runtime_broker: Optional[CapabilityBroker] = None


def get_runtime_broker() -> CapabilityBroker:
    """Return the process-global broker, building the default manifest on first call."""
    global _runtime_broker
    if _runtime_broker is None:
        manifest = CapabilityBroker.default_manifest()
        _runtime_broker = CapabilityBroker(manifest)
    return _runtime_broker


def set_runtime_broker(broker: CapabilityBroker) -> None:
    """Inject a broker (used by tests that want a custom manifest).

    Production code should call ``get_runtime_broker`` once and reuse
    the singleton; this setter exists so tests can inject a deterministic
    manifest without relying on import-time state."""
    global _runtime_broker
    _runtime_broker = broker


def reset_runtime_broker_for_tests() -> None:
    """Drop the singleton. Tests only; production callers MUST NOT use this."""
    global _runtime_broker
    _runtime_broker = None


__all__ = [
    "get_runtime_broker",
    "set_runtime_broker",
    "reset_runtime_broker_for_tests",
]