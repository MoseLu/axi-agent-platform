import { runOnce } from "./daemon.mjs";
import { createSplitPlan } from "./planner.mjs";
import { createStoreFromEnv } from "./store.mjs";

export function createMcpServer({ store = createStoreFromEnv() } = {}) {
  return {
    async handle(request) {
      if (request.method === "initialize") {
        return {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "axi-todo", version: "0.1.0" },
        };
      }
      if (request.method === "notifications/initialized") {
        return undefined;
      }
      if (request.method === "tools/list") {
        return { tools: toolDefinitions() };
      }
      if (request.method === "tools/call") {
        return callTool(store, request.params || {});
      }
      return {};
    },
  };
}

export async function startMcpStdio({ store = createStoreFromEnv(), input = process.stdin, output = process.stdout } = {}) {
  const server = createMcpServer({ store });
  let buffer = Buffer.alloc(0);
  input.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let request;
    while ((request = nextFrame()) !== null) {
      void handleRequest(request);
    }
  });
  input.resume();

  async function handleRequest(request) {
    try {
      const result = await server.handle(request);
      if (request.id !== undefined && result !== undefined) {
        writeFrame(output, { jsonrpc: "2.0", id: request.id, result });
      }
    } catch (error) {
      if (request.id !== undefined) {
        writeFrame(output, {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32000, message: error?.message || String(error) },
        });
      }
    }
  }

  function nextFrame() {
    const separator = Buffer.from("\r\n\r\n");
    const headerEnd = buffer.indexOf(separator);
    if (headerEnd === -1) return null;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const lengthLine = header.split("\r\n").find((line) => line.toLowerCase().startsWith("content-length:"));
    if (!lengthLine) {
      buffer = buffer.subarray(headerEnd + separator.length);
      return null;
    }
    const length = Number.parseInt(lengthLine.split(":").slice(1).join(":").trim(), 10);
    if (!Number.isFinite(length)) {
      buffer = buffer.subarray(headerEnd + separator.length);
      return null;
    }
    const bodyStart = headerEnd + separator.length;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return null;
    const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.subarray(bodyEnd);
    return JSON.parse(body);
  }
}

export function writeFrame(output, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  output.write(`Content-Length: ${body.length}\r\n\r\n`);
  output.write(body);
}

export function toolDefinitions() {
  return [
    {
      name: "axi_todo_add_task",
      description: "Create a local task for the axi-todo daemon to execute with Codex.",
      inputSchema: {
        type: "object",
        properties: taskInputProperties(),
        required: ["title", "prompt"],
      },
    },
    {
      name: "axi_todo_list_tasks",
      description: "List local axi-todo tasks, optionally filtered by status.",
      inputSchema: {
        type: "object",
        properties: { status: { type: "string" } },
      },
    },
    {
      name: "axi_todo_ready_tasks",
      description: "List pending tasks that are currently schedulable after dependency and resource-lock checks.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number" } },
      },
    },
    {
      name: "axi_todo_schedule_tasks",
      description: "Preview the deterministic scheduler selection and blocked-task reasons.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number" } },
      },
    },
    {
      name: "axi_todo_get_task",
      description: "Get one local axi-todo task by id.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "axi_todo_update_task",
      description: "Update a local axi-todo task status or fields.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          ...taskInputProperties(),
          status: { type: "string", enum: ["pending", "running", "completed", "failed", "blocked", "cancelled"] },
          note: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "axi_todo_delete_task",
      description: "Delete a local axi-todo task from the store.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "axi_todo_run_once",
      description: "Run one daemon tick: recheck completed tasks, claim one pending task, and execute it with Codex.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "axi_todo_split_task",
      description: "Split a goal or parent task into graph-ready child tasks. Defaults to dry run; pass apply=true to write tasks.",
      inputSchema: {
        type: "object",
        properties: {
          goal: { type: "string" },
          from: { type: "string" },
          cwd: { type: "string" },
          targetReady: { type: "number" },
          verifyCommand: { type: "string" },
          priority: { type: "number" },
          resourcePrefix: { type: "string" },
          apply: { type: "boolean" },
        },
      },
    },
  ];
}

