import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildAccountSwitchProgressPayload,
  createAccountSwitchProgressMonitor,
  readAccountSwitchStatus,
} from "../lib/account-switch-status.mjs";
import { packagePaths } from "../lib/manager-core.mjs";

test("readAccountSwitchStatus reads fresh Cockpit switch evidence", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-switch-status-"));
  const paths = packagePaths(home, "0.1.0");
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.writeFileSync(
    paths.accountSwitchStatusPath,
    JSON.stringify({
      state: "switching",
      trigger: "auto_quota",
      fromAccountId: "codex_old",
      toAccountId: "codex_new",
      reason: "primary_window<=20%",
      startedAt: new Date().toISOString(),
    }),
  );

  const status = readAccountSwitchStatus({ paths, freshMs: 60_000 });

  assert.equal(status.state, "switching");
  assert.equal(status.trigger, "auto_quota");
  assert.equal(status.fromAccountId, "codex_old");
  assert.equal(status.toAccountId, "codex_new");
  assert.equal(status.fresh, true);
});

test("readAccountSwitchStatus falls back to Cockpit app log switch evidence", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-switch-log-"));
  const paths = packagePaths(home, "0.1.0");
  fs.mkdirSync(paths.logsDir, { recursive: true });
  const startedAt = "2026-04-29T03:10:00.100000+08:00";
  const finishedAt = "2026-04-29T03:10:00.900000+08:00";
  fs.writeFileSync(
    path.join(paths.logsDir, "app.log.2026-04-28"),
    [
      `${startedAt}  INFO [Codex切号] 开始切换账号: account_id=codex_log_target, email=lo***g@example.com, target_dir=${home}/.codex`,
      `${finishedAt}  INFO [AutoSwitch][Codex] 自动切号完成: target_id=codex_log_target, email=lo***g@example.com`,
    ].join("\n"),
  );

  const status = readAccountSwitchStatus({
    paths,
    freshMs: 60_000,
    nowMs: Date.parse(finishedAt) + 1000,
  });

  assert.equal(status.state, "succeeded");
  assert.equal(status.trigger, "auto_quota");
  assert.equal(status.toAccountId, "codex_log_target");
  assert.equal(status.startedAt, startedAt);
  assert.equal(status.finishedAt, finishedAt);
  assert.equal(status.reason, "Cockpit Tools app.log");
  assert.equal(status.fresh, true);
});

test("buildAccountSwitchProgressPayload emits compact job.progress messages", () => {
  const payload = buildAccountSwitchProgressPayload("job_switch", {
    state: "switching",
    trigger: "auto_quota",
    fromAccountId: "codex_old",
    toAccountId: "codex_new",
    reason: "primary_window<=20%",
  });

  assert.deepEqual(payload, {
    type: "job.progress",
    job_id: "job_switch",
    state: "account_switching",
    trigger: "auto_quota",
    from_account_id: "codex_old",
    to_account_id: "codex_new",
    reason: "primary_window<=20%",
    recoverable: true,
  });
});

test("createAccountSwitchProgressMonitor sends progress only when state changes", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-switch-monitor-"));
  const paths = packagePaths(home, "0.1.0");
  fs.mkdirSync(paths.dataDir, { recursive: true });
  const sent = [];
  const controller = new AbortController();

  const monitor = createAccountSwitchProgressMonitor({
    paths,
    jobId: "job_monitor",
    intervalMs: 10,
    freshMs: 60_000,
    signal: controller.signal,
    send: (payload) => sent.push(payload),
  });

  fs.writeFileSync(
    paths.accountSwitchStatusPath,
    JSON.stringify({
      state: "switching",
      trigger: "auto_quota",
      fromAccountId: "codex_old",
      toAccountId: "codex_new",
      startedAt: new Date().toISOString(),
    }),
  );
  await waitFor(() => sent.length === 1);
  assert.equal(sent[0].state, "account_switching");

  fs.writeFileSync(
    paths.accountSwitchStatusPath,
    JSON.stringify({
      state: "succeeded",
      trigger: "auto_quota",
      fromAccountId: "codex_old",
      toAccountId: "codex_new",
      startedAt: new Date(Date.now() - 1500).toISOString(),
      finishedAt: new Date().toISOString(),
    }),
  );
  await waitFor(() => sent.length === 2);
  assert.equal(sent[1].state, "account_switched");

  await delay(40);
  assert.equal(sent.length, 2);
  controller.abort();
  await monitor.done;
});

async function waitFor(predicate, timeoutMs = 500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) {
      return;
    }
    await delay(10);
  }
  assert.fail("condition not met before timeout");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
