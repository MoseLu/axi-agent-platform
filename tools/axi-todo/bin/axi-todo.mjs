#!/usr/bin/env node
import { runDaemon, runOnce } from "../lib/daemon.mjs";
import { startMcpStdio } from "../lib/mcp-server.mjs";
import { createSplitPlan } from "../lib/planner.mjs";
import { createStoreFromEnv } from "../lib/store.mjs";

const store = createStoreFromEnv();

async function main() {
  const [command = "help", ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  if (command === "add") {
    const task = await store.addTask({
      title: requiredFlag(flags, "title"),
      prompt: requiredFlag(flags, "prompt"),
      cwd: flags.cwd,
      priority: flags.priority,
      maxAttempts: flags["max-attempts"] || flags.maxAttempts,
      dueAt: flags["due-at"] || flags.dueAt,
      verifyCommand: flags["verify-command"] || flags.verifyCommand,
      parentId: flags["parent-id"] || flags.parentId,
      dependsOn: flags["depends-on"] || flags.dependsOn,
      resourceKeys: flags["resource-keys"] || flags.resourceKeys,
      taskKind: flags["task-kind"] || flags.taskKind,
      estimatedCostPercent: flags["estimated-cost-percent"] || flags.estimatedCostPercent,
      riskLevel: flags["risk-level"] || flags.riskLevel,
      plannerConfidence: flags["planner-confidence"] || flags.plannerConfidence,
      evidenceContract: flags["evidence-contract"] || flags.evidenceContract,
      agentRole: flags["agent-role"] || flags.agentRole,
      agentCategory: flags["agent-category"] || flags.agentCategory,
      executionMode: flags["execution-mode"] || flags.executionMode,
      modelHint: flags["model-hint"] || flags.modelHint,
      fallbackModels: flags["fallback-models"] || flags.fallbackModels,
      parallelGroup: flags["parallel-group"] || flags.parallelGroup,
      maxParallelGroup: flags["max-parallel-group"] || flags.maxParallelGroup,
      notepadPath: flags["notepad-path"] || flags.notepadPath,
      mailboxThreadId: flags["mailbox-thread-id"] || flags.mailboxThreadId,
      worktreePath: flags["worktree-path"] || flags.worktreePath,
    });
    printJson(task);
    return;
  }
  if (command === "list") {
    const tasks = await store.listTasks({ status: flags.status });
    if (flags.json) {
      printJson(tasks);
    } else {
      printTable(tasks);
    }
    return;
  }
  if (command === "ready") {
    printJson(await store.listReadyTasks({ limit: parsePositiveInt(flags.limit, 50) }));
    return;
  }
  if (command === "schedule") {
    printJson(await store.scheduleTasks({ limit: parsePositiveInt(flags.limit, 50) }));
    return;
  }
  if (command === "split") {
    const parentId = flags.from || flags["parent-id"] || flags.parentId || "";
    const parent = parentId ? await store.getTask(parentId) : null;
    if (parentId && !parent) throw new Error(`unknown parent task: ${parentId}`);
    const plan = createSplitPlan({
      goal: flags.goal || parent?.prompt || parent?.title,
      cwd: flags.cwd || parent?.cwd || process.cwd(),
      targetReady: flags["target-ready"] || flags.targetReady,
      verifyCommand: flags["verify-command"] || flags.verifyCommand || parent?.verifyCommand,
      priority: flags.priority || parent?.priority,
      parentId: parent?.id || parentId,
      resourcePrefix: flags["resource-prefix"] || flags.resourcePrefix,
    });
    if (!flags.apply) {
      printJson({ dryRun: true, ...plan });
      return;
    }
    const created = [];
    for (const taskInput of plan.tasks) {
      created.push(await store.addTask(taskInput));
    }
    printJson({ dryRun: false, created: created.map((task) => task.id), ...plan });
    return;
  }
  if (command === "show") {
    const id = flags._[0];
    if (!id) throw new Error("show requires a task id");
    const task = await store.getTask(id);
    if (!task) throw new Error(`unknown task: ${id}`);
    printJson(task);
    return;
  }
  if (command === "delete") {
    const id = flags._[0];
    if (!id) throw new Error("delete requires a task id");
    printJson(await store.deleteTask(id));
    return;
  }
  if (command === "update") {
    const id = flags._[0];
    if (!id) throw new Error("update requires a task id");
    const task = await store.updateTask(
      id,
      {
        title: flags.title,
        prompt: flags.prompt,
        cwd: flags.cwd,
        status: flags.status,
        priority: flags.priority,
        maxAttempts: flags["max-attempts"] || flags.maxAttempts,
        dueAt: flags["due-at"] || flags.dueAt,
        verifyCommand: flags["verify-command"] || flags.verifyCommand,
        parentId: flags["parent-id"] || flags.parentId,
        dependsOn: flags["depends-on"] || flags.dependsOn,
        resourceKeys: flags["resource-keys"] || flags.resourceKeys,
        taskKind: flags["task-kind"] || flags.taskKind,
        estimatedCostPercent: flags["estimated-cost-percent"] || flags.estimatedCostPercent,
        riskLevel: flags["risk-level"] || flags.riskLevel,
        plannerConfidence: flags["planner-confidence"] || flags.plannerConfidence,
        evidenceContract: flags["evidence-contract"] || flags.evidenceContract,
        agentRole: flags["agent-role"] || flags.agentRole,
        agentCategory: flags["agent-category"] || flags.agentCategory,
        executionMode: flags["execution-mode"] || flags.executionMode,
        modelHint: flags["model-hint"] || flags.modelHint,
        fallbackModels: flags["fallback-models"] || flags.fallbackModels,
        parallelGroup: flags["parallel-group"] || flags.parallelGroup,
        maxParallelGroup: flags["max-parallel-group"] || flags.maxParallelGroup,
        notepadPath: flags["notepad-path"] || flags.notepadPath,
        mailboxThreadId: flags["mailbox-thread-id"] || flags.mailboxThreadId,
        worktreePath: flags["worktree-path"] || flags.worktreePath,
      },
      { note: flags.note },
    );
    printJson(task);
    return;
  }
  if (command === "run-once") {
    printJson(await runOnce({ store }));
    return;
  }
  if (command === "daemon") {
    await runDaemon({ store, intervalMs: parsePositiveInt(flags["interval-ms"], 300000), once: Boolean(flags.once) });
    return;
  }
  if (command === "mcp") {
    await startMcpStdio({ store });
    return;
  }
  printHelp();
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});

function parseFlags(args) {
  const flags = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      flags._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return flags;
}

function requiredFlag(flags, name) {
  const value = flags[name];
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printTable(tasks) {
  if (!tasks.length) {
    process.stdout.write("No tasks.\n");
    return;
  }
  for (const task of tasks) {
    process.stdout.write(`${task.id}\t${task.status}\tP${task.priority}\t${task.title}\n`);
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function printHelp() {
  process.stdout.write(`axi-todo

  Commands:
  add --title <title> --prompt <prompt> [--cwd <path>] [--verify-command <cmd>]
      [--agent-role sisyphus-junior] [--agent-category deep] [--execution-mode worker]
      [--model-hint MiniMax-M3] [--parallel-group group --max-parallel-group 4]
  list [--status <status>] [--json]
  show <task-id>
  delete <task-id>
  update <task-id> [--status <status>] [--note <text>]
  split [--goal <goal> | --from <task-id>] [--target-ready 24] [--cwd <path>] [--apply]
  ready [--limit 50]
  schedule [--limit 50]
  run-once
  daemon [--interval-ms 300000] [--once]
  mcp
`);
}
