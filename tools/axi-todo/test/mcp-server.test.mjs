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
    "axi_todo_run_once",
    "axi_todo_update_task",
  ]);
});

test("mcp server can add and list tasks", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "axi-todo-mcp-"));
  const store = new TaskStore({ home });
  const server = createMcpServer({ store });
  const add = await server.handle({
    method: "tools/call",
    params: {
      name: "axi_todo_add_task",
      arguments: { title: "MCP task", prompt: "Do it", cwd: home },
    },
  });
  assert.match(add.content[0].text, /MCP task/);

  const list = await server.handle({
    method: "tools/call",
    params: { name: "axi_todo_list_tasks", arguments: {} },
  });
  assert.match(list.content[0].text, /MCP task/);

  const deleted = await server.handle({
    method: "tools/call",
    params: { name: "axi_todo_delete_task", arguments: { id: JSON.parse(add.content[0].text).id } },
  });
  assert.match(deleted.content[0].text, /MCP task/);
});
