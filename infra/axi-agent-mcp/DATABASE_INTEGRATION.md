# 数据库集成使用指南

## 📊 支持的数据库

本项目支持三种数据库，各自承担不同职责：

### 1. PostgreSQL (带 pgvector 扩展)
**用途**: 向量存储和语义搜索
- 存储代码嵌入（embeddings）
- 语义代码搜索
- 代码相似度分析

**配置**:
```bash
DB_POSTGRES_HOST=localhost
DB_POSTGRES_PORT=5432
DB_POSTGRES_DB=code_swarm
DB_POSTGRES_USER=postgres
DB_POSTGRES_PASSWORD=postgres
```

**安装 pgvector**:
```bash
# PostgreSQL 15+
CREATE EXTENSION vector;
```

---

### 2. MongoDB
**用途**: 文档存储
- 存储代码片段
- 执行历史记录
- 项目信息

**配置**:
```bash
DB_MONGODB_URI=mongodb://localhost:27017
DB_MONGODB_DB=code_swarm
```

---

### 3. Redis
**用途**: 缓存和会话存储
- 智能缓存（Lint/Test 结果、代码分析）
- 文件锁状态
- 会话管理

**配置**:
```bash
DB_REDIS_HOST=localhost
DB_REDIS_PORT=6379
DB_REDIS_PASSWORD=
```

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd mcp-swarm
pnpm add pg mongodb redis
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，修改数据库配置：

```bash
# PostgreSQL
DB_POSTGRES_HOST=localhost
DB_POSTGRES_PORT=5432
DB_POSTGRES_DB=code_swarm
DB_POSTGRES_USER=postgres
DB_POSTGRES_PASSWORD=your_password

# MongoDB
DB_MONGODB_URI=mongodb://localhost:27017
DB_MONGODB_DB=code_swarm

# Redis
DB_REDIS_HOST=localhost
DB_REDIS_PORT=6379
```

### 3. 初始化数据库

```bash
# PostgreSQL - 创建扩展
psql -U postgres -d code_swarm -c "CREATE EXTENSION IF NOT EXISTS vector;"

# MongoDB - 自动创建集合和索引
# Redis - 无需初始化
```

---

## 📁 核心模块

### DatabaseManager (`src/database/db-manager.ts`)

统一管理所有数据库连接：

```typescript
import { dbManager } from './database/db-manager.js';

// 连接所有数据库
await dbManager.connect();

// 获取 PostgreSQL 连接池
const pgPool = dbManager.getPostgreSQL();

// 获取 MongoDB 数据库
const mongoDb = dbManager.getMongoDB();

// 获取 MongoDB Collection
const snippets = dbManager.getCollection('code_snippets');

// 获取 Redis 客户端
const redis = dbManager.getRedis();

// 检查健康状态
const health = await dbManager.checkHealth();
// { postgresql: true, mongodb: true, redis: true }

// 断开连接
await dbManager.disconnect();
```

---

### VectorStore (`src/database/vector-store.ts`)

向量存储和语义搜索：

```typescript
import { VectorStore } from './database/vector-store.js';

const vectorStore = new VectorStore(dbManager.getPostgreSQL());

// 初始化表
await vectorStore.initialize();

// 存储代码嵌入
await vectorStore.storeEmbedding(
  'src/utils/helper.ts',
  'export function add(a: number, b: number): number { ... }',
  [0.1, 0.2, ...], // 1536 维 embedding
  'typescript',
  ['add', 'helper']
);

// 语义搜索
const results = await vectorStore.search(
  queryEmbedding, // 查询的 embedding
  {
    limit: 10,
    threshold: 0.7,
    language: 'typescript',
  }
);

// 结果
// [
//   {
//     filePath: 'src/utils/helper.ts',
//     code: 'export function add...',
//     similarity: 0.95,
//     language: 'typescript',
//     symbols: ['add', 'helper']
//   }
// ]

// 查找相似代码
const similar = await vectorStore.findSimilarCode(
  currentCode,
  currentEmbedding,
  { limit: 5 }
);

// 获取统计
const stats = await vectorStore.getStats();
// { totalCount: 1000, languageCount: { typescript: 500, ... }, ... }
```

---

### SmartCache (`src/database/smart-cache.ts`)

智能缓存系统：

