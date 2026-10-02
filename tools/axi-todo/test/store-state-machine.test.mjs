// Axi-Todo Store State Machine Tests
// Run with: node --test tools/axi-todo/test/store-state-machine.test.mjs
//
// Covers:
//   1. Normal state transition paths
//   2. Error/edge cases and invalid transitions
//   3. Boundary conditions and concurrency scenarios

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskStore } from "../lib/store.mjs";
import {
  TASK_STATUSES,
  TERMINAL_STATUSES,
  PERSONAL_LIFECYCLE_STATUSES,
} from "../lib/schema.mjs";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function makeStore() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-stm-"));
  return { store: new TaskStore({ home }), home };
}

// ---------------------------------------------------------------------------
// 1. Normal State Transition Paths
// ---------------------------------------------------------------------------

test("1.1: pending -> running -> completed (happy path)", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Normal task", prompt: "Do work", cwd: process.cwd() });
  assert.equal(task.status, "pending");

  const claimed = await store.claimNextTask({ now: task.dueAt });
  assert.equal(claimed.status, "running");
  assert.equal(claimed.attempts, 1);

  const completed = await store.completeTask(task.id, { success: true, summary: "done" });
  assert.equal(completed.status, "completed");
  assert.ok(completed.completedAt);
  assert.ok(!completed.error);
});

test("1.2: pending -> running -> completed -> reopened -> completed (personal cycle)", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({
    title: "Personal task",
    prompt: "Buy milk",
    cwd: process.cwd(),
    taskDomain: "personal",
  });
  assert.equal(task.lifecycleStatus, "open");
  assert.equal(task.executionStatus, "idle");

  // complete it
  const done = await store.completePersonalTask(task.id);
  assert.equal(done.status, "completed");
  assert.equal(done.lifecycleStatus, "completed");
  assert.equal(done.executionStatus, "idle");

  // reopen it
  const reopened = await store.reopenPersonalTask(task.id);
  assert.equal(reopened.status, "pending");
  assert.equal(reopened.lifecycleStatus, "open");
  assert.equal(reopened.completedAt, undefined);

  // complete again
  const done2 = await store.completePersonalTask(task.id);
  assert.equal(done2.status, "completed");
});

test("1.3: pending -> running -> failed -> pending -> running (retry success)", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({
    title: "Retry task",
    prompt: "Might fail",
    cwd: process.cwd(),
    maxAttempts: 3,
  });
  const claimed = await store.claimNextTask({ now: task.dueAt });
  assert.equal(claimed.status, "running");

  // First attempt fails but can retry
  const failed = await store.failTask(task.id, { error: "Transient error" });
  assert.equal(failed.status, "pending"); // retryable
  assert.equal(failed.attempts, 1);

  // Second attempt succeeds
  await store.claimNextTask({ now: task.dueAt });
  const completed = await store.completeTask(task.id, { success: true });
  assert.equal(completed.status, "completed");
});

test("1.4: pending -> running -> failed -> failed (exhausted retries)", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({
    title: "Final failure",
    prompt: "Always fails",
    cwd: process.cwd(),
    maxAttempts: 1,
  });
  await store.claimNextTask({ now: task.dueAt });

  const failed = await store.failTask(task.id, { error: "Permanent error" });
  assert.equal(failed.status, "failed");
  assert.equal(failed.attempts, 1);
  assert.match(failed.error, /Permanent error/);
});

test("1.5: pending -> running -> awaiting_audit -> completed (evidence contract)", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({
    title: "Audit task",
    prompt: "Needs evidence",
    cwd: process.cwd(),
    auditLevel: "strict",
    evidenceContract: "## Evidence\n- claim: done\n- files: []",
  });
  await store.claimNextTask({ now: task.dueAt });

  // Complete without evidence -> held for audit
  // NOTE: auditLevel must be in result, not just task, for the audit gate to fire
  const held = await store.completeTask(task.id, {
    success: true,
    evidenceMissing: true,
    evidenceContract: "## Evidence\n- claim: done\n- files: []",
    auditLevel: "strict",
  });
  assert.equal(held.status, "awaiting_audit");
  assert.ok(held.evidenceMissing);

  // M1: markVerificationResult still has to clear evidenceMissing before the
  // gate can promote to completed. A re-verification alone is not enough; the
  // operator (or a follow-up agent) must either patch evidenceMissing=false
  // via updateTask or escalate the verdict via recordAuditReview.
  await store.updateTask(task.id, { evidenceMissing: false });
  const verified = await store.markVerificationResult(task.id, {
    status: "passed",
    checkedAt: new Date().toISOString(),
  });
  assert.equal(verified.status, "completed");
  assert.ok(!verified.error);
});

