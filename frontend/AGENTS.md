# AGENTS.md - Axi Agent Platform Frontend

## 模块职责

React Web 前端，提供 Axi Agent Platform 的用户界面，包括：
1. 智能体管理 UI
2. 任务创建与监控
3. SubAgent 模式可视化
4. 记忆管理界面
5. 实时状态展示

## 边界定义

- **输入**: 用户交互操作
- **输出**: API 请求、UI 渲染
- **依赖**:
  - React 18 + TypeScript
  - Tailwind CSS (样式)
  - Zustand (状态管理)
  - Recharts (图表)
  - Lucide React (图标)

## 入口点

| 文件 | 说明 |
|------|------|
| `src/App.tsx` | React 根组件 |
| `src/main.tsx` | 入口文件 |
| `src/pages/` | 页面组件 |
| `src/components/` | 可复用组件 |
| `src/services/` | API 服务调用 |
| `src/store/` | Zustand 状态存储 |

## 关键页面

| 页面 | 说明 |
|------|------|
| `/` | 首页/仪表盘 |
| `/agents` | 智能体管理 |
| `/tasks` | 任务列表与详情 |
| `/subagent` | SubAgent 模式管理 |
| `/memory` | 记忆管理 |
| `/tools` | 工具配置 |

## 验证命令

```bash
cd frontend
pnpm install
pnpm dev          # 开发模式 (http://localhost:5173)
pnpm build        # 生产构建
pnpm test         # Vitest 测试
```

## API 服务

- 后端 API Base: `http://localhost:8000`
- Swagger 文档: `http://localhost:8000/docs`

## 相关模块

- `axi-agent-platform/backend/`: Python FastAPI 后端
- `axi-agent-platform/apps/desktop-glass-ui/`: macOS 桌面壳
- 父项目: `axi-agent-platform/`
