/**
 * 仅测试 5 个指定模型（glm / kimi / MiniMax），快速验证
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname);

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
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);

  const models = ["glm-5", "glm-4.7", "kimi-k2.5", "MiniMax-M2.5"];
  const msg = "用一句话介绍你自己。";

  for (const model of models) {
    try {
      const res = await client.callTool({
        name: "swarm_chat_with_model",
        arguments: { model, message: msg },
      });
      const text = getText(res);
      const ok = !res?.isError && text;
      console.log(model + ":", ok ? "OK - " + (text.slice(0, 80) + (text.length > 80 ? "..." : "")) : "FAIL - " + (text || "无回复"));
    } catch (e) {
      console.log(model + ": ERROR - " + e.message);
    }
  }

  await transport.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
