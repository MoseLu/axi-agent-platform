# Codex Session

## Current State
- Project migrated to `/Volumes/code/workspace/projects/axi-agent-platform/infra/codex-remote-bridge`.
- Source was moved out of `/Volumes/code/workspace/references/cockpit-tools/sidecar/`.
- Installed runtime remains at
  `~/.antigravity_cockpit/packages/codex-remote-bridge/current/`.
- Sidecar is installed, running under launchd, and connected to Hermes.
- Mobile project/session discovery now reads Codex App `state_5.sqlite`, so the
  WeCom list matches desktop Codex App projects such as `ielts-vocab` and
  `cockpit-tools`.
- Hermes keeps per-conversation selection state in SQLite: projects list,
  project choice, session list, session choice, then bound Codex App session.
- Real-device WeCom test bound `LuAoHua` to the `ielts-vocab` session
  `远程的艾宾浩斯统计按照当前00:00计算吗`; subsequent mobile messages resume
  that Codex App session.

## Continue From Here
- Open future Codex sessions in `/Volumes/code/workspace/projects/axi-agent-platform/infra/codex-remote-bridge`.
- Use `node --test test/*.test.mjs` as the first verification command.
- Use `node bin/codex-remote-bridge-manager.mjs install --no-start` and then
  `node bin/codex-remote-bridge-manager.mjs restart` for local package refreshes.
