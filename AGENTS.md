# Axi Agent Platform — 项目根级 AGENTS

> 本文件是 **`/Volumes/code/workspace/projects/axi-agent-platform` 仓库根级** AGENTS，是进入本仓库的 agent 第一站。
> 子模块（后端、前端、`infra/axi-agent-mcp`、升级方案镜像）的内部约束在各自的目录文件里，详见「Authoritative Sources」。
> **两者的关系：根级 AGENTS = 项目门面与边界；子模块文件 = 实现与契约。** 任何对 `backend/`、`frontend/`、`infra/` 的修改必须先读对应子模块的文档；任何对仓库整体结构、升级方案、跨项目边界的判断必须先读本文件。

---

## Scope

- **适用对象**：所有 agent（包括 Codex、Cursor、自动化扫描器、文档巡检子代理）首次接触本仓库时。
- **不适用对象**：`backend/chroma_db/`、`backend/axi_agent_platform.db`、`backend/projects/`、`frontend/dist/`、`backend/__pycache__/` 等运行时 / 构建产物目录。
- **阅读顺序**：本文件 → `README.zh-CN.md`（产品门面）→ `UPGRADE_v1.1.0.zh-CN.md`（SubAgent 升级说明）→ `infra/axi-agent-mcp/README.zh-CN.md`（MCP 蜂群）→ `upgrade-plan.zh-CN.md`（仅按需查阅「与 subAgent 结合」可行性分析）。

---

## Project Boundary

Axi Agent Platform 是 **「通用多智能体协作 + SubAgent 代码开发模式 + MCP 模型蜂群」三合一** 的项目：

1. **通用协作模式（OpenAI Swarm 风）**：任务自主交接、并行协作、LangChain 工具集成、Chroma 长期记忆。
2. **SubAgent 代码开发模式（v1.1.0）**：Planner / Worker / Judge 三层角色分工，`CodeIsolationManager` 基于 **Git worktrees** 做代码环境隔离，支持规划 → 实现 → 审查 → 测试 → 评审的完整流程。
3. **MCP 模型蜂群（`infra/axi-agent-mcp`）**：多模型路由服务（qwen3.5-plus / qwen3-coder-next / MiniMax-M2.5 / glm-5 / kimi-k2.5 等），与 `.cursor/rules/multi-model-swarm.mdc` 规则一致，对外暴露 MCP 工具。

**项目边界**（即本 agent 的修改半径）：

| 路径 | 是否项目内 | 说明 |
|------|------------|------|
| `backend/app/core/`、`backend/app/api/`、`backend/app/schemas/`、`backend/app/models/`、`backend/app/tools/` | 是 | 主体 Python 实现，包含 `code_isolation_manager.py`（SubAgent 核心）、`subagent.py`（SubAgent API 路由）、`swarm_orchestrator.py`（蜂群编排） |
| `frontend/src/` | 是 | React 18 + TypeScript + Tailwind + Zustand + Recharts；含 `pages/SubAgent.tsx` 管理页面 |
| `infra/axi-agent-mcp/` | 是 | MCP 蜂群服务（独立 Node.js 子项目），规则在 `infra/axi-agent-mcp/README.zh-CN.md` |
| `tools/axi-todo/` | 是 | 内部 CLI 工具 |
| `docs/project-docs.manifest.json`、`docs/PRD.md`、`docs/TDD.md`、`docs/MEMORY.md`、`docs/ADR/` | 是 | 项目门面与决策档案 |
| `README.zh-CN.md`、`UPGRADE_v1.1.0.zh-CN.md`、`upgrade-plan.zh-CN.md` | 是 | 根级文档的简体中文身份镜像（i18n mirror） |
| `README.md`、`UPGRADE_v1.1.0.md`、`升级方案.md`、`参考.md` | 是 | 源语言（中文）文档；本仓库 i18n 的「源」 |
| `infra/axi-agent-mcp/docs/axi-agent-mcp-service-contract.md` | 是 | MCP 蜂群服务契约，跨项目边界前必读 |
| `references/*`（工作区级） | 否 | 由 `infra/axi-workspace-governance/` 治理，本项目不翻译、不编辑 |
| `backend/chroma_db/`、`backend/axi_agent_platform.db` | 否 | 运行时数据目录，不入版本控制 |
| `backend/projects/` | 否 | SubAgent 模式的 worktree 根目录（受 `REPOSITORY_PATH` 控制），不入版本控制 |

