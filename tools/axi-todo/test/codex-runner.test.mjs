import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexArgs, buildCodexPrompt } from "../lib/codex-runner.mjs";

test("buildCodexArgs targets codex exec with output capture and cwd", () => {
  const task = {
    id: "task-1",
    title: "Task",
    prompt: "Change code",
    cwd: "/tmp/project",
    verifyCommand: "pnpm test",
  };
  const args = buildCodexArgs(task, { outputPath: "/tmp/out.txt", addDirs: ["/tmp"] });

  assert.deepEqual(args.slice(0, 9), [
    "exec",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--color",
    "never",
    "--output-last-message",
    "/tmp/out.txt",
    "-C",
  ]);
  assert.equal(args[9], "/tmp/project");
  assert.equal(args[10], "--add-dir");
  assert.equal(args[11], "/tmp");
  assert.match(args.at(-1), /Task ID: task-1/);
});

test("buildCodexPrompt includes verification command when available", () => {
  const prompt = buildCodexPrompt({
    id: "task-2",
    title: "Verify",
    prompt: "Do it",
    cwd: "/tmp/project",
    verifyCommand: "pnpm verify",
  });
  assert.match(prompt, /pnpm verify/);
  assert.match(prompt, /Completion Contract/);
});
