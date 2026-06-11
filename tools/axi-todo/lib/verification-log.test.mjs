import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendVerificationLogEntry,
  readVerificationLogEntries
} from "./verification-log.mjs";

function makeTempCwd() {
  return fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-verify-"));
}

test("creates VERIFICATION.md and appends one entry when creation is enabled", async () => {
  const cwd = await makeTempCwd();
  const task = {
    id: "task-001",
    title: "smoke verify writeback",
    cwd,
    verifyCommand: "true"
  };
  const result = {
    success: true,
    verification: {
      status: "passed",
      exitCode: 0,
      checkedAt: "2026-06-11T10:00:00.000Z"
    }
  };
  const wrote = await appendVerificationLogEntry({
    task,
    result,
    env: { AXI_TODO_VERIFY_LOG_CREATE: "1" }
  });
  assert.equal(wrote, true);

  const target = path.join(cwd, "VERIFICATION.md");
  const text = await fs.readFile(target, "utf8");
  assert.match(text, /## Axi Todo Verify Activity/);
  assert.match(text, /`task-001`/);
  assert.match(text, /passed/);
  assert.match(text, /exit=0/);
  assert.match(text, /true/);
});

test("does not create VERIFICATION.md by default", async () => {
  const cwd = await makeTempCwd();
  const task = {
    id: "task-no-create",
    title: "no create",
    cwd,
    verifyCommand: "true"
  };
  const result = {
    success: true,
    verification: { status: "passed", exitCode: 0, checkedAt: "2026-06-11T10:00:00.000Z" }
  };
  assert.equal(await appendVerificationLogEntry({ task, result, env: {} }), false);
  await assert.rejects(async () => {
    await fs.access(path.join(cwd, "VERIFICATION.md"));
  });
});

test("skips references paths even when creation is enabled", async () => {
  const root = await makeTempCwd();
  const cwd = path.join(root, "references", "demo");
  await fs.mkdir(cwd, { recursive: true });
  const task = {
    id: "task-ref",
    title: "reference skip",
    cwd,
    verifyCommand: "true"
  };
  const result = {
    success: true,
    verification: { status: "passed", exitCode: 0, checkedAt: "2026-06-11T10:00:00.000Z" }
  };
  assert.equal(
    await appendVerificationLogEntry({ task, result, env: { AXI_TODO_VERIFY_LOG_CREATE: "1" } }),
    false
  );
});

test("is idempotent on duplicate (taskId, checkedAt)", async () => {
  const cwd = await makeTempCwd();
  const task = {
    id: "task-dup",
    title: "duplicate guard",
    cwd,
    verifyCommand: "true"
  };
  const result = {
    success: true,
    verification: { status: "passed", exitCode: 0, checkedAt: "2026-06-11T10:00:00.000Z" }
  };
  await fs.writeFile(path.join(cwd, "VERIFICATION.md"), "# Verification\n");
  assert.equal(await appendVerificationLogEntry({ task, result }), true);
  assert.equal(await appendVerificationLogEntry({ task, result }), false);
  assert.equal(
    await appendVerificationLogEntry({
      task,
      result: {
        success: true,
        verification: { status: "passed", exitCode: 0, checkedAt: "2026-06-11T10:05:00.000Z" }
      }
    }),
    true
  );
  const text = await fs.readFile(path.join(cwd, "VERIFICATION.md"), "utf8");
  const matches = text.match(/`task-dup`/g) ?? [];
  assert.equal(matches.length, 2);
});

test("appends to existing VERIFICATION.md without overwriting the section", async () => {
  const cwd = await makeTempCwd();
  const target = path.join(cwd, "VERIFICATION.md");
  await fs.writeFile(
    target,
    [
      "# Verification",
      "",
      "Last Verified: 2026-06-10",
      "",
      "## Axi Todo Verify Activity",
      "",
      "- 2026-06-10T08:00:00.000Z | `old-task` | passed | exit=0 | first run | `true`",
      ""
    ].join("\n")
  );
  const task = {
    id: "new-task",
    title: "second run",
    cwd,
    verifyCommand: "false"
  };
  const result = {
    success: false,
    verification: { status: "failed", exitCode: 1, checkedAt: "2026-06-11T11:00:00.000Z" }
  };
  await appendVerificationLogEntry({ task, result });
  const text = await fs.readFile(target, "utf8");
  assert.match(text, /Last Verified: 2026-06-10/); // preserved
  assert.match(text, /`old-task`/);
  assert.match(text, /`new-task`/);
  // New entry should appear BEFORE old (newest-first ordering)
  const newIdx = text.indexOf("`new-task`");
  const oldIdx = text.indexOf("`old-task`");
  assert.ok(newIdx < oldIdx, "new entry should precede old entry under newest-first ordering");
});

test("readVerificationLogEntries returns structured rows", async () => {
  const cwd = await makeTempCwd();
  await fs.writeFile(path.join(cwd, "VERIFICATION.md"), "# Verification\n");
  const task = { id: "t1", title: "row test", cwd, verifyCommand: "true" };
  const result = {
    success: true,
    verification: { status: "passed", exitCode: 0, checkedAt: "2026-06-11T12:00:00.000Z" }
  };
  await appendVerificationLogEntry({ task, result });
  const entries = await readVerificationLogEntries({ cwd });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].taskId, "t1");
  assert.equal(entries[0].status, "passed");
  assert.equal(entries[0].exitCode, 0);
  assert.equal(entries[0].command, "true");
});

test("returns false (no throw) when cwd is missing or unwritable", async () => {
  const task = {
    id: "no-cwd",
    title: "no cwd",
    cwd: "/this/path/does/not/exist/anywhere",
    verifyCommand: "true"
  };
  const result = {
    success: true,
    verification: { status: "passed", exitCode: 0, checkedAt: "2026-06-11T10:00:00.000Z" }
  };
  const wrote = await appendVerificationLogEntry({ task, result });
  assert.equal(wrote, false);
});

test("skips when task has no verifyCommand", async () => {
  const cwd = await makeTempCwd();
  await fs.writeFile(path.join(cwd, "VERIFICATION.md"), "# Verification\n");
  const task = { id: "no-vc", title: "no vc", cwd, verifyCommand: "" };
  const result = { success: true, verification: { status: "passed", exitCode: 0, checkedAt: "2026-06-11T10:00:00.000Z" } };
  const wrote = await appendVerificationLogEntry({ task, result });
  assert.equal(wrote, false);
  const text = await fs.readFile(path.join(cwd, "VERIFICATION.md"), "utf8");
  assert.equal(text, "# Verification\n");
});
