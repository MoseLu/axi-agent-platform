# Project Notes

## Scope
- This repository owns the standalone `codex-remote-bridge` sidecar.
- The sidecar runs outside the Cockpit Tools app bundle and is installed under:
  `~/.antigravity_cockpit/packages/codex-remote-bridge/current/`.
- Cockpit Tools may expose UI or a built-in fallback, but this project is the
  durable runtime source for Hermes / WeCom / Codex bridge work.

## Boundaries
- Do not write into `/Applications/Cockpit Tools.app` from this project.
- Do not log bridge tokens, Codex OAuth tokens, API keys, or Authorization
  headers.
- Keep user configuration in:
  `~/.antigravity_cockpit/codex_remote_bridge.json`.
- Keep runtime status in:
  `~/.antigravity_cockpit/codex_remote_bridge_status.json`.
- Keep logs separate from Cockpit Tools app logs:
  `~/.antigravity_cockpit/logs/codex-remote-bridge.*.log`.

## Verification
- Run `node --test test/*.test.mjs` after code changes.
- Run `node --check bin/codex-remote-bridge-manager.mjs` and
  `node --check lib/runtime.mjs` after script/runtime edits.
- After install/update changes, verify:
  `plutil -lint ~/Library/LaunchAgents/cn.redamancy.codex-remote-bridge.plist`.

## Workflow
- Keep source changes in `/Volumes/code/workspace/projects/axi-agent-platform/infra/codex-remote-bridge`.
- Use `install --no-start` while an older Cockpit Tools build is still running
  an embedded bridge with the same `clientId`.
- Start the sidecar only when duplicate bridge connections are not possible.