**不要**把 `references/*` 或工作区治理镜像当作本项目的可写范围。

---

## Authoritative Sources

| 议题 | 权威来源 |
|------|----------|
| 产品门面（用户可见的产品说明、角色、API、配置） | [`README.zh-CN.md`](README.zh-CN.md) |
| SubAgent 模式升级说明（v1.1.0 新增角色、worktree、API、配置） | [`UPGRADE_v1.1.0.zh-CN.md`](UPGRADE_v1.1.0.zh-CN.md) |
| SubAgent API 环境变量（`REPOSITORY_PATH` / `MAX_WORKTREES` / `MAX_PARALLEL_AGENTS` / `DEFAULT_BASE_BRANCH` / `WORKTREES_CLEANUP_HOURS`） | `UPGRADE_v1.1.0.zh-CN.md` §「环境变量配置」与 [`README.zh-CN.md`](README.zh-CN.md) §「SubAgent 模式配置」 |
| MCP 模型蜂群（模型路由、工具分组、服务契约） | [`infra/axi-agent-mcp/README.zh-CN.md`](infra/axi-agent-mcp/README.zh-CN.md)、[`infra/axi-agent-mcp/docs/axi-agent-mcp-service-contract.md`](infra/axi-agent-mcp/docs/axi-agent-mcp-service-contract.md) |
| 与 Cursor subAgent 结合的可行性分析 | [`upgrade-plan.zh-CN.md`](upgrade-plan.zh-CN.md)（B6c 已建，请直接跳转，**不要照抄正文**） |
| 安全策略 | [`SECURITY.md`](SECURITY.md) |
| 项目待办与路线图 | `TODO.md`（仓库根级） |
| 文档清单与责任归属 | [`docs/project-docs.manifest.json`](docs/project-docs.manifest.json) |
| 变更历史 | `CHANGELOG.md`（仓库根级） |
| 工作区治理镜像 | 工作区级 `infra/axi-workspace-governance/`（只读，权威源在本仓库外） |

> **优先级冲突时**：根级 `AGENTS.md` > `README.zh-CN.md` / `UPGRADE_v1.1.0.zh-CN.md` > 子模块内部 AGENTS / 契约文档 > 治理镜像 > 个人记忆。

---

## Cross-Project Boundary

- **不翻译**：`references/*`、`references/archives/*`、`infra/axi-workspace-governance/references/*`、`infra/axi-workspace-governance/temp/*`。
- **不复制内容到本项目**：工作区其他项目的 README、AGENTS、ADR 都不应被原样搬入本仓库；本项目只承载「Axi Agent Platform 自身产品 + 升级方案」的内容。
- **不假装是源**：源语言（中文）文档是本仓库 i18n 的「源」；简体中文 `*.zh-CN.md` 镜像只是为满足工作区 i18n 校验脚本的最小差异化要求，**不替代**源文档的权威地位。源说明文档（如 `升级方案.md`）的简体中文镜像（如 `upgrade-plan.zh-CN.md`）已由 B6c 落地，**直接跳转**到源即可，不要再次回写正文。
- **可消费**：通过 workspace graph（`workspace-project`）查询 `axi-agent-platform` 的 `consumes` / `consumers` / `provides` / `contracts`；不要在业务代码里硬编码跨项目绝对路径。
- **可被消费**：本项目以 MCP 模型蜂群（`infra/axi-agent-mcp` 暴露的 `axi_agent_*` 工具）、SubAgent REST API（`/subagent/*` 路由）、Web 前端构建产物形式对外提供能力。

---

## SubAgent API 速查（环境变量）

以下变量在 `UPGRADE_v1.1.0.zh-CN.md` 与 `README.zh-CN.md` 均有完整说明，**实际取值与默认值以源文档为权威**：

| 变量 | 含义 | 默认 |
|------|------|------|
| `REPOSITORY_PATH` | SubAgent 模式的代码仓库根目录（worktree 根） | `./projects` |
| `MAX_WORKTREES` | 最大 worktree 数量 | `10` |
| `MAX_PARALLEL_AGENTS` | 最大并行智能体数 | `8` |
| `DEFAULT_BASE_BRANCH` | 默认基础分支 | `main` |
| `WORKTREES_CLEANUP_HOURS` | worktree 自动清理时间（小时） | `24` |

> 修改这些变量前先读 `UPGRADE_v1.1.0.zh-CN.md` §「环境变量配置」与 `backend/app/core/code_isolation_manager.py` 实际消费点。

