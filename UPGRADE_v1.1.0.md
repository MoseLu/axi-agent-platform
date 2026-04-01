# Agent Swarm v1.1.0 - SubAgent 模式升级说明

## 🚀 升级概述

本次升级将 Agent Swarm 与 subAgent 模式结合，增加了代码开发专用协作能力，实现了通用协作模式和代码开发模式的无缝切换。

## ✨ 新增功能

### 1. SubAgent 专用角色
新增 7 种智能体角色，支持专业的代码开发分工：
- `planner` - 代码开发规划者
- `worker` - 通用工作者
- `code_worker` - 代码工作者
- `code_reviewer` - 代码审查者
- `test_engineer` - 测试工程师
- `doc_generator` - 文档生成者
- `judge` - 裁判（质量评估）

### 2. 代码环境隔离
- **CodeIsolationManager**: 基于 Git worktrees 实现代码环境隔离
- 每个智能体拥有独立的工作空间
- 支持并行开发，避免代码冲突
- 自动同步、提交、合并代码

### 3. 增强的任务调度器
- **任务类型支持**:
  - `general` - 通用任务
  - `code_development` - 代码开发任务
  - `code_review` - 代码审查任务
  - `test_writing` - 测试编写任务
  - `doc_generation` - 文档生成任务

- **SubAgent 模式自动流程**:
  1. 规划者分析需求并制定计划
  2. 代码工作者实现功能
  3. 代码审查者检查代码质量
  4. 测试工程师编写测试
  5. 裁判进行综合评估

### 4. 质量控制流程
- 自动代码审查
- 质量评分（代码质量、完整性、测试、文档）
- Judge 智能体进行最终评审
- 基于质量评估的决策机制

### 5. SubAgent API 接口
完整的 REST API 支持 subAgent 模式：
- `GET /subagent/worktree/stats` - Worktree 统计
- `POST /subagent/worktree/create` - 创建 worktree
- `GET /subagent/worktree/{agent_id}` - 获取 worktree 信息
- `POST /subagent/worktree/sync` - 同步 worktree
- `GET /subagent/worktree/{agent_id}/changes` - 获取代码变更
- `POST /subagent/worktree/commit` - 提交变更
- `POST /subagent/worktree/merge` - 合并到主分支
- `DELETE /subagent/worktree/{agent_id}` - 删除 worktree
- `POST /subagent/quality/assess` - 提交质量评估
- `GET /subagent/config` - 获取配置

### 6. 前端增强
- 新增 **SubAgent 页面**，用于管理代码开发协作
- 实时查看 worktrees 状态
- 代码变更可视化（新增/修改/删除）
- 一键同步、提交、合并操作
- 更新类型定义支持新模式

## 📁 新增文件

### 后端
- `backend/app/core/code_isolation_manager.py` - 代码隔离管理器
- `backend/app/api/subagent.py` - SubAgent API 路由

### 前端
- `frontend/src/pages/SubAgent.tsx` - SubAgent 管理页面

## 🔧 修改文件

### 后端
- `backend/app/schemas/agent.py` - 添加 AgentRole 枚举
- `backend/app/schemas/task.py` - 添加 TaskType、task_type、use_subagent_mode 等字段
- `backend/app/core/task_scheduler.py` - 升级支持 subAgent 模式
- `backend/app/config.py` - 添加 SubAgent 配置项
- `backend/app/main.py` - 集成 CodeIsolationManager 和 subagent 路由
- `backend/.env.example` - 添加 SubAgent 配置变量

### 前端
- `frontend/src/types/index.ts` - 更新类型定义
- `frontend/src/App.tsx` - 添加 SubAgent 路由
- `frontend/src/components/common/Sidebar.tsx` - 添加 SubAgent 导航项

## 📝 新增配置项

在 `.env` 文件中添加以下配置：

