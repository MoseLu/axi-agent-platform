/**
 * 验证通义 Embedding 模型是否可用
 * 运行: pnpm exec tsx verify-embedding.ts
 */
import { config } from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getEmbedding } from "./src/embedding-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, ".env") });

async function main() {
  console.log("🔍 验证向量模型（通义 Embedding）...\n");

  const baseUrl = process.env.SWARM_EMBEDDING_API_BASE_URL || process.env.SWARM_API_BASE_URL;
  const model = process.env.SWARM_EMBEDDING_MODEL || process.env.SWARM_EMBEDDING_MODEL_NAME;
  const hasKey = !!(process.env.SWARM_EMBEDDING_API_KEY || process.env.SWARM_API_KEY);

  console.log("配置:");
  console.log("  SWARM_EMBEDDING_API_BASE_URL:", baseUrl || "(未设置)");
  console.log("  SWARM_EMBEDDING_MODEL:", model || "(未设置)");
  console.log("  API Key:", hasKey ? "已设置" : "未设置");
  console.log("");

  if (!hasKey) {
    console.log("❌ 未配置 SWARM_EMBEDDING_API_KEY 或 SWARM_API_KEY");
    process.exit(1);
  }

  const testText = "向量模型验证测试：这是一段中文文本。";
  try {
    const embedding = await getEmbedding(testText);
    if (!embedding || !Array.isArray(embedding)) {
      console.log("❌ API 未返回有效向量");
      process.exit(1);
    }
    console.log("✅ 向量获取成功");
    console.log("   维度:", embedding.length);
    console.log("   前 5 维:", embedding.slice(0, 5).map((x) => x.toFixed(6)).join(", "));
    const expectedDim = parseInt(process.env.SWARM_EMBEDDING_DIMENSIONS || "1536", 10);
    if (embedding.length !== expectedDim) {
      console.log("⚠️ 维度与 SWARM_EMBEDDING_DIMENSIONS(" + expectedDim + ") 不一致，pgvector 表需使用相同维度");
    } else {
      console.log("   与配置维度一致，可用于 swarm_vector_search / swarm_vector_upsert");
    }
  } catch (e) {
    console.log("❌ 请求失败:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

main();