```typescript
import { SmartCache } from './database/smart-cache.js';

const cache = new SmartCache(dbManager.getRedis());

// 获取缓存
const cached = await cache.get('lint-result:src/app.ts');

// 设置缓存（默认 1 小时过期）
await cache.set('lint-result:src/app.ts', { errors: 0, warnings: 2 });

// 获取或设置（带回调）
const result = await cache.getOrSet(
  'test-result',
  async () => {
    // 执行测试
    return await runTests();
  },
  { ttl: 3600 } // 1 小时
);

// 删除缓存
await cache.delete('lint-result:src/app.ts');

// 按前缀批量删除
await cache.deleteByPrefix('lint-result');

// 检查是否存在
const exists = await cache.exists('key');

// 获取统计
const stats = await cache.getStats();
// { hits: 100, misses: 20, keys: 500, memoryUsage: 1024000 }

// 命中率
const hitRate = cache.getHitRate(); // 0.83 (83%)
```

**缓存装饰器**:

```typescript
import { Cached } from './database/smart-cache.js';

class LintService {
  cache = new SmartCache(redis);

  @Cached({ ttl: 3600 })
  async runLint(filePath: string) {
    // 自动缓存结果
    return await executeLint(filePath);
  }
}
```

---

### CodeStore (`src/database/code-store.ts`)

代码存储和管理：

```typescript
import { CodeStore } from './database/code-store.js';

const codeStore = new CodeStore(dbManager.getMongoDB());

// 初始化索引
await codeStore.initialize();

// 存储代码片段
await codeStore.storeSnippet({
  filePath: 'src/utils/helper.ts',
  code: 'export function add...',
  language: 'typescript',
  symbols: ['add', 'helper'],
  metadata: {
    size: 1024,
    lines: 50,
    lastModified: new Date(),
  },
  tags: ['utility', 'math'],
});

// 批量存储
const count = await codeStore.storeBatch([
  { filePath: 'src/a.ts', ... },
  { filePath: 'src/b.ts', ... },
]);

// 搜索代码片段
const snippets = await codeStore.searchSnippets({
  language: 'typescript',
  symbols: ['add'],
  tags: ['utility'],
  filePathPattern: 'src/utils/**',
});

// 记录执行历史
await codeStore.recordExecution({
  taskId: 'task-123',
  type: 'lint',
  command: 'pnpm lint',
  success: true,
  output: 'No errors found',
  duration: 5000,
  projectRoot: '/path/to/project',
});

// 获取执行历史
const history = await codeStore.getExecutionHistory('task-123');

// 存储项目信息
await codeStore.storeProject({
  name: 'my-project',
  rootPath: '/path/to/project',
  techStack: { frontend: 'React', backend: 'NestJS' },
});

// 获取统计
const stats = await codeStore.getStats();
// {
//   totalSnippets: 1000,
//   totalExecutions: 5000,
//   totalProjects: 10,
//   snippetsByLanguage: { typescript: 500, python: 300, ... }
// }
```

---

## 🔧 MCP 工具

### 数据库工具（待实现）

```bash
# 检查数据库健康
/swarm_db_health

# 获取缓存统计
/swarm_cache_stats

# 获取代码存储统计
/swarm_code_store_stats

# 获取向量存储统计
/swarm_vector_store_stats

# 语义搜索代码
/swarm_semantic_search
  query: "用户认证函数"
  language: typescript
  limit: 10

# 查找相似代码
/swarm_find_similar_code
  filePath: src/auth.ts
  limit: 5

# 清除缓存
/swarm_clear_cache
  prefix: lint-result

# 清除向量存储
/swarm_clear_vector_store
```

---

## 📊 使用场景

### 场景 1: 语义代码搜索

```bash
# 1. 索引代码库
/swarm_build_index
  projectRoot: e:\my-project

# 2. 语义搜索（使用自然语言）
/swarm_semantic_search
  query: "如何验证用户邮箱格式"
  language: typescript
  limit: 5

# 输出:
# 找到 5 个相关代码片段:
# 1. src/utils/validation.ts (相似度：0.92)
#    export function validateEmail(email: string): boolean { ... }
# 2. src/validators/email.validator.ts (相似度：0.89)
#    export class EmailValidator { ... }
# ...
```

### 场景 2: 智能缓存加速 CI/CD

```bash
# 第一次运行（无缓存）
/swarm_run_lint
  projectRoot: e:\my-project

# 第二次运行（使用缓存）
# 自动从 Redis 获取缓存结果，速度提升 10-100 倍

# 清除特定文件的缓存
/swarm_clear_cache
  prefix: lint-result:src/app.ts
```

### 场景 3: 代码相似度分析

```bash
# 查找与当前代码相似的其他代码
/swarm_find_similar_code
  filePath: src/services/user.service.ts
  limit: 5

# 输出:
# 找到 5 个相似代码:
# 1. src/services/order.service.ts (相似度：0.85)
#    - 相同的 CRUD 模式
#    - 相似的错误处理
# 2. src/services/product.service.ts (相似度：0.82)
#    ...
```

