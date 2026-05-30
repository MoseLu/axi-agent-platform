/**
 * 逐个测试全部 8 个模型各一次，排除模型本身问题（串行执行，便于定位哪个模型异常）
 * 运行: node test-all-models.mjs
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname);

const MODELS = [
  "qwen3.5-plus",
  "qwen3-max-2026-01-23",
  "qwen3-coder-next",
  "qwen3-coder-plus",
  "MiniMax-M2.5",
  "glm-5",
  "glm-4.7",
  "kimi-k2.5",
];

const TEST_MESSAGE = "回复：OK";

function getText(result) {
  const content = result?.content;
  if (!content || !Array.isArray(content)) return "";
  const text = content.find((c) => c.type === "text");
  return text?.text ?? "";
}

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [resolve(projectRoot, "dist/index.js")],
    cwd: projectRoot,
  });
  const client = new Client({ name: "test-all-models", version: "1.0.0" });

  console.log("连接 MCP 服务...");
  await client.connect(transport);
  console.log("已连接。逐个测试 8 个模型（串行）\n");

  const results = [];

  for (const model of MODELS) {
    const start = Date.now();
    try {
      const res = await client.callTool({
        name: "swarm_chat_with_model",
        arguments: { model, message: TEST_MESSAGE },
      });
      const text = getText(res);
      const ok = !res?.isError && text;
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      if (ok) {
        const preview = text.length > 80 ? text.slice(0, 80).replace(/\n/g, " ") + "..." : text.replace(/\n/g, " ");
        results.push({ model, status: "OK", elapsed: elapsed + "s", detail: preview });
        console.log(`  [OK]  ${model.padEnd(28)} ${elapsed}s  ${preview}`);
      } else {
        const err = res?.content?.[0]?.text || (res?.isError ? "API/Error" : "无 content");
        results.push({ model, status: "FAIL", elapsed: elapsed + "s", detail: err });
        console.log(`  [FAIL] ${model.padEnd(26)} ${elapsed}s  ${String(err).slice(0, 60)}`);
      }
    } catch (e) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      results.push({ model, status: "ERROR", elapsed: elapsed + "s", detail: e.message });
      console.log(`  [ERROR] ${model.padEnd(25)} ${elapsed}s  ${e.message}`);
    }
  }

  await transport.close();

  const okCount = results.filter((r) => r.status === "OK").length;
  console.log("\n" + "=".repeat(60));
  console.log(`合计: ${okCount}/${MODELS.length} 通过`);
  if (okCount < MODELS.length) {
    const failed = results.filter((r) => r.status !== "OK");
    console.log("未通过:", failed.map((r) => r.model + " (" + r.status + ")").join(", "));
  }
  console.log("=".repeat(60));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
