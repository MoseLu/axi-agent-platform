import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SCRIPT = path.resolve("bin/axi-todo-recheck-completed.mjs");

function makeTask(overrides = {}) {
  return {
    id: "t-" + Math.random().toString(36).slice(2, 10),
    title: "fixture",
    prompt: "x",
    cwd: "/tmp/nowhere-" + Math.random().toString(36).slice(2, 6),
    status: "completed",
    taskKind: "task",
    riskLevel: "medium",
    createdAt: "2026-06-03T22:00:00.000Z",
    updatedAt: "2026-06-03T22:00:00.000Z",
    completedAt: "2026-06-03T22:00:00.000Z",
    verifyCommand: "true",
    verification: { status: "passed", checkedAt: "2026-06-03T22:00:00.000Z" },
    history: [{ event: "completed", at: "2026-06-03T22:00:00.000Z", actor: "system", note: "" }],
    dependsOn: [],
    acceptanceChecks: [],
    auditLevel: "none",
    rejectedApproaches: [],
    ...overrides,
  };
}

async function writeStore(home, tasks) {
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(path.join(home, "tasks.json"), JSON.stringify({ version: 3, tasks }, null, 2));
}

test("recheck dry-run: keep-completed when cwd + VERIFICATION.md + stored passed", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-recheck-keep-"));
  const cwd = path.join(home, "ielts-vocab");
  await fs.mkdir(cwd, { recursive: true });
  await fs.writeFile(path.join(cwd, "VERIFICATION.md"), "# verification");
  const t = makeTask({ cwd, title: "keep-completed fixture" });
  await writeStore(home, [t]);

  const { stdout } = await execFileAsync("node", [SCRIPT], {
    env: { ...process.env, AXI_TODO_HOME: home },
  });
  const report = JSON.parse(stdout);
  assert.equal(report.totalCompleted, 1);
  assert.equal(report.counts["keep-completed"], 1);
  assert.equal(report.decisions[0].decision, "keep-completed");
  // store unchanged
  const store = JSON.parse(await fs.readFile(path.join(home, "tasks.json"), "utf8"));
  assert.equal(store.tasks[0].status, "completed");
});

test("recheck dry-run: cancelled when cwd missing", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-recheck-cancel-"));
  const t = makeTask({ cwd: "/Volumes/code/workspace/products/.worktrees/ielts-vocab-parity-99", title: "cancelled fixture" });
  await writeStore(home, [t]);

  const { stdout } = await execFileAsync("node", [SCRIPT], {
    env: { ...process.env, AXI_TODO_HOME: home },
  });
  const report = JSON.parse(stdout);
  assert.equal(report.counts["cancelled"], 1);
  assert.equal(report.decisions[0].decision, "cancelled");
  // store unchanged
  const store = JSON.parse(await fs.readFile(path.join(home, "tasks.json"), "utf8"));
  assert.equal(store.tasks[0].status, "completed");
});

test("recheck dry-run: awaiting_audit when cwd exists but no VERIFICATION.md and stored passed", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-recheck-awaiting-"));
  const cwd = path.join(home, "axi-skills");
  await fs.mkdir(cwd, { recursive: true });
  // no VERIFICATION.md
  const t = makeTask({ cwd, title: "awaiting_audit fixture" });
  await writeStore(home, [t]);

  const { stdout } = await execFileAsync("node", [SCRIPT], {
    env: { ...process.env, AXI_TODO_HOME: home },
  });
  const report = JSON.parse(stdout);
  assert.equal(report.counts["awaiting_audit"], 1);
  assert.equal(report.decisions[0].decision, "awaiting_audit");
});

test("recheck --apply without --confirm-apply is refused (owner-gated)", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-recheck-refuse-"));
  await writeStore(home, [makeTask()]);

  await assert.rejects(
    execFileAsync("node", [SCRIPT, "--apply"], {
      env: { ...process.env, AXI_TODO_HOME: home },
    }),
    /--confirm-apply/,
  );
});

test("recheck --apply --confirm-apply reclassifies cancelled and writes backup snapshot", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-recheck-apply-"));
  const t = makeTask({ cwd: "/Volumes/code/workspace/products/.worktrees/ielts-vocab-parity-77" });
  await writeStore(home, [t]);

  const { stdout } = await execFileAsync(
    "node",
    [SCRIPT, "--apply", "--confirm-apply"],
    { env: { ...process.env, AXI_TODO_HOME: home } },
  );
  const report = JSON.parse(stdout);
  assert.equal(report.applied, true);
  assert.equal(report.changed, 1);
  assert.ok(report.backupPath.endsWith(".json"));

  // store mutated: status='cancelled', history appended
  const store = JSON.parse(await fs.readFile(path.join(home, "tasks.json"), "utf8"));
  assert.equal(store.tasks[0].status, "cancelled");
  const lastHist = store.tasks[0].history.at(-1);
  assert.equal(lastHist.event, "m5_recheck_cancelled");
  assert.equal(lastHist.actor, "axi-todo-recheck-completed");

  // backup contains original 'completed' status
  const backup = JSON.parse(await fs.readFile(report.backupPath, "utf8"));
  assert.equal(backup.tasks[0].status, "completed");
});

test("recheck --only-decide filter scopes application to chosen decisions", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-recheck-only-"));
  const cwd = path.join(home, "ielts-vocab");
  await fs.mkdir(cwd, { recursive: true });
  await fs.writeFile(path.join(cwd, "VERIFICATION.md"), "# v");
  const keepTask = makeTask({ cwd, title: "keep" });
  const cancelTask = makeTask({ cwd: "/Volumes/code/workspace/products/.worktrees/ielts-vocab-parity-88", title: "cancel" });
  await writeStore(home, [keepTask, cancelTask]);

  const { stdout } = await execFileAsync(
    "node",
    [SCRIPT, "--apply", "--confirm-apply", "--only-decide=cancelled"],
    { env: { ...process.env, AXI_TODO_HOME: home } },
  );
  const report = JSON.parse(stdout);
  assert.equal(report.filteredCount, 1);
  assert.equal(report.changed, 1);

  const store = JSON.parse(await fs.readFile(path.join(home, "tasks.json"), "utf8"));
  const byId = Object.fromEntries(store.tasks.map((t) => [t.title, t]));
  assert.equal(byId.cancel.status, "cancelled");
  // keep-completed task still 'completed' (not in --only-decide scope)
  assert.equal(byId.keep.status, "completed");
  // but should also have history appended? No — keep-completed is NOT in filter
  assert.equal(byId.keep.history.at(-1).event, "completed");
});
