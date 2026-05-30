# TDD

## Current Test Commands

```bash
node --test test/*.test.mjs
node --check bin/codex-remote-bridge-manager.mjs
node --check bin/codex-remote-bridge.mjs
node --check lib/runtime.mjs
```

## Covered Behaviors
- Config normalization keeps existing bridge fields and adds sidecar defaults.
- launchd plist generation points to the installed `current` package.
- Secret redaction hides bridge tokens, Authorization headers, and OAuth tokens.
- Account selection skips API-key accounts and filters by tag/account id.
- Managed `CODEX_HOME` auth writes do not touch desktop `~/.codex`.
- Codex App project roots and session summaries can be listed.

## Manual Checks
- `install --no-start` writes package files and launchd plist.
- `update --no-start` can run from the installed `current` package without
  deleting its own source while updating.
- `status` reports config/runtime state without secrets.
