# PRD

## Goal
Provide a durable macOS sidecar that lets Hermes / WeCom submit local Codex jobs
without depending on the Cockpit Tools app bundle.

## Users
- Primary user: local Mac owner managing multiple Codex accounts through
  Cockpit Tools data.
- Upstream system: Hermes gateway that routes mobile WeCom messages.

## Core Requirements
- Reuse `~/.antigravity_cockpit/codex_remote_bridge.json`.
- Connect to Hermes WebSocket with an independent bridge token.
- Select OAuth Plus Codex accounts without changing the desktop Codex login.
- Execute `codex exec` with managed per-account `CODEX_HOME` directories.
- Return concise job summaries rather than raw code dumps.
- Keep launch, status, logs, update, and uninstall independent from Cockpit
  Tools official updates.

## Non-Goals
- No direct modification of the Cockpit Tools app bundle.
- No cloud-side project execution.
- No upload of Codex account tokens to Hermes.
- No Windows/Linux service manager in the first macOS-only phase.