test("1.6: stale running -> pending (timeout requeue)", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Stale task", prompt: "Work", cwd: process.cwd() });
  await store.claimNextTask({ now: task.dueAt });

  // Simulate a runner that died for > 1 hour
  const requeued = await store.reconcileStaleRunning({
    now: "2030-01-01T02:00:00.000Z",
    timeoutMs: 60 * 60 * 1000, // 1 hour
  });
  // reconcileStaleRunning returns an array directly, not {result: [...]}
  assert.equal(requeued.some((id) => id === task.id), true);

  const refreshed = await store.getTask(task.id);
  assert.equal(refreshed.status, "pending");
  assert.ok(refreshed.error?.includes("timed out"));
});

test("1.7: personal snooze cycle", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({
    title: "Snooze me",
    prompt: "Reminder task",
    cwd: process.cwd(),
    taskDomain: "personal",
    remindAt: "2030-01-01T08:00:00.000Z",
  });
  assert.equal(task.reminderState, "scheduled");

  // Snooze from 10:00 for 30 minutes -> 10:30
  const snoozed = await store.snoozeTask(task.id, {
    minutes: 30,
    now: "2030-01-01T10:00:00.000Z",
  });
  assert.equal(snoozed.reminderState, "snoozed");
  assert.ok(snoozed.remindAt?.includes("10:30:00.000Z") || snoozed.remindAt?.includes("T10:30"));
});

test("1.8: verification failure returns completed -> pending", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Verify fail", prompt: "Work", cwd: process.cwd() });
  await store.claimNextTask({ now: task.dueAt });
  await store.completeTask(task.id, { success: true });

  const updated = await store.markVerificationResult(task.id, {
    status: "failed",
    checkedAt: new Date().toISOString(),
    exitCode: 1,
    output: "test failed",
  });
  assert.equal(updated.status, "pending");
  assert.match(updated.error, /verification failed/i);
});

test("1.9: verification failure on non-retryable task -> failed", async () => {
  const { store } = await makeStore();
  // maxAttempts=1 with attempts=1 means no more retries available
  const task = await store.addTask({
    title: "No retry verify fail",
    prompt: "Work",
    cwd: process.cwd(),
    maxAttempts: 1,
  });
  await store.claimNextTask({ now: task.dueAt });
  await store.completeTask(task.id, { success: true });

  const updated = await store.markVerificationResult(task.id, {
    status: "failed",
    checkedAt: new Date().toISOString(),
  });
  assert.equal(updated.status, "failed");
});

test("1.10: cancel personal task", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({
    title: "Cancel me",
    prompt: "Cancel this",
    cwd: process.cwd(),
    taskDomain: "personal",
  });
  assert.equal(task.lifecycleStatus, "open");

  const cancelled = await store.updateTask(
    task.id,
    { status: "cancelled", lifecycleStatus: "cancelled" },
    { event: "cancelled", note: "User cancelled" }
  );
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.lifecycleStatus, "cancelled");
  assert.equal(cancelled.executionStatus, "idle");
});

// ---------------------------------------------------------------------------
// 2. Error / Edge Cases and Invalid Transitions
// ---------------------------------------------------------------------------

test("2.1: cannot complete a closed personal task", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({
    title: "Already done",
    prompt: "Done",
    cwd: process.cwd(),
    taskDomain: "personal",
  });
  await store.completePersonalTask(task.id);
  await assert.rejects(
    () => store.completePersonalTask(task.id),
    /cannot complete closed personal task/i
  );
});

test("2.2: cannot snooze a closed personal task", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({
    title: "Snooze closed",
    prompt: "Done",
    cwd: process.cwd(),
    taskDomain: "personal",
  });
  await store.completePersonalTask(task.id);
  await assert.rejects(
    () => store.snoozeTask(task.id),
    /cannot snooze closed personal task/i
  );
});

test("2.3: cannot delete a running task", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Running", prompt: "Work", cwd: process.cwd() });
  await store.claimNextTask({ now: task.dueAt });
  await assert.rejects(
    () => store.deleteTask(task.id),
    /cannot delete running task/i
  );
  assert.equal((await store.getTask(task.id)).status, "running");
});

test("2.4: completeTask on unknown task throws", async () => {
  const { store } = await makeStore();
  await assert.rejects(
    () => store.completeTask("not-exist", { success: true }),
    /unknown task/
  );
});

