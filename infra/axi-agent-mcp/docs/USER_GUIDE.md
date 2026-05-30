# MCP Swarm 用户指南

本文档说明如何在 Cursor 等 IDE 中使用 MCP Swarm 的 **Agent、工作流、技能** 以及常用 **MCP 工具**。

---

## 一、MCP 工具速览

### 1. 对话与任务分析

| 工具 | 说明 |
|------|------|
| `swarm_chat` | 自动选模型对话（根据任务类型选 qwen3-coder-next、qwen3-max 等） |
| `swarm_chat_with_model` | 指定模型对话 |
| `swarm_analyze_task` | 仅分析任务类型，返回推荐模型与置信度 |

### 2. 统计与运维

| 工具 | 说明 |
|------|------|
| `swarm_get_stats` | 成本/使用统计、熔断状态 |
| `swarm_get_metrics` | 响应时间、成功率等性能指标 |
| `swarm_get_logs` | 查询最近日志 |
| `swarm_reset_circuit_breaker` | 重置熔断器 |

### 3. 工作流

| 工具 | 说明 |
|------|------|
| `swarm_list_workflows` | 列出所有可用工作流 |
| `swarm_recommend_workflow` | 根据任务描述推荐工作流 |
| `swarm_execute_workflow` | 执行内置或自定义工作流 |
| `swarm_validate_workflow` | 校验工作流定义 |

### 4. Agent

| 工具 | 说明 |
|------|------|
| `swarm_list_agents` | 列出所有 Agent 角色 |
| `swarm_recommend_agent` | 根据任务描述推荐 Agent |

### 5. 技能

| 工具 | 说明 |
|------|------|
| `swarm_list_skills` | 列出所有技能 |
| `swarm_execute_skill` | 执行指定技能（如代码审查、文档生成） |

### 6. 质量门控

| 工具 | 说明 |
|------|------|
| `swarm_list_gates` | 列出质量门控 |
| `swarm_validate_with_gates` | 用门控校验输出（代码质量/安全/性能） |

### 7. 文件与代码库

| 工具 | 说明 |
|------|------|
| `swarm_read_file` / `swarm_write_file` / `swarm_modify_file` | 读/写/修改文件 |
| `swarm_list_directory` / `swarm_search_files` / `swarm_search_code` | 目录列表与搜索 |
| `swarm_build_index` | 构建代码库索引 |
| `swarm_analyze_workspace` | 分析工作区 |
| `swarm_detect_tech_stack` | 检测项目技术栈 |

### 8. Git 与 CI

| 工具 | 说明 |
|------|------|
| `swarm_git_status` | 仓库状态 |
| `swarm_git_commit` | 提交 |
| `swarm_git_create_branch` | 创建分支 |
| `swarm_generate_mr_description` | 生成 MR/PR 描述 |
| `swarm_run_lint` | 运行 Lint |
| `swarm_run_test` | 运行测试 |
| `swarm_autofix_lint` | 自动修复 Lint 问题 |

### 9. 数据库与向量

| 工具 | 说明 |
|------|------|
| `swarm_db_stats` | 数据库连接与统计 |
| `swarm_vector_search` | 向量相似度搜索（需 pgvector + Embedding API） |
| `swarm_vector_upsert` | 将文本向量化并写入向量库 |
| `swarm_cache_stats` | Redis 缓存统计 |
| `swarm_code_stats` | 代码存储统计（MongoDB） |

### 10. 并发

| 工具 | 说明 |
|------|------|
| `swarm_get_lock_stats` | 文件锁统计 |

---

## 二、Agent 使用

- **列出 Agent**：调用 `swarm_list_agents`，可按类别筛选。
- **推荐 Agent**：调用 `swarm_recommend_agent`，传入任务描述和可选的项目根路径（用于技术栈检测）。  
  返回推荐的主 Agent、置信度、理由和备选 Agent。

典型用法：先 `swarm_recommend_agent` 得到推荐，再在对话或工作流中“让该 Agent 执行任务”（通过 `swarm_chat_with_model` 或工作流里指定模型）。

---

## 三、工作流使用

- **列出工作流**：`swarm_list_workflows`，查看内置与分类。
- **推荐工作流**：`swarm_recommend_workflow`，传入任务描述和可选项目根路径。
- **执行工作流**：`swarm_execute_workflow`，传入 `workflowName`（内置名）或 `workflowDefinition`（YAML/对象）和 `input`。
- **校验定义**：`swarm_validate_workflow`，传入工作流定义字符串或对象。

内置工作流示例：`code_review`、`security_audit`、`bug_fix`、`data_analysis`、`documentation`、`performance_optimization` 等。

---

## 四、技能使用

- **列出技能**：`swarm_list_skills`，查看 id、名称、分类、输入输出说明。
- **执行技能**：`swarm_execute_skill`，传入 `skillId` 和 `input`（符合该技能的 inputSchema）。  
  例如：`code_review` 传入 `{ code, language, reviewFocus }`；`documentation` 传入 `{ topic, format }` 等。

技能由系统按需加载并调用对应 Agent/逻辑，适合“代码审查、文档生成、测试生成、安全检查、性能分析”等标准化任务。

---

## 五、质量门控

- **列出门控**：`swarm_list_gates`，查看 id、类型（quality_check / security_check / performance_check）、是否阻断。
- **校验输出**：`swarm_validate_with_gates`，传入要校验的文本或结构化结果，以及可选的门控 id 列表。  
  返回每道门控的通过情况、分数、问题与建议。可用于发布前检查代码质量、安全与性能。

---

## 六、向量搜索（pgvector + Embedding）

**前置条件**：PostgreSQL 已安装 pgvector；配置好 Embedding API（与 1536 维兼容）。

**配置示例（.env）**：

- `SWARM_EMBEDDING_API_BASE_URL`：Embedding 接口 base URL（不填则用 `SWARM_API_BASE_URL`）。
- `SWARM_EMBEDDING_MODEL` 或 `SWARM_EMBEDDING_MODEL_NAME`：模型名，如 `text-embedding-v3`。
- `SWARM_API_KEY` 或 `SWARM_EMBEDDING_API_KEY`：鉴权。

**使用**：

1. **写入向量**：`swarm_vector_upsert`，传入 `content` 和可选 `metadata`。系统将文本向量化后写入默认向量表。
2. **向量搜索**：`swarm_vector_search`，传入 `query` 和可选 `limit`。系统将 query 向量化后做相似度搜索并返回结果。

若未配置 Embedding API，`swarm_vector_search` 会返回友好错误并提示配置项。

---

## 七、运行与测试

- **启动 MCP 服务**：在项目根目录执行 `pnpm dev` 或 `pnpm exec tsx src/index.ts`，在 Cursor 中配置 MCP 使用该命令。
- **单元测试**：`pnpm test`（Vitest）。
- **数据库连接测试**：`pnpm exec tsx test-db-connection.ts`（需配置 .env 中的 DB_*）。

---

## 八、更多文档

- 多模型与任务类型规则：`.cursor/rules/multi-model-swarm.mdc`
- 工作流 DSL 与高级用法：`mcp-swarm/WORKFLOW_GUIDE.md`（若存在）
- 数据库配置与 pgvector 安装：`DATABASE_SETUP_GUIDE.md`、`DATABASE_SETUP_COMPLETE.md`