```env
# SubAgent 模式配置（代码开发协作）
REPOSITORY_PATH=./projects           # 代码仓库路径
MAX_WORKTREES=10                   # 最大 worktree 数量
MAX_PARALLEL_AGENTS=8               # 最大并行智能体数
DEFAULT_BASE_BRANCH=main            # 默认基础分支
WORKTREES_CLEANUP_HOURS=24         # worktree 自动清理时间（小时）
```

## 🎯 使用方式

### 创建 SubAgent 智能体

```python
# 创建规划者智能体
planner = await agent_manager.create_agent(
    name="Code Planner",
    description="代码开发项目规划者",
    system_prompt="你是一个专业的代码开发项目规划者，擅长将复杂的开发任务分解为可执行的子任务...",
    role="planner",
    tools=["git", "file_read", "file_write", "code_search"]
)

# 创建代码工作者
code_worker = await agent_manager.create_agent(
    name="Code Worker",
    description="代码实现智能体",
    system_prompt="你是一个专业的代码开发者，能够根据需求实现高质量的代码...",
    role="code_worker",
    tools=["file_write", "code_analysis"]
)
```

### 创建代码开发任务

```python
# 创建使用 subAgent 模式的任务
task = await task_scheduler.create_task(
    TaskCreate(
        title="实现用户认证功能",
        description="实现JWT用户认证系统，包括登录、注册、token刷新等功能",
        priority=TaskPriority.HIGH,
        task_type=TaskType.CODE_DEVELOPMENT,
        use_subagent_mode=True,
        repository_path="/path/to/your/repo",
        tags=["auth", "jwt", "security"]
    )
)
```

### 管理 Worktrees

通过 API 或前端页面管理 worktrees：

```bash
# 查看 worktree 统计
curl http://localhost:8000/subagent/worktree/stats

# 创建 worktree
curl -X POST http://localhost:8000/subagent/worktree/create \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "agent-123", "base_branch": "main"}'

# 查看代码变更
curl http://localhost:8000/subagent/worktree/agent-123/changes

# 提交变更
curl -X POST http://localhost:8000/subagent/worktree/commit \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "agent-123", "message": "Implement auth feature"}'

# 合并到主分支
curl -X POST http://localhost:8000/subagent/worktree/merge \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "agent-123", "target_branch": "main"}'
```

## 🔄 升级步骤

### 1. 更新代码
```bash
# 拉取最新代码
git pull origin main

# 后端安装依赖
cd backend
pip install -r requirements.txt

# 前端安装依赖
cd ../frontend
pnpm install
```

### 2. 配置环境变量
```bash
cd backend
cp .env.example .env
# 编辑 .env 文件，填入必要的配置和 SubAgent 配置
```

### 3. 初始化 Git 仓库（如需要）
```bash
cd projects  # 或配置的 REPOSITORY_PATH
git init
git commit -m "Initial commit"
```

### 4. 启动服务
```bash
# 启动后端
cd backend
uvicorn app.main:app --reload

# 启动前端（新终端）
cd frontend
pnpm dev
```

## ⚠️ 注意事项

1. **Git 仓库要求**: SubAgent 模式需要有效的 Git 仓库，确保 `REPOSITORY_PATH` 指向的目录已初始化 Git。

2. **worktrees 数量限制**: 默认最多 10 个 worktrees，可通过配置调整。

3. **并行智能体数**: 默认最多 8 个智能体并行，注意 API 配额限制。

4. **代码合并冲突**: 自动合并可能产生冲突，需要手动解决。

5. **内存使用**: 多智能体并行执行会增加内存使用，建议监控资源。

## 🐛 已知问题

- [ ] Git 合并冲突需要手动解决
- [ ] 工作空间清理可能不彻底
- [ ] 大量 worktrees 时性能可能下降

## 📈 未来计划

- [ ] WebSocket 实时通信
- [ ] 任务流式输出
- [ ] 代码冲突自动解决
- [ ] 智能体对话历史持久化
- [ ] 高级任务编排

## 📞 支持

如有问题或建议，请：
- 提交 Issue
- 查看 API 文档: http://localhost:8000/docs
- 阅读 README.md

---

**版本**: v1.1.0  
**发布日期**: 2026-02-09
