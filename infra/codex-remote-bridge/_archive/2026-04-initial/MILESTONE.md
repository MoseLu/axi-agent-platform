# MILESTONE

## 0.1.0 - Local Sidecar Baseline
- Standalone Node ESM runtime with no npm runtime dependency.
- macOS launchd management through `codex-remote-bridge-manager.mjs`.
- Existing bridge config compatibility plus `runtimeMode`, auto-update flag, and
  update channel fields.
- Per-account managed Codex homes to avoid changing desktop login state.
- Basic project and account listing for Hermes control messages.
- Local install/update/status/uninstall workflow.

## Next
- Fake-Hermes integration coverage.
- Fake-Codex execution coverage.
- Remote update manifest and checksum verification.
- Production start after old embedded bridge is no longer connected.
