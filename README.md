# Axi Agent Platform - 多智能体协作系统

基于 miniMax API + OpenAI Swarm + LangChain 的个人级多智能体协作系统，支持通用协作模式和代码开发专用模式（subAgent）。

## 功能特性

### 核心功能
- **多智能体协作**: 支持最多10个智能体并行协作
- **任务调度**: 自动任务拆解、调度和执行监控
- **智能体管理**: 自定义角色、能力标签、模型配置
- **工具集成**: 内置搜索、文件、计算、代码执行等工具
- **记忆管理**: 会话记忆 + Chroma向量长期记忆
- **Web界面**: 现代化的React前端界面

### SubAgent 代码开发模式 🚀
- **专业角色分工**: Planner（规划者）+ Worker（工作者）+ Judge（裁判）三层协作
- **代码环境隔离**: 基于 Git worktrees 实现多智能体并行开发
- **自动化流程**: 规划 → 实现 → 审查 → 测试 → 评审的完整流程
- **质量控制**: 自动代码审查和质量评估
- **冲突管理**: 智能合并冲突检测和提示

## 技术栈

### 后端
- Python 3.10+
- FastAPI
- LangChain
- SQLAlchemy + SQLite
- Chroma (向量数据库)

### 前端
- React 18
- TypeScript
- Tailwind CSS
- Zustand (状态管理)
- Recharts (图表)
- Lucide React (图标)

## 快速开始

### 1. 克隆项目

```bash
git clone <repository-url>
cd axi-agent-platform
```

### 2. 配置环境变量

```bash
# 编辑 .env 文件，填入你的API密钥
cp .env.example .env
```

### 3. Docker部署 (推荐)

```bash
docker-compose up -d
```

访问 http://localhost 即可使用。

### 4. 本地开发

#### 后端

```bash
cd backend

# 创建虚拟环境
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 配置环境变量（可选）
cp .env.example .env
# 编辑 .env 文件填入 API keys

# 启动服务
uvicorn app.main:app --reload
```

后端服务将在 http://localhost:8000 运行。

#### 前端

```bash
cd frontend

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

前端服务将在 http://localhost:5173 运行。

## API文档

启动后端后，访问 http://localhost:8000/docs 查看自动生成的API文档。

## 项目结构

```
axi-agent-platform/
├── backend/              # 后端代码
│   ├── app/
│   │   ├── api/         # API路由
│   │   ├── core/        # 核心组件
│   │   ├── models/      # 模型连接器
│   │   ├── tools/       # 工具管理
│   │   ├── database/    # 数据库模型
│   │   └── schemas/     # 数据模型
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/            # 前端代码
│   ├── src/
│   │   ├── components/  # 组件
│   │   ├── pages/       # 页面
│   │   ├── services/    # API服务
│   │   ├── store/       # 状态管理
│   │   └── types/       # TypeScript类型
│   ├── package.json
│   └── Dockerfile
├── apps/
│   └── desktop-glass-ui/ # macOS 玻璃态桌面壳原型
├── docker-compose.yml
├── .env.example        # 环境变量示例
└── README.md
```

## SubAgent 模式架构

```
用户提交代码开发任务
        ↓
┌──────────────────────┐
│   任务调度器          │
│ (SubAgent 模式)      │
└──────────────────────┘
        ↓
    任务拆解
        ↓
┌─────────────────────────────────────────────┐
│  Planner (规划者)                         │
│  - 分析需求                              │
│  - 制定开发计划                          │
│  - 分配子任务                            │
└─────────────────────────────────────────────┘
        ↓
┌──────────────────────┬──────────────────────┐
│ Code Worker         │ Test Engineer       │
│ (代码实现)         │ (测试编写)          │
└──────────────────────┴──────────────────────┘
        ↓
┌─────────────────────────────────────────────┐
│  Code Reviewer                            │
│  - 审查代码质量                          │
│  - 检查最佳实践                         │
└─────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────┐
│  Judge (裁判)                            │
│  - 综合评估                              │
│  - 质量打分                              │
│  - 批准或要求修改                        │
└─────────────────────────────────────────────┘
        ↓
    代码合并
        ↓
    任务完成