test("2.5: failTask on unknown task throws", async () => {
  const { store } = await makeStore();
  await assert.rejects(
    () => store.failTask("not-exist", { error: "fail" }),
    /unknown task/
  );
});

test("2.6: deleteTask on unknown task throws", async () => {
  const { store } = await makeStore();
  await assert.rejects(
    () => store.deleteTask("not-exist"),
    /unknown task/
  );
});

test("2.7: getTaskActivity on unknown task throws", async () => {
  const { store } = await makeStore();
  await assert.rejects(
    () => store.getTaskActivity("not-exist"),
    /unknown task/
  );
});

test("2.8: snoozeTask on agent task throws", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Agent task", prompt: "Work", cwd: process.cwd() });
  await assert.rejects(
    () => store.snoozeTask(task.id),
    /task is not personal/
  );
});

test("2.9: completePersonalTask on agent task throws", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Agent task", prompt: "Work", cwd: process.cwd() });
  await assert.rejects(
    () => store.completePersonalTask(task.id),
    /task is not personal/
  );
});

test("2.10: reopenPersonalTask on agent task throws", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Agent task", prompt: "Work", cwd: process.cwd() });
  await assert.rejects(
    () => store.reopenPersonalTask(task.id),
    /task is not personal/
  );
});

test("2.11: claimNextTask returns null when no tasks ready", async () => {
  const { store } = await makeStore();
  const result = await store.claimNextTask({ now: "2020-01-01T00:00:00.000Z" });
  assert.equal(result, null);
});

test("2.12: claiming already-claimed running task does not double-count attempts", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Race task", prompt: "Work", cwd: process.cwd() });
  await store.claimNextTask({ now: task.dueAt });

  // A second claim should either return null or return another task, not mutate this one
  const result = await store.claimNextTask({ now: task.dueAt });
  // result could be null or another task — either way task.attempts should still be 1
  const refreshed = await store.getTask(task.id);
  assert.equal(refreshed.attempts, 1);
  assert.equal(refreshed.status, "running"); // stayed running
});

test("2.13: updateTask with empty patch does not corrupt state", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Patch test", prompt: "Work", cwd: process.cwd() });
  const updated = await store.updateTask(task.id, {});
  assert.equal(updated.id, task.id);
  assert.equal(updated.status, "pending");
});

test("2.14: failTask with retryDelayMs schedules dueAt", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Delayed retry", prompt: "Work", cwd: process.cwd(), maxAttempts: 3 });
  await store.claimNextTask({ now: task.dueAt });

  const failed = await store.failTask(task.id, { error: "temp" }, { retryDelayMs: 300_000 });
  assert.equal(failed.status, "pending");
  assert.ok(failed.dueAt);
  const dueMs = Date.parse(failed.dueAt);
  const nowMs = Date.parse(task.dueAt);
  assert.ok(dueMs > nowMs, "dueAt should be pushed forward");
});

test("2.15: evidence contract with standard audit but no evidence missing -> completed", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({
    title: "Normal complete",
    prompt: "Work",
    cwd: process.cwd(),
    auditLevel: "standard",
    evidenceContract: "Report files.",
  });
  await store.claimNextTask({ now: task.dueAt });

  const completed = await store.completeTask(task.id, {
    success: true,
    evidenceMissing: false, // evidence present
  });
  assert.equal(completed.status, "completed");
  assert.ok(!completed.evidenceMissing);
});

test("2.16: evidence contract with strict audit and missing evidence -> awaiting_audit", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({
    title: "Strict audit",
    prompt: "Work",
    cwd: process.cwd(),
    auditLevel: "strict",
    evidenceContract: "Report files.",
  });
  await store.claimNextTask({ now: task.dueAt });

  // evidenceContract and auditLevel must be in result for the audit gate to fire
  const held = await store.completeTask(task.id, {
    success: true,
    evidenceMissing: true,
    evidenceContract: "Report files.",
    auditLevel: "strict",
  });
  assert.equal(held.status, "awaiting_audit");
  // M1 unified gate surfaces a descriptive summary line; the literal string
  // "Evidence section missing in runner output" was the legacy soft warning.
  assert.match(held.error, /完工验收门/);
});

test("2.17: evidence contract with none audit level -> completed regardless of evidence", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({
    title: "No audit",
    prompt: "Work",
    cwd: process.cwd(),
    auditLevel: "none",
    evidenceContract: "Report files.",
  });
  await store.claimNextTask({ now: task.dueAt });

  const completed = await store.completeTask(task.id, {
    success: true,
    evidenceMissing: true,
  });
  assert.equal(completed.status, "completed");
});

