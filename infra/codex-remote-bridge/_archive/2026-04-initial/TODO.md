# TODO

## Ready
- [ ] Add a fake Hermes WebSocket integration test for register, heartbeat,
      status, accounts, projects, and job failure paths.
- [ ] Add a fake `codex` binary integration test for successful `job.start`
      without invoking the real Codex CLI.
- [ ] Add release manifest verification before remote sidecar updates.
- [ ] Add a concise WeCom artifact contract for screenshots and Markdown
      documents.

## Done
- [x] Echo Hermes `request_id` in sidecar status/accounts/projects/session
      list responses so gateway request waiters can resolve.
- [x] Read Codex App `state_5.sqlite` so mobile project/session lists match
      the desktop Codex App.
- [x] Group Codex App sessions under `/Volumes/code/workspace/*` projects for
      guided WeCom selection.
- [x] Deploy Hermes mobile selection state for project -> session -> bound
      Codex App continuation.
- [x] Split the bridge into a standalone sidecar package.
- [x] Install sidecar outside the Cockpit Tools app bundle.
- [x] Add launchd management commands.
- [x] Add sidecar status file and separate logs.
- [x] Add built-in Cockpit bridge retreat logic when sidecar is installed.