async function callTool(store, params) {
  const name = params.name;
  const args = params.arguments || {};
  if (name === "axi_todo_add_task") {
    return textResult(await store.addTask(args));
  }
  if (name === "axi_todo_list_tasks") {
    return textResult(await store.listTasks({ status: args.status }));
  }
  if (name === "axi_todo_ready_tasks") {
    return textResult(await store.listReadyTasks({ limit: args.limit }));
  }
  if (name === "axi_todo_schedule_tasks") {
    return textResult(await store.scheduleTasks({ limit: args.limit }));
  }
  if (name === "axi_todo_get_task") {
    const task = await store.getTask(args.id);
    if (!task) throw new Error(`unknown task: ${args.id}`);
    return textResult(task);
  }
  if (name === "axi_todo_update_task") {
    const { id, note, ...patch } = args;
    return textResult(await store.updateTask(id, patch, { note }));
  }
  if (name === "axi_todo_delete_task") {
    return textResult(await store.deleteTask(args.id));
  }
  if (name === "axi_todo_run_once") {
    return textResult(await runOnce({ store }));
  }
  if (name === "axi_todo_split_task") {
    const parent = args.from ? await store.getTask(args.from) : null;
    if (args.from && !parent) throw new Error(`unknown parent task: ${args.from}`);
    const plan = createSplitPlan({
      goal: args.goal || parent?.prompt || parent?.title,
      cwd: args.cwd || parent?.cwd || process.cwd(),
      targetReady: args.targetReady,
      verifyCommand: args.verifyCommand || parent?.verifyCommand,
      priority: args.priority ?? parent?.priority,
      parentId: parent?.id || args.from,
      resourcePrefix: args.resourcePrefix,
    });
    if (!args.apply) return textResult({ dryRun: true, ...plan });
    const created = [];
    for (const taskInput of plan.tasks) {
      created.push(await store.addTask(taskInput));
    }
    return textResult({ dryRun: false, created: created.map((task) => task.id), ...plan });
  }
  throw new Error(`unknown tool: ${name}`);
}

function taskInputProperties() {
  return {
    title: { type: "string" },
    prompt: { type: "string" },
    cwd: { type: "string" },
    priority: { type: "number" },
    maxAttempts: { type: "number" },
    dueAt: { type: "string" },
    verifyCommand: { type: "string" },
    parentId: { type: "string" },
    dependsOn: { type: "array", items: { type: "string" } },
    resourceKeys: { type: "array", items: { type: "string" } },
    taskKind: { type: "string", enum: ["task", "inspect", "edit", "test", "verify", "doc", "research"] },
    estimatedCostPercent: { type: "number" },
    riskLevel: { type: "string", enum: ["low", "medium", "high"] },
    plannerConfidence: { type: "number" },
    evidenceContract: { type: "string" },
    agentRole: {
      type: "string",
      enum: [
        "sisyphus",
        "prometheus",
        "atlas",
        "sisyphus-junior",
        "hephaestus",
        "oracle",
        "librarian",
        "explore",
        "metis",
        "momus",
        "multimodal-looker",
      ],
    },
    agentCategory: {
      type: "string",
      enum: ["visual-engineering", "ultrabrain", "deep", "artistry", "quick", "unspecified-low", "unspecified-high", "writing"],
    },
    executionMode: { type: "string", enum: ["plan", "inspect", "worker", "verify", "consult", "write"] },
    modelHint: { type: "string" },
    fallbackModels: { type: "array", items: { type: "string" } },
    parallelGroup: { type: "string" },
    maxParallelGroup: { type: "number" },
    notepadPath: { type: "string" },
    mailboxThreadId: { type: "string" },
    worktreePath: { type: "string" },
  };
}

function textResult(value) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}
