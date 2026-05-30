import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskStore } from "../lib/store.mjs";

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
