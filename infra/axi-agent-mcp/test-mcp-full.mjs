/**
 * MCP 完整流程测试（并行优化版）
 * 运行: node test-mcp-full.mjs（需在 mcp-swarm 目录下执行，且已 pnpm build）
 *
 * 优化思路：在 QPS 允许的前提下，用「并行批」代替「全串行」，缩短总耗时、避免超时。
 * - 总 API 调用数不变（4 次 swarm_chat + 8 次 swarm_chat_with_model），
 * - 每批并发 BATCH_SIZE 个请求，批与批之间顺序执行。
 * - 总耗时 ≈ (批数) × (单次 API 响应时间)，单次约 5–15s，批内并行故一批约 1× 单次。
 *
 * 环境变量：
 * - BATCH_SIZE=4  每批并发数，默认 4。API 若 QPS 低可改为 2 或 1（等价串行）。
 * - QUICK=1       只测 4 个指定模型，总批数更少。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname);

const BATCH_SIZE = Math.max(1, parseInt(process.env.BATCH_SIZE || "4", 10) || 4);

function log(title, data) {
  console.log("\n" + "=".repeat(60));
  console.log(" " + title);
  console.log("=".repeat(60));
  if (typeof data === "string") console.log(data);
  else console.log(JSON.stringify(data, null, 2));
}

function getText(result) {
  const content = result?.content;
  if (!content || !Array.isArray(content)) return "";
  const text = content.find((c) => c.type === "text");
  return text?.text ?? "";
}

/** 将数组按 size 分批 */
function batch(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [resolve(projectRoot, "dist/index.js")],
    cwd: projectRoot,
  });

  const client = new Client({ name: "mcp-swarm-test", version: "1.0.0" });

  log("1. 连接 MCP 服务", "connecting...");
  await client.connect(transport);
  log("1. 连接 MCP 服务", "connected. Server: " + (client.getServerVersion()?.name ?? "unknown") + " | BATCH_SIZE=" + BATCH_SIZE);

  const toolsRes = await client.listTools();
  const toolNames = (toolsRes?.tools ?? []).map((t) => t.name);
  log("2. 列出工具", toolNames);

  // ---------- swarm_analyze_task：无 API，一次性并行 ----------
  const analyzeInputs = [
    { msg: "用 TypeScript 写一个防抖函数", label: "代码" },
    { msg: "分析一下这个项目的架构设计", label: "推理" },
    { msg: "写一份 README 文档说明", label: "中文文档" },
    { msg: "给这个界面做 UI 设计建议", label: "创意" },
  ];

  const analyzeResults = await Promise.all(
    analyzeInputs.map(({ msg, label }) =>
      client.callTool({ name: "swarm_analyze_task", arguments: { message: msg } }).then((res) => ({ label, text: getText(res), res }))
    )
  );
  for (const { label, text } of analyzeResults) {
    log("3. 任务分析: " + label, text);
  }

  // ---------- swarm_chat：按批并行 ----------
  const chatInputs = [
    { msg: "用一句话说明什么是防抖。", label: "通用" },
    { msg: "用 TypeScript 写一个简单的 debounce 函数，不超过 10 行。", label: "代码" },
    { msg: "用一句话分析：微前端和单体前端在架构上的主要区别。", label: "推理" },
    { msg: "用一句话写一段项目简介，适合放在 README 里。", label: "文档" },
  ];

  const chatBatches = batch(chatInputs, BATCH_SIZE);
  for (let i = 0; i < chatBatches.length; i++) {
    const results = await Promise.all(
      chatBatches[i].map(({ msg, label }) =>
        client.callTool({ name: "swarm_chat", arguments: { message: msg } }).then((res) => ({ label, text: getText(res), res }))
      )
    );
    for (const { label, text, res } of results) {
      const preview = text.length > 400 ? text.slice(0, 400) + "\n..." : text;
      log("4. swarm_chat: " + label, preview || (res?.isError ? "Error" : ""));
    }
  }

  // ---------- swarm_chat_with_model：按批并行 ----------
  const quick = process.env.QUICK === "1";
  const models = quick
    ? ["qwen3.5-plus", "qwen3-coder-next", "glm-5", "kimi-k2.5"]
    : [
        "qwen3.5-plus",
        "qwen3-coder-next",
        "qwen3-coder-plus",
        "qwen3-max-2026-01-23",
        "glm-5",
        "glm-4.7",
        "kimi-k2.5",
        "MiniMax-M2.5",
      ];
  if (quick) console.log("\n(QUICK=1: 仅测 4 个模型)\n");

  const testMessage = "请用一句话介绍你自己（模型名或能力均可）。";
  const modelBatches = batch(models, BATCH_SIZE);

  for (let i = 0; i < modelBatches.length; i++) {
    const results = await Promise.all(
      modelBatches[i].map((model) =>
        client
          .callTool({ name: "swarm_chat_with_model", arguments: { model, message: testMessage } })
          .then((res) => ({ model, text: getText(res), ok: !res?.isError && getText(res), res }))
          .catch((e) => ({ model, text: "", ok: false, error: e.message }))
      )
    );
    for (const { model, text, ok, error } of results) {
      const preview = ok ? (text.length > 200 ? text.slice(0, 200) + "..." : text) : (error || "API 错误 / 无回复");
      log("5. 指定模型: " + model, ok ? "OK - " + preview : "FAIL - " + preview);
    }
  }

  await transport.close();
  log("完成", "MCP 完整流程测试结束。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
