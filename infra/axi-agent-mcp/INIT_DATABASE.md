# 数据库初始化脚本

## PostgreSQL

```bash
# 连接到 PostgreSQL（使用你的密码）
psql -U postgres -h localhost

# 创建数据库
CREATE DATABASE mcp_swarm;

# 连接数据库
\c mcp_swarm;

# 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

# 退出
\q
```

## MongoDB

MongoDB 会自动创建数据库，不需要手动操作。

```bash
# 验证 MongoDB 连接
mongosh mongodb://localhost:27017/mcp_swarm --eval "db.runCommand({ping:1})"
```

## Redis

Redis 不需要创建数据库，直接使用即可。

```bash
# 验证 Redis 连接
redis-cli -a 123456 ping
```

## 验证所有数据库

运行测试脚本：

```bash
cd E:\app\mcp-swarm
pnpm exec tsx test-db-connection.ts
```