```

## API 文档

启动后端后，访问 http://localhost:8000/docs 查看完整的 API 文档。

### SubAgent 相关 API

- `GET /subagent/worktree/stats` - 获取 worktree 统计
- `POST /subagent/worktree/create` - 创建 worktree
- `GET /subagent/worktree/{agent_id}` - 获取 worktree 信息
- `POST /subagent/worktree/sync` - 同步 worktree
- `GET /subagent/worktree/{agent_id}/changes` - 获取代码变更
- `POST /subagent/worktree/commit` - 提交变更
- `POST /subagent/worktree/merge` - 合并到主分支
- `DELETE /subagent/worktree/{agent_id}` - 删除 worktree
- `POST /subagent/quality/assess` - 提交质量评估
- `GET /subagent/config` - 获取配置
```

## 使用说明

### 基础使用
1. **创建智能体**: 在"智能体"页面创建具有不同能力的AI智能体
2. **创建任务**: 在"任务"页面提交复杂任务
3. **监控执行**: 实时查看任务执行进度和智能体状态
4. **管理工具**: 在"工具"页面管理可用工具
5. **查看记忆**: 在"记忆"页面管理会话和长期记忆

### SubAgent 代码开发模式
1. **创建专用智能体**:
   - 规划者: 负责任务分解和开发计划
   - 代码工作者: 实现代码功能
   - 代码审查者: 审查代码质量
   - 测试工程师: 编写测试用例
   - 裁判: 评估整体质量并决策

2. **创建代码开发任务**:
   - 在"任务"页面选择任务类型为"代码开发"
   - 启用"使用 subAgent 模式"
   - 指定代码仓库路径

3. **管理 worktrees**:
   - 在"SubAgent"页面查看活跃的 worktrees
   - 查看代码变更（新增/修改/删除）
   - 同步、提交、合并代码
   - 清理过期的 worktrees

## 配置说明

### Axi 命名迁移

- 应用名、前端包名、Docker container/network 已从旧实验名迁为 `Axi Agent Platform` / `axi-agent-platform-*`。
- 默认 SQLite 文件名已从 `agent_swarm.db` 迁为 `axi_agent_platform.db`；如需继续读取旧本地数据，可在 `.env` 中把 `DATABASE_URL` 指回旧文件，再手动迁移。

### 智能体配置
- **模型选择**: 支持 miniMax (abab6-chat, abab5-chat) 和 OpenAI (GPT-4, GPT-3.5)
- **温度参数**: 控制输出随机性 (0-2)
- **能力标签**: 定义智能体的专业领域
- **角色选择**: 支持通用智能体和 subAgent 专用角色

### 智能体角色
- **general**: 通用智能体，处理各种类型任务
- **planner**: 代码开发规划者，负责任务分解
- **code_worker**: 代码工作者，实现代码功能
- **code_reviewer**: 代码审查者，审查代码质量
- **test_engineer**: 测试工程师，编写测试用例
- **judge**: 裁判，评估整体质量并决策

### 任务类型
- **general**: 通用任务，使用标准协作模式
- **code_development**: 代码开发任务，自动启用 subAgent 模式
- **code_review**: 代码审查任务
- **test_writing**: 测试编写任务
- **doc_generation**: 文档生成任务

### 任务优先级
- 1: 低
- 2: 普通
- 3: 高
- 4: 紧急

### SubAgent 模式配置
- **REPOSITORY_PATH**: 代码仓库根目录
- **MAX_WORKTREES**: 最大 worktree 数量 (默认: 10)
- **MAX_PARALLEL_AGENTS**: 最大并行智能体数 (默认: 8)
- **DEFAULT_BASE_BRANCH**: 默认基础分支 (默认: main)
- **WORKTREES_CLEANUP_HOURS**: worktree 自动清理时间 (默认: 24小时)

## 开发计划

### v1.0.0 - 基础版本 ✅
- [x] 项目基础结构
- [x] 后端核心组件
- [x] 模型连接器
- [x] 工具管理系统
- [x] FastAPI接口
- [x] React前端界面
- [x] Docker部署配置

### v1.1.0 - SubAgent 模式 ✅
- [x] subAgent 专用角色定义
- [x] 代码隔离管理器
- [x] 任务调度器升级支持代码开发模式
- [x] 质量控制流程
- [x] SubAgent API 接口
- [x] 前端 SubAgent 页面

### v1.2.0 - 增强功能 (计划中)
- [ ] WebSocket实时通信
- [ ] 任务流式输出
- [ ] 高级任务编排
- [ ] 智能体对话历史持久化
- [ ] 代码冲突自动解决

## License

MIT
