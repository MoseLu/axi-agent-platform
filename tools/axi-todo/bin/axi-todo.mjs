#!/usr/bin/env node
import { runDaemon, runOnce } from "../lib/daemon.mjs";
import { startMcpStdio } from "../lib/mcp-server.mjs";
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
  list [--status <status>] [--json]
  show <task-id>
  delete <task-id>
  update <task-id> [--status <status>] [--note <text>]
  run-once
  daemon [--interval-ms 300000] [--once]
  mcp
`);
}
