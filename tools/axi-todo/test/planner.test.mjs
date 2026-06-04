import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSplitPlan } from "../lib/planner.mjs";

test("split planner creates verifiable graph-ready child tasks", () => {
  const cwd = path.join(os.tmpdir(), "axi-todo-planner");
  const plan = createSplitPlan({
    goal: "Improve MiniMax quota scheduling",
    cwd,
    targetReady: 8,
    verifyCommand: "pnpm test",
    parentId: "parent-1",
    resourcePrefix: "scheduler",
    priority: 20,
  });

  assert.equal(plan.dryRun, undefined);
  assert.equal(plan.tasks.length, 8);
  assert.equal(plan.tasks.every((task) => task.cwd === cwd), true);
  assert.equal(plan.tasks.every((task) => task.parentId === "parent-1"), true);
  assert.equal(plan.tasks.every((task) => task.verifyCommand === "pnpm test"), true);
  assert.equal(plan.tasks.every((task) => task.priority === 20), true);
  assert.equal(plan.tasks.every((task) => task.resourceKeys.length === 1), true);
  assert.equal(plan.tasks.every((task) => task.evidenceContract && task.prompt.includes("Evidence")), true);
  assert.deepEqual(
    Array.from(new Set(plan.tasks.map((task) => task.taskKind))).sort(),
    ["doc", "edit", "inspect", "test", "verify"],
  );
});