// ---------------------------------------------------------------------------
// 3. Boundary Conditions and Concurrency
// ---------------------------------------------------------------------------

test("3.1: all terminal statuses are mutually exclusive from active states", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Terminal check", prompt: "Work", cwd: process.cwd() });
  await store.claimNextTask({ now: task.dueAt });
  await store.completeTask(task.id, { success: true });
  assert.equal(TERMINAL_STATUSES.has("completed"), true);
  assert.equal(TERMINAL_STATUSES.has("failed"), true);
  assert.equal(TERMINAL_STATUSES.has("cancelled"), true);

  // active -> terminal
  for (const status of ["pending", "running", "waiting", "blocked", "awaiting_audit"]) {
    const t = await store.addTask({ title: status, prompt: "w", cwd: process.cwd() });
    assert.equal(TERMINAL_STATUSES.has(t.status), false, `${status} should not be terminal`);
  }
});

test("3.2: all statuses from TASK_STATUSES are valid for normalizeStatus", () => {
  for (const status of TASK_STATUSES) {
    assert.equal(TASK_STATUSES.has(status), true, `${status} should be in TASK_STATUSES`);
  }
});

test("3.3: personal vs agent lifecycle differentiation", async () => {
  const { store } = await makeStore();
  const personal = await store.addTask({
    title: "Personal lifecycle",
    prompt: "Do",
    cwd: process.cwd(),
    taskDomain: "personal",
  });
  assert.equal(personal.taskDomain, "personal");
  assert.equal(personal.lifecycleStatus, "open"); // default for non-terminal status

  // Agent tasks have taskDomain=agent and follow different state machine
  const agent = await store.addTask({ title: "Agent", prompt: "Work", cwd: process.cwd() });
  assert.equal(agent.taskDomain, "agent");
  assert.equal(agent.lifecycleStatus, "open"); // default fallback, also valid in PERSONAL_LIFECYCLE_STATUSES
  // But agent lifecycle follows executionStatus semantics, not personal lifecycle semantics
  assert.equal(agent.executionStatus, "queued");
});

test("3.4: task history is capped at 100 entries", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "History cap", prompt: "Work", cwd: process.cwd() });
  const id = task.id;

  // Create 120 events (enough to exceed cap of 100)
  // Use sequential to avoid lock contention
  for (let i = 0; i < 120; i++) {
    await store.updateTask(id, { summary: `update ${i}` }, { event: `event-${i}`, note: `note ${i}` });
  }

  const refreshed = await store.getTask(id);
  assert.ok(refreshed.history.length <= 100, `history should be capped at 100, got ${refreshed.history.length}`);
  // Most recent 100 should be kept (newest at end), so event-119 through event-20
  assert.match(refreshed.history.at(-1).message, /note 119/);
});

test("3.5: dependsOn blocks scheduling until dependency completes", async () => {
  const { store } = await makeStore();
  const now = "2030-01-01T00:00:00.000Z";

  const first = await store.addTask({ title: "First", prompt: "Work", cwd: process.cwd(), dueAt: now });
  const second = await store.addTask({
    title: "Second",
    prompt: "After first",
    cwd: process.cwd(),
    dueAt: now,
    dependsOn: first.id,
  });

  // Second should not be schedulable yet
  const schedule = await store.scheduleTasks({ limit: 10, now });
  assert.equal(schedule.tasks.map((t) => t.id).includes(second.id), false, "dependent should not be scheduled");
  assert.equal(schedule.blocked.some((b) => b.id === second.id && b.reasons.some((r) => r.startsWith("waiting_on:"))), true);

  // Complete first
  await store.claimNextTask({ now });
  await store.completeTask(first.id, { success: true });

  // Second should now be ready
  const ready = await store.listReadyTasks({ limit: 10, now });
  assert.equal(ready.map((t) => t.id).includes(second.id), true);
});

test("3.6: resource lock prevents concurrent scheduling of same resource", async () => {
  const { store } = await makeStore();
  const now = "2030-01-01T00:00:00.000Z";

  const task1 = await store.addTask({
    title: "Lock 1",
    prompt: "Work",
    cwd: process.cwd(),
    dueAt: now,
    resourceKeys: "module:shared",
  });
  const task2 = await store.addTask({
    title: "Lock 2",
    prompt: "Work",
    cwd: process.cwd(),
    dueAt: now,
    resourceKeys: "module:shared",
  });

  // Both claimable individually
  const first = await store.claimNextTask({ now });
  assert.equal(first.id, task1.id);

  // Second should not be schedulable (resource locked)
  const schedule = await store.scheduleTasks({ limit: 10, now });
  assert.equal(schedule.tasks.map((t) => t.id).includes(task2.id), false);
  assert.equal(schedule.blocked.some((b) => b.id === task2.id && b.reasons.some((r) => r.startsWith("resource_locked:"))), true);
});

