/**
 * 快速测试：用 .env 配置请求一次聊天 API
 * 运行: node test-api.mjs
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, ".env") });

const base = (process.env.SWARM_API_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const path = (process.env.SWARM_CHAT_PATH || "/api/chat").replace(/^\//, "");
const url = `${base}/${path}`;
const apiKey = process.env.SWARM_API_KEY || "";

console.log("请求 URL:", url);
console.log("Authorization:", apiKey ? apiKey.slice(0, 20) + "..." : "(未设置)");
console.log("");

const body = {
  model: "qwen3.5-plus",
  messages: [{ role: "user", content: "只说一句话：你好" }],
  temperature: 0.3,
  max_tokens: 100,
};

const headers = { "Content-Type": "application/json" };
if (apiKey) headers["Authorization"] = apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;

try {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.log("状态:", res.status, res.statusText);
    console.log("响应:", JSON.stringify(data, null, 2));
    process.exit(1);
  }

  const content = data?.choices?.[0]?.message?.content ?? data?.content ?? data?.data?.choices?.[0]?.message?.content;
  console.log("成功");
  console.log("回复:", content ?? "(无 content)");
  if (data?.model) console.log("模型:", data.model);
} catch (e) {
  console.error("请求异常:", e.message);
  process.exit(1);
}
