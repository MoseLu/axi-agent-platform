# Axi Agent MCP

Axi Agent 的 MCP service owner。根据任务内容自动选择模型并调用你的 API，与 `.cursor/rules/multi-model-swarm.mdc` 规则一致。**MiniMax-M2.5** 已并入蜂群（创意专家），可配置独立 API（`SWARM_MINIMAX_*`），与统一 API 并行使用。

工具分组和平台集成边界见 [`docs/axi-agent-mcp-service-contract.md`](docs/axi-agent-mcp-service-contract.md)。

## 支持的模型

| 模型 | 角色 |
|------|------|
| qwen3.5-plus | 通用助手 |
| qwen3-max-2026-01-23 | 推理分析师 |
| qwen3-coder-next | 主力代码专家 |
| qwen3-coder-plus | 代码工程师 |
| MiniMax-M2.5 | 创意专家 |
| glm-5 | 中文专家 |
| glm-4.7 | 平衡助手 |
| kimi-k2.5 | 文档专家 |

## 安装与运行

```bash
cd axi-agent-mcp
pnpm install
cp .env.example .env
# 编辑 .env 填写 SWARM_API_BASE_URL 和（如需要）SWARM_API_KEY
pnpm build
pnpm start
```

开发时可直接用：

```bash
pnpm dev
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| SWARM_API_BASE_URL | 否 | 统一 API 基础地址，默认 `http://localhost:3000` |
| SWARM_CHAT_PATH | 否 | 统一 API 聊天路径，默认 `/api/chat` |
| SWARM_API_KEY | 否 | 统一 API 密钥，会作为 `Authorization: Bearer <key>` 发送 |
| SWARM_MINIMAX_API_BASE_URL | 否 | **MiniMax 独立 API** 基础地址（如 `https://api.minimaxi.com/v1`），配置后蜂群中创意任务与指定 MiniMax-M2.5 时走此地址 |
| SWARM_MINIMAX_API_KEY | 否 | MiniMax API 密钥 |
| SWARM_MINIMAX_CHAT_PATH | 否 | MiniMax 聊天路径，建议 `chat/completions`（base 已含 `/v1` 时） |

## API 约定

服务会向 `{SWARM_API_BASE_URL}{SWARM_CHAT_PATH}` 发送 POST 请求，期望 **OpenAI 兼容** 的请求体：

```json
{
  "model": "qwen3-coder-next",
  "messages": [{"role": "user", "content": "..."}],
  "temperature": 0.5,
  "max_tokens": 4096
}
```

响应需包含回复内容，例如：

- `response.choices[0].message.content`，或
- `response.content`

若你的 API 格式不同，可修改 `src/api-client.ts` 适配。

## 在 Cursor 中配置 MCP

### 方式一：项目级配置（推荐，仅本工作区可用）

本仓库已在 **工作区** 配置好 MCP，路径为：

**`e:\\app\\.cursor\\mcp.json`**

内容为：

```json
{
  "mcpServers": {
    "axi-agent-mcp": {
      "command": "node",
      "args": ["axi-agent-mcp/dist/index.js"]
    }
  }
}
```

- 用 Cursor 打开 **`e:\\app`** 时，MCP 会按上述配置启动，无需改全局设置。
- 环境变量从 **`axi-agent-mcp/.env`** 读取（复制 `.env.example` 为 `.env` 并填写 `SWARM_API_BASE_URL`、`SWARM_API_KEY` 等）。
- 可将 `.cursor/mcp.json` 提交到 Git，团队拉取后即可使用。

### 方式二：全局配置（所有项目可用）

在用户目录的 Cursor 配置里添加（如 `C:\\Users\\你的用户名\\.cursor\\mcp.json`）：

```json
{
  "mcpServers": {
    "axi-agent-mcp": {
      "command": "node",
      "args": ["E:\\app\\axi-agent-mcp\\dist\\index.js"],
      "env": {
        "SWARM_API_BASE_URL": "https://your-api.example.com",
        "SWARM_API_KEY": "your-api-key"
      }
    }
  }
}
```

3. 重启 Cursor 或重新加载 MCP 后，在对话中可让 AI 使用 **axi-agent-mcp** 提供的工具：
   - **swarm_chat**：自动选模型并对话
   - **swarm_chat_with_model**：指定模型对话
   - **swarm_analyze_task**：仅分析任务类型与推荐模型

## 提供的 MCP 工具

| 工具 | 说明 |
|------|------|
| `swarm_chat` | 根据 `message` 自动识别任务类型、选择模型并调用 API，失败时按规则降级 |
| `swarm_chat_with_model` | 使用指定 `model` 调用 API |
| `swarm_analyze_task` | 仅分析 `message` 对应的任务类型与推荐/备选模型，不发起请求 |

## 更多文档与测试

- **用户指南**（Agent / 工作流 / 技能 / 向量搜索 / 质量门控）：[docs/USER_GUIDE.md](docs/USER_GUIDE.md)
- **单元测试与集成测试**：`pnpm test`（Vitest）
- **数据库连接测试**：`pnpm exec tsx test-db-connection.ts`

## 测试脚本与 QPS/超时优化

完整流程测试 `test-mcp-full.mjs` 已做**并行批处理**，在固定 QPS 下缩短总耗时、避免超时：

- **思路**：多轮 API 调用不再全串行，而是每批并发 `BATCH_SIZE` 个请求，批与批顺序执行；总耗时 ≈ 批数 × 单次响应时间。
- **环境变量**：
  - `BATCH_SIZE=4`（默认）：每批 4 个并发。API 若 QPS 较低（如 2），可改为 `BATCH_SIZE=2` 或 `1`（串行）。
  - `QUICK=1`：只测 4 个指定模型，进一步缩短时间。

```bash
# 完整测试（约 1.5 分钟内完成，BATCH_SIZE=4）
node test-mcp-full.mjs

# 控制并发以适配 API QPS
BATCH_SIZE=2 node test-mcp-full.mjs

# 快速测试（约 50 秒）
QUICK=1 node test-mcp-full.mjs
```

PowerShell 设置环境变量示例：`$env:BATCH_SIZE="2"; node test-mcp-full.mjs`
