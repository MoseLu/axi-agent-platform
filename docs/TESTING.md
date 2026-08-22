# Testing Guide / 测试指南

**Last Updated**: 2026-08-22

## Overview / 概述

Axi Agent Platform 是一个包含前端和后端服务的 monorepo。测试策略采用 Vitest 进行单元测试和集成测试。

## Test Types / 测试类型

- **Unit Tests / 单元测试**: Vitest (`.test.ts`, `.test.tsx`)
- **Integration Tests / 集成测试**: Vitest (位于 `tests/integration/`)

## Running Tests / 运行测试

```bash
# 运行所有测试
pnpm test

# 运行特定包测试
pnpm --filter @axi/agent-mcp test
pnpm --filter @axi/frontend test

# 直接在包目录中运行
cd infra/axi-agent-mcp && pnpm test
```

## Test Configuration / 测试配置

主要配置文件位置:
- `/frontend/vitest.config.ts`
- `/infra/axi-agent-mcp/vitest.config.ts`

## Writing Tests / 编写测试

### Naming Conventions / 命名规范

- 测试文件: `*.test.ts`, `*.test.tsx`
- 集成测试: `tests/integration/*.test.ts`

### Best Practices / 最佳实践

- 使用 Vitest 的 describe/it/test 语法
- Mock 外部依赖
- 测试应独立运行，不依赖执行顺序

## CI Integration / CI 集成

测试在 CI 环境中自动运行。

## Related / 相关

- [AGENTS.md](AGENTS.md) - 项目总览
