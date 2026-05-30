# Codex Remote Bridge Sidecar

Independent macOS sidecar for the Hermes / WeCom / Codex bridge.

The package installs outside the Cockpit Tools app bundle:

```text
~/.antigravity_cockpit/packages/codex-remote-bridge/current/
```

It reuses the existing user config:

```text
~/.antigravity_cockpit/codex_remote_bridge.json
```

## Commands

```bash
node bin/codex-remote-bridge-manager.mjs install
node bin/codex-remote-bridge-manager.mjs status
node bin/codex-remote-bridge-manager.mjs restart
node bin/codex-remote-bridge-manager.mjs update
node bin/codex-remote-bridge-manager.mjs uninstall
```

Use `install --no-start` or `update --no-start` when an older Cockpit Tools build is
still running an embedded bridge with the same `clientId`.

Logs are separate from Cockpit Tools:

```text
~/.antigravity_cockpit/logs/codex-remote-bridge.out.log
~/.antigravity_cockpit/logs/codex-remote-bridge.err.log
```

The runtime writes status to:

```text
~/.antigravity_cockpit/codex_remote_bridge_status.json
```
