import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMcpServer, toolDefinitions } from "../lib/mcp-server.mjs";
import { TaskStore } from "../lib/store.mjs";

test("tool definitions expose core axi-todo operations", () => {
  const names = toolDefinitions().map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "axi_todo_add_task",
    "axi_todo_delete_task",
    "axi_todo_get_task",
    "axi_todo_list_tasks",
    "axi_todo_ready_tasks",
    "axi_todo_run_once",
    "axi_todo_schedule_tasks",
    "axi_todo_split_task",
    "axi_todo_update_task",
  ]);
  const addProperties = toolDefinitions().find((tool) => tool.name === "axi_todo_add_task").inputSchema.properties;
  assert.deepEqual(addProperties.agentCategory.enum, [
    "visual-engineering",
    "ultrabrain",
    "deep",
    "artistry",
    "quick",
    "unspecified-low",
    "unspecified-high",
    "writing",
  ]);
  assert.equal(addProperties.modelHint.type, "string");
  assert.equal(addProperties.maxParallelGroup.type, "number");
});

test("mcp server can add and list tasks", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-mcp-"));
  const store = new TaskStore({ home });
  const server = createMcpServer({ store });
  const add = await server.handle({
    method: "tools/call",
    params: {
      name: "axi_todo_add_task",
      arguments: {
        title: "MCP task",
        prompt: "Do it",
        cwd: home,
        agentRole: "sisyphus-junior",
        agentCategory: "quick",
        executionMode: "worker",
        modelHint: "MiniMax-M2.7-highspeed",
        parallelGroup: "mcp:quick",
        maxParallelGroup: 4,
      },
    },
  });
  assert.match(add.content[0].text, /MCP task/);
  const added = JSON.parse(add.content[0].text);
  assert.equal(added.agentRole, "sisyphus-junior");
  assert.equal(added.agentCategory, "quick");
  assert.equal(added.modelHint, "MiniMax-M2.7-highspeed");

  const list = await server.handle({
    method: "tools/call",
    params: { name: "axi_todo_list_tasks", arguments: {} },
  });
  assert.match(list.content[0].text, /MCP task/);

  const deleted = await server.handle({
    method: "tools/call",
    params: { name: "axi_todo_delete_task", arguments: { id: added.id } },
  });
  assert.match(deleted.content[0].text, /MCP task/);
});

test("mcp server can split tasks without applying by default", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-mcp-split-"));
  const store = new TaskStore({ home });
  const server = createMcpServer({ store });
  const split = await server.handle({
    method: "tools/call",
    params: {
      name: "axi_todo_split_task",
      arguments: { goal: "Improve scheduling", cwd: home, targetReady: 4 },
    },
  });
  const plan = JSON.parse(split.content[0].text);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.tasks.length, 4);
  assert.equal((await store.listTasks()).length, 0);
});
