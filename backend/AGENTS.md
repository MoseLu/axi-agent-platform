# AGENTS.md - Axi Agent Platform Backend

## 模块职责

Python FastAPI 后端，提供多智能体协作系统的核心 API，包括：
1. 智能体管理 (创建、配置、删除)
2. 任务调度与执行
3. SubAgent 代码开发模式
4. 记忆管理 (会话 + Chroma 向量存储)
5. 工具系统

## 边界定义

- **输入**: HTTP REST API 请求
- **输出**: JSON 响应、WebSocket (待实现)
- **依赖**:
  - FastAPI
  - LangChain (LLM 编排)
  - SQLAlchemy + SQLite
  - Chroma (向量数据库)
  - miniMax / OpenAI API

## 入口点

| 文件 | 说明 |
|------|------|
| `app/main.py` | FastAPI 应用入口 |
| `app/api/` | API 路由定义 |
| `app/core/` | 核心组件 (调度器、编排器) |
| `app/models/` | 模型连接器 (miniMax, OpenAI) |
| `app/tools/` | 工具定义和管理 |
| `app/database/` | SQLAlchemy 模型 |
| `app/schemas/` | Pydantic 数据模型 |

## 关键 API 路由

| 前缀 | 说明 |
|------|------|
| `/api/agents` | 智能体 CRUD |
| `/api/tasks` | 任务管理 |
| `/api/tools` | 工具管理 |
| `/api/memory` | 记忆管理 |
| `/api/subagent` | SubAgent 模式专用 |

## SubAgent API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/subagent/worktree/stats` | GET | worktree 统计 |
| `/subagent/worktree/create` | POST | 创建 worktree |
| `/subagent/worktree/{id}/changes` | GET | 获取代码变更 |
| `/subagent/worktree/merge` | POST | 合并到主分支 |
| `/subagent/quality/assess` | POST | 质量评估 |

## 验证命令

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload    # 开发模式
pytest tests/                     # 测试
```

## 相关模块

- `axi-agent-platform/frontend/`: React Web 前端
- `axi-agent-platform/apps/desktop-glass-ui/`: macOS 桌面壳
- 父项目: `axi-agent-platform/`
