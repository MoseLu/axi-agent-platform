# Agent BFF Service

面向 axiom-agent-platform 前端的 Backend for Frontend (BFF) 服务。

## 职责

- 聚合后端 Python FastAPI 的多个端点数据
- 提供面向前端的统一 DTO
- 统一错误响应格式
- 添加链路追踪和日志

## 架构

```
前端 (React) → BFF (:8081) → 后端 Python (:8000)
                    ↓
              并行获取:
              - /api/v1/agents
              - /api/v1/tasks
              - /api/v1/tools
              - /api/v1/stats
```

## API 端点

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/v1/dashboard/stats` | 聚合 Dashboard 数据 |
| GET | `/health` | 健康检查 |

## 环境变量

| 变量 | 默认值 | 描述 |
|------|--------|------|
| `BACKEND_URL` | `http://localhost:8000` | Python 后端地址 |
| `GIN_MODE` | `release` | Gin 模式 |

## 运行

```bash
cd services/agent-bff
go build -o agent-bff ./cmd/bff
./agent-bff
```

## 开发

```bash
cd services/agent-bff
go run ./cmd/bff
```