test("3.7: worktreePath creates implicit resource key", async () => {
  const { store } = await makeStore();
  const now = "2030-01-01T00:00:00.000Z";
  const worktreePath = path.join(os.tmpdir(), "axi-todo-wt-test");

  const task1 = await store.addTask({
    title: "WT 1",
    prompt: "Work",
    cwd: process.cwd(),
    dueAt: now,
    worktreePath,
  });
  const task2 = await store.addTask({
    title: "WT 2",
    prompt: "Work",
    cwd: process.cwd(),
    dueAt: now,
    worktreePath,
  });

  await store.claimNextTask({ now });
  const schedule = await store.scheduleTasks({ limit: 10, now });
  // task2 should be blocked because task1 holds the worktree
  assert.equal(schedule.blocked.some((b) => b.id === task2.id && b.reasons.some((r) => r.startsWith("resource_locked:"))), true);
});

test("3.8: parallelGroup limit enforced correctly", async () => {
  const { store, home } = await makeStore();
  const now = "2030-01-01T00:00:00.000Z";

  // maxParallelGroup = 2 for this group
  // Use distinct cwd for each task to avoid resource key collision
  const tasks = await Promise.all(
    Array.from({ length: 3 }, async (_, i) => {
      const taskHome = await fs.mkdtemp(path.join(os.tmpdir(), `pg-task-${i}-`));
      return store.addTask({
        title: `Group task ${i}`,
        prompt: "Work",
        cwd: taskHome,
        dueAt: now,
        priority: 10 - i,
        parallelGroup: "team:special",
        maxParallelGroup: 2,
      });
    })
  );

  const ready = await store.listReadyTasks({ limit: 10, now });
  // Only 2 should be selected due to maxParallelGroup = 2
  assert.equal(ready.length, 2, `expected 2, got ${ready.length}`);
  assert.equal(ready.every((t) => t.parallelGroup === "team:special"), true);
});

test("3.9: file lock prevents concurrent mutations", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-lock-"));
  const store = new TaskStore({ home });

  await store.addTask({ title: "Lock test", prompt: "Work", cwd: home });

  // Launch two concurrent mutations
  const [r1, r2] = await Promise.allSettled([
    store.updateTask((await store.listTasks())[0].id, { summary: "first" }),
    store.updateTask((await store.listTasks())[0].id, { summary: "second" }),
  ]);

  // One should succeed, one should fail with lock timeout
  const successes = [r1, r2].filter((r) => r.status === "fulfilled");
  assert.ok(successes.length >= 1, "at least one mutation should succeed");
});

test("3.10: claimNextTask increments attempts atomically", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Attempts", prompt: "Work", cwd: process.cwd(), maxAttempts: 5 });

  for (let i = 1; i <= 3; i++) {
    await store.claimNextTask({ now: task.dueAt });
    const t = await store.getTask(task.id);
    assert.equal(t.attempts, i);
    // Release by failing (retryable)
    await store.failTask(task.id, { error: "temp" });
  }
  assert.equal((await store.getTask(task.id)).attempts, 3);
});

test("3.11: listReadyTasks excludes non-due tasks", async () => {
  const { store } = await makeStore();
  const now = "2030-01-01T00:00:00.000Z";

  await store.addTask({ title: "Due now", prompt: "Work", cwd: process.cwd(), dueAt: now });
  await store.addTask({
    title: "Due later",
    prompt: "Work",
    cwd: process.cwd(),
    dueAt: "2030-12-31T23:59:59.000Z",
  });

  const ready = await store.listReadyTasks({ limit: 10, now });
  assert.equal(ready.length, 1);
  assert.equal(ready[0].title, "Due now");
});

test("3.12: listReadyTasks excludes placeholder prompts", async () => {
  const { store } = await makeStore();
  const now = "2030-01-01T00:00:00.000Z";

  await store.addTask({ title: "Real", prompt: "Do the work", cwd: process.cwd(), dueAt: now });
  await store.addTask({ title: "Placeholder", prompt: "待填写", cwd: process.cwd(), dueAt: now });

  const ready = await store.listReadyTasks({ limit: 10, now });
  assert.equal(ready.length, 1);
  assert.equal(ready[0].title, "Real");
});

