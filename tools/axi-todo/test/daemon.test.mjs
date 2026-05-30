import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runOnce } from "../lib/daemon.mjs";
import { TaskStore } from "../lib/store.mjs";

test("runOnce claims one task and records executor success", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-daemon-"));
  const store = new TaskStore({ home });
  const task = await store.addTask({
    title: "Run task",
    prompt: "Do it",
    cwd: home,
  });

  const result = await runOnce({
    store,
    executor: async (claimed) => ({
      success: true,
      runId: "run-1",
      summary: `finished ${claimed.id}`,
    }),
  });

  assert.equal(result.claimed, task.id);
  const updated = await store.getTask(task.id);
  assert.equal(updated.status, "completed");
  assert.equal(updated.summary, `finished ${task.id}`);
});

test("runOnce reschedules failed tasks while retries remain", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-daemon-fail-"));
  const store = new TaskStore({ home });
  const task = await store.addTask({
    title: "Run task",
    prompt: "Do it",
    cwd: home,
    maxAttempts: 2,
  });

  await runOnce({
    store,
    retryDelayMs: 0,
    executor: async () => ({
      success: false,
      runId: "run-1",
      error: "boom",
    }),
  });

  const updated = await store.getTask(task.id);
  assert.equal(updated.status, "pending");
  assert.equal(updated.attempts, 1);
});
