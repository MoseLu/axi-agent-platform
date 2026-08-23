import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStoreFromEnv, TaskStore } from "../lib/store.mjs";
import { PostgresTaskStore } from "../lib/postgres-store.mjs";

test("store creates, lists, claims, and completes tasks", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-store-"));
  const store = new TaskStore({ home });
  const task = await store.addTask({
    title: "Test task",
    prompt: "Do the work",
    cwd: home,
    verifyCommand: "true",
  });

  assert.equal(task.status, "pending");
  assert.equal((await store.listTasks()).length, 1);

  const claimed = await store.claimNextTask({ now: task.dueAt });
  assert.equal(claimed.id, task.id);
  assert.equal(claimed.status, "running");
  assert.equal(claimed.attempts, 1);

  const completed = await store.completeTask(task.id, {
    success: true,
    summary: "done",
    runId: "run-1",
    outputPath: "/tmp/out",
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.summary, "done");
});

test("createStoreFromEnv selects JSON fallback or PostgreSQL fact store", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-store-env-"));
  assert.equal(createStoreFromEnv({ AXI_TODO_HOME: home, AXI_TODO_STORE: "json" }) instanceof TaskStore, true);
  assert.equal(createStoreFromEnv({ AXI_TODO_HOME: home }) instanceof TaskStore, true);
  assert.equal(createStoreFromEnv({}) instanceof PostgresTaskStore, true);
  assert.equal(createStoreFromEnv({ AXI_TODO_STORE: "auto", DATABASE_URL: "postgres://user:pass@localhost/db" }) instanceof PostgresTaskStore, true);
});

test("store skips desktop placeholder tasks until the prompt is filled", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-placeholder-"));
  const store = new TaskStore({ home });
  const placeholder = await store.addTask({
    title: "新 Todo",
    prompt: "待填写",
    cwd: home,
  });
  const ready = await store.addTask({
    title: "Ready task",
    prompt: "Do the work",
    cwd: home,
  });

  const claimed = await store.claimNextTask({ now: ready.dueAt });
  assert.equal(claimed.id, ready.id);

  const unclaimed = await store.getTask(placeholder.id);
  assert.equal(unclaimed.status, "pending");
  assert.equal(unclaimed.attempts, 0);
});

test("personal tasks use the personal lifecycle and never enter the agent scheduler", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-personal-"));
  const store = new TaskStore({ home });
  const personal = await store.addTask({
    title: "买牛奶",
    body: "下班路上带一瓶",
    cwd: home,
    taskDomain: "personal",
    remindAt: "2030-01-01T08:00:00.000Z",
  });

  assert.equal(personal.taskDomain, "personal");
  assert.equal(personal.prompt, "买牛奶");
  assert.equal(personal.dueAt, undefined);
  assert.equal(personal.lifecycleStatus, "open");
  assert.equal(personal.executionStatus, "idle");
  assert.equal(personal.reminderState, "scheduled");
  assert.equal(personal.history[0].actor, "user");
  assert.equal(typeof personal.history[0].id, "string");
  assert.equal(await store.claimNextTask({ now: "2030-01-01T00:00:00.000Z" }), null);

  const completed = await store.updateTask(personal.id, { lifecycleStatus: "completed" }, { event: "completed", note: "Todo completed", now: "2030-01-01T09:00:00.000Z" });
  assert.equal(completed.status, "completed");
  assert.equal(completed.completedAt, "2030-01-01T09:00:00.000Z");
  assert.equal(completed.reminderState, "cancelled");
  assert.equal(completed.history.at(-1).actor, "user");

  const reopened = await store.updateTask(personal.id, { status: "pending" }, { event: "reopened", note: "Todo reopened", now: "2030-01-01T10:00:00.000Z" });
  assert.equal(reopened.lifecycleStatus, "open");
  assert.equal(reopened.completedAt, undefined);
  const snoozed = await store.snoozeTask(personal.id, { minutes: 15, now: "2030-01-01T10:00:00.000Z" });
  assert.equal(snoozed.reminderState, "snoozed");
  assert.equal(snoozed.remindAt, "2030-01-01T10:15:00.000Z");
});