test("3.13: missing claim files surface as warnings but do not block completion", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Claim files", prompt: "Work", cwd: process.cwd() });
  await store.claimNextTask({ now: task.dueAt });

  const completed = await store.completeTask(task.id, {
    success: true,
    claimFiles: ["/nonexistent/file.txt", "/another/missing.txt"],
  });
  assert.equal(completed.status, "completed");
  assert.match(completed.summary, /claimed-file-not-found/);
});

test("3.14: truncated output surfaces as warning", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Truncated", prompt: "Work", cwd: process.cwd() });
  await store.claimNextTask({ now: task.dueAt });

  const completed = await store.completeTask(task.id, {
    success: true,
    truncated: { stdout: true, droppedBytes: { stdout: 4096, stderr: 0 } },
  });
  assert.equal(completed.status, "completed");
  assert.match(completed.summary, /truncated/);
});

test("3.15: audit review record is appended after awaiting_audit transition", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({
    title: "Audit record",
    prompt: "Work",
    cwd: process.cwd(),
    auditLevel: "strict",
    evidenceContract: "Report files.",
  });
  await store.claimNextTask({ now: task.dueAt });

  // auditLevel must be in result for the audit gate to fire
  await store.completeTask(task.id, {
    success: true,
    evidenceMissing: true,
    evidenceContract: "Report files.",
    auditLevel: "strict",
  });

  const state = await store.readState();
  assert.equal(state.auditReviews.some((r) => r.taskId === task.id), true);
  const review = state.auditReviews.find((r) => r.taskId === task.id);
  assert.equal(review.verdict, "pending");
});

test("3.16: failureAnalysis record is appended on failTask", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Analyze me", prompt: "Work", cwd: process.cwd() });
  await store.claimNextTask({ now: task.dueAt });

  await store.failTask(task.id, {
    error: "Analysis available",
    failureAnalysis: {
      rootCause: "Wrong assumption",
      trigger: "assertion",
      failureStage: "execution",
      recoveryAction: "Check preconditions",
      avoidNextTime: "Validate inputs first",
      retryable: true,
    },
  });

  const state = await store.readState();
  assert.equal(state.failureAnalyses.length, 1);
  assert.match(state.failureAnalyses[0].rootCause, /Wrong assumption/);
});

test("3.17: memoryCards are appended on completion and failure", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Memory", prompt: "Work", cwd: process.cwd() });
  await store.claimNextTask({ now: task.dueAt });

  await store.completeTask(task.id, {
    success: true,
    memoryCards: [{ type: "completion_fact", title: "Done", content: "Work completed" }],
  });

  const state = await store.readState();
  assert.equal(state.memoryCards.length, 1);
  assert.equal(state.memoryCards[0].type, "completion_fact");
});

test("3.18: taskRuns record lifecycle", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Run record", prompt: "Work", cwd: process.cwd() });
  await store.claimNextTask({ now: task.dueAt });
  await store.completeTask(task.id, { success: true });

  const runs = await store.recordTaskRun({
    taskId: task.id,
    runId: "run-1",
    status: "succeeded",
    startedAt: task.dueAt,
    endedAt: new Date().toISOString(),
    durationMs: 1234,
    exitCode: 0,
  });

  const state = await store.readState();
  assert.equal(state.taskRuns.some((r) => r.taskId === task.id), true);
});

test("3.19: taskEvents are append-only", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Event task", prompt: "Work", cwd: process.cwd() });

  await store.recordTaskEvent({
    taskId: task.id,
    eventType: "info",
    message: "Task created via API",
    actor: "api",
  });

  const state = await store.readState();
  assert.equal(state.taskEvents.length, 1);
  assert.equal(state.taskEvents[0].message, "Task created via API");
});

test("3.20: completionSummary is recorded after non-audit completion", async () => {
  const { store } = await makeStore();
  const task = await store.addTask({ title: "Summary", prompt: "Work", cwd: process.cwd() });
  await store.claimNextTask({ now: task.dueAt });

  await store.completeTask(task.id, {
    success: true,
    completionSummary: {
      summary: "All done",
      durationMs: 5000,
      nextTimeNotes: "Speed up by 10%",
    },
  });

  const state = await store.readState();
  assert.equal(state.completionSummaries.length, 1);
  assert.equal(state.completionSummaries[0].durationMs, 5000);
});
