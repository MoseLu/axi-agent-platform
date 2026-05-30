# Evidence

## 2026-04-28
- Migrated source to `/Volumes/code/workspace/projects/axi-agent-platform/infra/codex-remote-bridge`.
- Verified sidecar tests before migration:
  `node --test sidecar/codex-remote-bridge/test/*.test.mjs` passed with 8 tests.
- Verified sidecar tests after migration from the new project root:
  `node --test test/*.test.mjs` passed with 8 tests.
- Verified syntax checks after migration:
  `node --check bin/codex-remote-bridge-manager.mjs` and
  `node --check lib/runtime.mjs` passed.
- Refreshed the installed package from the new project root with:
  `node bin/codex-remote-bridge-manager.mjs install --no-start`.
- Verified Rust built-in bridge compatibility before migration:
  `cargo test --manifest-path src-tauri/Cargo.toml codex_remote_bridge --lib`
  passed with 14 tests.
- Verified frontend typecheck before migration:
  `npm run typecheck` passed.
- Verified installed sidecar status from
  `~/.antigravity_cockpit/packages/codex-remote-bridge/current/bin/codex-remote-bridge-manager.mjs`.
- Verified Codex App session discovery from `state_5.sqlite`:
  `node --test test/*.test.mjs` passed with 23 tests.
- Verified local project list now reports `ielts-vocab` and `cockpit-tools`
  with Codex App session titles from `state_5.sqlite`.
- Refreshed and restarted the installed launchd sidecar:
  `node bin/codex-remote-bridge-manager.mjs install --no-start` and
  `node bin/codex-remote-bridge-manager.mjs restart`.
- Verified Hermes gateway patch syntax locally and remotely:
  `python3 -m py_compile /tmp/hermes-codex-edit/gateway/codex_bridge.py` and
  `/root/.hermes/core/venv/bin/python3 -m py_compile gateway/codex_bridge.py`.
- Restarted `hermes-gateway.service` and confirmed `systemctl is-active`
  returned `active`.
- ADB real-device test was not run because `adb devices` returned no attached
  devices.
- Real-device WeCom test later found `projects.list` timed out because sidecar
  list responses did not echo Hermes `request_id`; fixed in `lib/runtime.mjs`.
- Real-device WeCom guided flow passed:
  `projects` -> reply `1` for `ielts-vocab` -> reply `1` for the
  `远程的艾宾浩斯统计按照当前00:00计算吗` session -> `current session`.
- Bound-session smoke passed through Codex App resume:
  job `codex_1777392986_ac0ccf`, account `codex_app_session`, reply
  `mobile-bound-ok`, no file-edit task requested.