test("verification failure can move completed tasks back to pending", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-verify-"));
  const store = new TaskStore({ home });
  const task = await store.addTask({
    title: "Verify task",
    prompt: "Do the work",
    cwd: home,
  });
  await store.completeTask(task.id, { success: true });

  const updated = await store.markVerificationResult(task.id, {
    status: "failed",
    checkedAt: new Date().toISOString(),
    exitCode: 1,
    output: "nope",
  });
  assert.equal(updated.status, "pending");
  assert.equal(updated.error, "Verification failed after completion.");
});

test("store deletes tasks and refuses running deletions", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-delete-"));
  const store = new TaskStore({ home });
  const removable = await store.addTask({
    title: "Remove me",
    prompt: "Do not keep this",
    cwd: home,
  });

  const deleted = await store.deleteTask(removable.id);
  assert.equal(deleted.id, removable.id);
  assert.equal((await store.getTask(removable.id)), null);
  assert.equal((await store.listTasks()).length, 0);

  const running = await store.addTask({
    title: "Running task",
    prompt: "Keep going",
    cwd: home,
  });
  const claimed = await store.claimNextTask({ now: running.dueAt });
  assert.equal(claimed.id, running.id);

  await assert.rejects(() => store.deleteTask(running.id), /cannot delete running task/i);
  assert.equal((await store.getTask(running.id)).status, "running");
});

test("scheduler respects dependencies and resource locks", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-schedule-"));
  const store = new TaskStore({ home });
  const now = "2030-01-01T00:00:00.000Z";
  const base = await store.addTask({
    title: "Base",
    prompt: "Do the base work",
    cwd: home,
    dueAt: now,
    resourceKeys: "module:base",
  });
  const dependent = await store.addTask({
    title: "Dependent",
    prompt: "Do dependent work",
    cwd: home,
    dueAt: now,
    dependsOn: base.id,
    resourceKeys: "module:dependent",
  });
  const conflict = await store.addTask({
    title: "Conflict",
    prompt: "Do conflicting work",
    cwd: home,
    dueAt: now,
    priority: 10,
    resourceKeys: "module:base",
  });

  const claimed = await store.claimNextTask({ now });
  assert.equal(claimed.id, conflict.id, "higher priority resource owner claims first");

  const schedule = await store.scheduleTasks({ limit: 10, now });
  assert.deepEqual(schedule.tasks.map((task) => task.id), []);
  assert.equal(schedule.blocked.some((item) => item.id === dependent.id && item.reasons.some((reason) => reason.startsWith("waiting_on:"))), true);
  assert.equal(schedule.blocked.some((item) => item.id === base.id && item.reasons.some((reason) => reason.startsWith("resource_locked:"))), true);

  await store.completeTask(conflict.id, { success: true });
  await store.completeTask(base.id, { success: true });
  const ready = await store.listReadyTasks({ limit: 10, now });
  assert.deepEqual(ready.map((task) => task.id), [dependent.id]);
});

test("scheduler respects OMO-style parallel group limits", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-parallel-group-"));
  const store = new TaskStore({ home });
  const now = "2030-01-01T00:00:00.000Z";
  const first = await store.addTask({
    title: "Deep worker 1",
    prompt: "Do deep work",
    cwd: home,
    dueAt: now,
    priority: 20,
    resourceKeys: "slice:1",
    agentCategory: "deep",
    parallelGroup: "team:deep",
    maxParallelGroup: 2,
  });
  const second = await store.addTask({
    title: "Deep worker 2",
    prompt: "Do deep work",
    cwd: home,
    dueAt: now,
    priority: 10,
    resourceKeys: "slice:2",
    agentCategory: "deep",
    parallelGroup: "team:deep",
    maxParallelGroup: 2,
  });
  const third = await store.addTask({
    title: "Deep worker 3",
    prompt: "Do deep work",
    cwd: home,
    dueAt: now,
    priority: 5,
    resourceKeys: "slice:3",
    agentCategory: "deep",
    parallelGroup: "team:deep",
    maxParallelGroup: 2,
  });
  const quick = await store.addTask({
    title: "Quick worker",
    prompt: "Do quick work",
    cwd: home,
    dueAt: now,
    priority: 1,
    resourceKeys: "slice:4",
    agentCategory: "quick",
    parallelGroup: "team:quick",
    maxParallelGroup: 4,
  });

  const selected = await store.listReadyTasks({ limit: 10, now });
  assert.deepEqual(selected.map((task) => task.id), [first.id, second.id, quick.id]);

  await store.claimNextTask({ now });
  await store.claimNextTask({ now });
  const schedule = await store.scheduleTasks({ limit: 10, now });
  assert.deepEqual(schedule.tasks.map((task) => task.id), [quick.id]);
  assert.equal(schedule.blocked.some((item) => item.id === third.id && item.reasons.includes("parallel_group_limited:team:deep")), true);
});