### 场景 4: 执行历史追踪

```bash
# 查看某个任务的历史执行记录
/swarm_get_execution_history
  taskId: task-123

# 输出:
# 执行历史:
# 1. 2026-02-25 14:30:00 - lint - ✅ 成功 (5.2s)
# 2. 2026-02-25 14:28:00 - test - ❌ 失败 (12.3s)
#    - 3 个测试失败
# 3. 2026-02-25 14:25:00 - lint - ✅ 成功 (4.8s)
```

---

## 🎯 最佳实践

### 1. 向量嵌入策略

```typescript
// 对每个函数/类生成 embedding
const functions = extractFunctions(code);
for (const func of functions) {
  const embedding = await generateEmbedding(func.code);
  await vectorStore.storeEmbedding(
    func.filePath,
    func.code,
    embedding,
    func.language,
    [func.name, ...func.symbols]
  );
}
```

### 2. 缓存策略

```typescript
// Lint 结果缓存 1 小时
await cache.set(`lint:${filePath}`, result, { ttl: 3600 });

// 测试结果缓存 30 分钟
await cache.set(`test:${filePath}`, result, { ttl: 1800 });

// 代码分析缓存 24 小时
await cache.set(`analyze:${filePath}`, result, { ttl: 86400 });
```

### 3. 批量操作

```typescript
// 批量存储（推荐）
const embeddings = await Promise.all(
  files.map(f => generateEmbedding(f.code))
);

await vectorStore.storeBatch(
  files.map((f, i) => ({
    filePath: f.path,
    code: f.code,
    embedding: embeddings[i],
    language: f.language,
  }))
);
```

---

## 📈 性能优化

### 1. 连接池配置

```typescript
// PostgreSQL
const pool = new Pool({
  max: 20, // 最大连接数
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// MongoDB
const client = new MongoClient(uri, {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
});
```

### 2. 索引优化

```sql
-- PostgreSQL 向量索引
CREATE INDEX idx_embeddings 
ON code_embeddings 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- MongoDB 复合索引
db.code_snippets.createIndex({ language: 1, symbols: 1 });
db.code_snippets.createIndex({ filePath: 1, createdAt: -1 });
```

### 3. Redis 优化

```typescript
// 使用管道批量操作
const pipeline = redis.multi();
for (const key of keys) {
  pipeline.set(key, value);
}
await pipeline.exec();

// 使用 Lua 脚本保证原子性
await redis.eval(`
  if redis.call('EXISTS', KEYS[1]) == 0 then
    return redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  end
  return nil
`, { keys: ['key'], arguments: ['value', '3600'] });
```

---

## 🔍 故障排除

### 问题 1: PostgreSQL pgvector 未安装

```bash
# 错误：type "vector" does not exist
# 解决：
psql -U postgres -d code_swarm
CREATE EXTENSION IF NOT EXISTS vector;
```

### 问题 2: MongoDB 连接失败

```bash
# 错误：connect ECONNREFUSED
# 解决：
# 1. 检查 MongoDB 是否运行：docker ps | grep mongo
# 2. 检查 URI 是否正确：mongodb://localhost:27017
# 3. 检查防火墙设置
```

### 问题 3: Redis 连接失败

```bash
# 错误：Error: connect ECONNREFUSED
# 解决：
# 1. 检查 Redis 是否运行：docker ps | grep redis
# 2. 检查配置：DB_REDIS_HOST=localhost
# 3. 测试连接：redis-cli ping
```

---

## 📊 监控和告警

### 数据库健康检查

```typescript
// 定期检查
setInterval(async () => {
  const health = await dbManager.checkHealth();
  
  if (!health.postgresql || !health.mongodb || !health.redis) {
    logger.error("db_health_check_failed", health);
    // 发送告警
  }
}, 60000); // 每分钟
```

### 缓存命中率监控

```typescript
// 监控缓存命中率
setInterval(() => {
  const hitRate = cache.getHitRate();
  
  if (hitRate < 0.5) {
    logger.warn("cache_hit_rate_low", { hitRate });
  }
}, 300000); // 每 5 分钟
```

---

## 🎊 总结

通过集成 PostgreSQL (pgvector)、MongoDB 和 Redis，Code Swarm 系统现在具备：

✅ **语义搜索能力** - 使用向量搜索找到相关代码
✅ **智能缓存** - 大幅提升 CI/CD 速度
✅ **代码存储** - 持久化存储代码片段和历史
✅ **相似度分析** - 发现重复代码和模式

这标志着系统从**工具级**迈向了**平台级**，具备了企业级应用的核心能力！🚀