---

## Windows 路径与 i18n 镜像策略

- **Windows 路径保留原样（F5 决策）**：在工作区 i18n 镜像中，Windows 风格的路径（如 `venv\Scripts\activate`、`C:\Users\...`）**不做规范化**——保留反斜杠、保留盘符。原因是工作区 i18n 校验脚本（`infra/axi-workspace-governance/scripts/verify_doc_i18n.py`）以反引号 token multiset、内联反引号集合、行内标记集合等做不变量校验；若把 `\` 改写为 `/`、把 `C:\Users\foo` 改写为 POSIX 形式，会破坏 token multiset，触发 false-negative「未翻译」告警。
- **i18n 镜像的最小差异化**：简体中文 `*.zh-CN.md` 文件在顶部追加「关于本镜像（i18n note）」段，**正文逐字保留**源文档（代码块段数、链接集合、行内反引号标记集合、大写蛇形命名标记集合均与源完全一致）。源文档更新时同步更新镜像的对应正文（不含顶部 i18n 注释）。
- **token multiset 不变量**：回引号标记、大写蛇形名（`REPOSITORY_PATH`、`MAX_WORKTREES`）、链接路径、代码块行数在源与镜像之间必须一致。任何 i18n 改动后请在提交前先跑 `verify_doc_i18n` 校验。
- 详细决策记录见 `infra/axi-workspace-governance/docs/` 中的 F5 决策条目（若该文件尚未落地，由工作区治理 owner 维护）。

---

## Verification

最小验证序列（按改动范围）：

```bash
# 后端单元测试
cd backend && pytest

# 前端构建
pnpm --dir frontend build

# 镜像一致性校验（修改 *.zh-CN.md 后必跑）
python infra/axi-workspace-governance/scripts/verify_doc_i18n.py projects/axi-agent-platform

# 工作区图谱健康检查
/Volumes/code/workspace/scripts/workspace-project health axi-agent-platform
```

补充可选步骤：

- 修改 `backend/app/core/code_isolation_manager.py` 或 `backend/app/api/subagent.py` → 至少 `pytest backend/tests/` 通过。
- 修改 `infra/axi-agent-mcp/**` → 至少 `pnpm --dir infra/axi-agent-mcp build` + 启动后 MCP 协议冒烟。
- 修改 `*.zh-CN.md` → 跑 `verify_doc_i18n` 校验 token multiset 不变量。
- 修改本文件 / `CHANGELOG.md` / `TODO.md` / `SECURITY.md` / `docs/project-docs.manifest.json` → 不需构建，但需保持文件存在性。

---

## House Rules

- **不要**把 OMX 内部状态（`.omx/metrics.json`、`.omx/state/subagent-tracking.json`、`.omx/state/tmux-hook-state.json`、`.omx/state/session.json` 等）写入 commit。
- **不要**把 Codex/Cursor 会话目录（`.codegraph/`、agent transcripts 文件夹、`.cursor/projects/.../terminals/`）写入 commit。
- **不要**把 `backend/chroma_db/`、`backend/axi_agent_platform.db`、`backend/projects/`（worktree 根）、`backend/__pycache__/`、`frontend/node_modules/`、`frontend/dist/` 写入版本控制。
- **不要**在没有 owner 显式指令的情况下合并到 `main`、推送标签、删除远程分支、发布正式 release。
- **不要**把 `references/*` 或工作区治理镜像的内容当作本项目可写范围。
- **不要**把源语言（`升级方案.md` 等）已经具备简体中文镜像（`upgrade-plan.zh-CN.md` 等）的正文内容**再回写一遍**——直接跳转即可，避免双源漂移。
- **不要**改写 i18n 镜像中的 Windows 路径（`\` 保留、`C:\` 保留），避免触发 `verify_doc_i18n` 的 token multiset 误报。
- **要**保持根级 `AGENTS.md` 与子模块文档的分层：根级谈边界与门面，子模块文件谈实现与契约。
- **要**在改动跨项目契约（如 MCP 蜂群工具签名、SubAgent REST 路由）前先查 `workspace-project consumers axi-agent-platform`。
- **要**在 `CHANGELOG.md` 记录对仓库结构、依赖、SubAgent API、镜像策略的可见变更。

---

*最后更新：2026-06-07 — 根级 AGENTS 首版，由 workspace-docs-gap 子代理 W4 落地。*