test("completion records summaries and reusable memory cards", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-memory-complete-"));
  const store = new TaskStore({ home });
  const task = await store.addTask({
    title: "Complete with memory",
    prompt: "Do the work",
    cwd: home,
    charterId: "charter-1",
    expectedResult: "A verified change",
    acceptanceChecks: ["test passes"],
    auditLevel: "standard",
    taskGranularity: "atomic",
    modelSelectionReason: "quick evidence-backed task",
  });

  await store.claimNextTask({ now: task.dueAt });
  await store.completeTask(task.id, {
    success: true,
    summary: "Done with evidence",
    runId: "run-memory-1",
    completionSummary: {
      runId: "run-memory-1",
      summary: "Done with evidence",
      durationMs: 1234,
      evidenceRefs: ["/tmp/evidence.txt"],
      nextTimeNotes: "Reuse the same verification shape.",
    },
    memoryCards: [{
      type: "completion_fact",
      title: "Complete with memory",
      content: "Task completed with evidence and reusable verification notes.",
      concepts: ["completion", "verification"],
      files: ["/tmp/evidence.txt"],
    }],
  });

  const state = await store.readState();
  assert.equal(state.completionSummaries.length, 1);
  assert.equal(state.completionSummaries[0].durationMs, 1234);
  assert.equal(state.memoryCards.length, 1);
  assert.equal(state.memoryCards[0].type, "completion_fact");

  const found = await store.searchPlanningMemory({ query: "verification", limit: 10 });
  assert.equal(found.some((item) => item.source === "memory_cards"), true);
});

test("failure records analysis and does not mark the task completed", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-memory-fail-"));
  const store = new TaskStore({ home });
  const task = await store.addTask({
    title: "Fail with analysis",
    prompt: "Do the work",
    cwd: home,
    maxAttempts: 1,
  });

  await store.claimNextTask({ now: task.dueAt });
  const failed = await store.failTask(task.id, {
    success: false,
    runId: "run-fail-1",
    error: "missing completion evidence",
    failureAnalysis: {
      runId: "run-fail-1",
      rootCause: "Worker exited without Evidence section.",
      failureStage: "evidence_check",
      recoveryAction: "Ask the worker to rerun verification and include Evidence.",
      avoidNextTime: "Keep Evidence contract in the prompt.",
      retryable: false,
    },
    memoryCards: [{
      type: "failure_lesson",
      content: "Missing Evidence must fail closed and be analyzed.",
      concepts: ["failure", "evidence"],
    }],
  });

  assert.equal(failed.status, "failed");
  const state = await store.readState();
  assert.equal(state.failureAnalyses.length, 1);
  assert.match(state.failureAnalyses[0].rootCause, /Evidence/);
  assert.equal(state.memoryCards[0].type, "failure_lesson");
});

test("audit reviews and user preferences are append-only planning memory", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-memory-audit-"));
  const store = new TaskStore({ home });
  const task = await store.addTask({
    title: "Audit task",
    prompt: "Do the work",
    cwd: home,
  });

  await store.recordAuditReview({
    taskId: task.id,
    runId: "run-audit-1",
    auditLevel: "strict",
    verdict: "fail",
    reason: "Screenshot evidence missing.",
    evidenceGaps: ["screenshot"],
    releaseConditions: ["rerun browser verification"],
  });
  await store.recordUserPreference({
    taskId: task.id,
    preference: "Report completion with exact verification evidence.",
    source: "explicit-user-request",
    confidence: 1,
  });
  await store.recordUserPreference({
    taskId: task.id,
    preference: "Prefer autonomous continuation for safe local work.",
    source: "workspace-instructions",
    confidence: 0.9,
  });

  const updated = await store.getTask(task.id);
  assert.equal(updated.status, "awaiting_audit");

  const state = await store.readState();
  assert.equal(state.auditReviews.length, 1);
  assert.equal(state.userPreferences.length, 2);
  assert.equal(state.userPreferences[0].preference.includes("verification"), true);
});
