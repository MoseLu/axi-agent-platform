# 文件操作与代码库搜索使用指南

## 📁 新增工具概览

### 文件操作工具

| 工具名称 | 功能 | 示例 |
|---------|------|------|
| `swarm_read_file` | 读取文件内容 | 读取现有的 Entity、Component |
| `swarm_write_file` | 创建/覆盖文件 | 创建新的 Migration、Component |
| `swarm_modify_file` | 智能修改文件 | 在现有代码中添加字段 |
| `swarm_list_directory` | 列出目录结构 | 查看项目结构 |
| `swarm_search_files` | 搜索文件 | 查找所有 *.service.ts 文件 |

### 代码库搜索工具

| 工具名称 | 功能 | 示例 |
|---------|------|------|
| `swarm_search_code` | 搜索代码内容 | 查找所有使用 UserService 的地方 |
| `swarm_build_index` | 构建代码索引 | 索引整个 Monorepo 项目 |

---

## 🔧 工具详细说明

### 1. swarm_read_file - 读取文件

**用途**: 读取现有文件内容，了解项目结构和代码风格。

**参数**:
- `path` (必填): 文件路径（相对于项目根目录）
- `projectRoot` (可选): 项目根目录路径

**示例**:

```bash
# 读取 User Entity
/swarm_read_file
  path: apps/backend/src/entities/user.entity.ts
  projectRoot: e:\test-monorepo

# 读取前端组件
/swarm_read_file
  path: apps/frontend/src/components/UserProfile.tsx
  projectRoot: e:\test-monorepo
```

**输出**:
```
📄 文件：e:\test-monorepo\apps\backend\src\entities\user.entity.ts
大小：1.23 KB
修改时间：2026/2/25 13:24:00

--- 文件内容 ---
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50, unique: true })
  username: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  email: string;
}
--- 结束 ---
```

---

### 2. swarm_write_file - 写入文件

**用途**: 创建新文件或覆盖现有文件（会自动备份）。

**参数**:
- `path` (必填): 文件路径
- `content` (必填): 文件内容
- `projectRoot` (可选): 项目根目录

**示例**:

```bash
# 创建 Migration 文件
/swarm_write_file
  path: database/migrations/20240102_add_vip_level.sql
  content: |
    ALTER TABLE users 
    ADD COLUMN vip_level INT NOT NULL DEFAULT 0;
  projectRoot: e:\test-monorepo

# 创建 React 组件
/swarm_write_file
  path: apps/frontend/src/components/VipBadge.tsx
  content: |
    import React from 'react';
    
    interface VipBadgeProps {
      level: number;
    }
    
    export const VipBadge: React.FC<VipBadgeProps> = ({ level }) => {
      return <span>VIP {level}</span>;
    };
  projectRoot: e:\test-monorepo
```

**输出**:
```
✅ 文件已写入
路径：e:\test-monorepo\database\migrations\20240102_add_vip_level.sql
大小：0.08 KB
备份：e:\test-monorepo\database\migrations\20240102_add_vip_level.sql.backup.2026-02-25T13-30-00-000Z
```

---

### 3. swarm_modify_file - 修改文件

**用途**: 智能修改现有文件内容（查找替换），支持多条替换规则。

**参数**:
- `path` (必填): 文件路径
- `replacements` (必填): 替换规则列表
  - `search`: 要查找的内容
  - `replace`: 替换为
- `projectRoot` (可选): 项目根目录

**示例**:

```bash
# 在 User Entity 中添加 vip_level 字段
/swarm_modify_file
  path: apps/backend/src/entities/user.entity.ts
  replacements:
    - search: "email: string;"
      replace: |
        email: string;

        @Column({ type: 'int', default: 0 })
        vip_level: number;
    - search: "@Column({ type: 'varchar', length: 100, unique: true })"
      replace: "@Column({ type: 'varchar', length: 100, unique: true, select: true })"
  projectRoot: e:\test-monorepo
```

**输出**:
```
✅ 文件已修改
路径：e:\test-monorepo\apps\backend\src\entities\user.entity.ts
变更数：2
备份：e:\test-monorepo\apps\backend\src\entities\user.entity.ts.backup.2026-02-25T13-35-00-000Z

变更详情:
  第 12 行:
    -   email: string;
    +   email: string;
    + 
    +   @Column({ type: 'int', default: 0 })
    +   vip_level: number;
  第 8 行:
    -   @Column({ type: 'varchar', length: 100, unique: true })
    +   @Column({ type: 'varchar', length: 100, unique: true, select: true })
```

---

### 4. swarm_list_directory - 列出目录

**用途**: 查看项目目录结构。

**参数**:
- `path` (可选): 目录路径，默认为项目根目录
- `maxDepth` (可选): 最大深度，默认 3
- `projectRoot` (可选): 项目根目录

**示例**:

```bash
# 查看项目结构
/swarm_list_directory
  projectRoot: e:\test-monorepo
  maxDepth: 2

# 查看特定目录
/swarm_list_directory
  path: apps/backend/src
  projectRoot: e:\test-monorepo
```

**输出**:
```
📁 test-monorepo
  📁 apps
    📁 frontend
      📁 src
        📁 components
    📁 backend
      📁 src
        📁 entities
        📁 services
  📁 database
    📁 migrations
```

---

### 5. swarm_search_files - 搜索文件

**用途**: 按文件名模式搜索文件。

**参数**:
- `pattern` (必填): 文件模式，支持通配符
- `projectRoot` (可选): 项目根目录

**示例**:

```bash
# 搜索所有 TypeScript 文件
/swarm_search_files
  pattern: "*.ts"
  projectRoot: e:\test-monorepo

# 搜索所有 user 相关文件
/swarm_search_files
  pattern: "user.*.ts"
  projectRoot: e:\test-monorepo

# 搜索所有 React 组件
/swarm_search_files
  pattern: "*.tsx"
  projectRoot: e:\test-monorepo
```

**输出**:
```
找到 15 个匹配 "*.ts" 的文件:

  - e:\test-monorepo\apps\backend\src\entities\user.entity.ts
  - e:\test-monorepo\apps\backend\src\services\user.service.ts
  - e:\test-monorepo\apps\frontend\src\types\user.ts
  - e:\test-monorepo\apps\frontend\src\api\user.ts
  ...
```

---

### 6. swarm_search_code - 代码搜索

**用途**: 在代码库中搜索文本内容（使用 ripgrep）。

**参数**:
- `query` (必填): 搜索内容
- `filePattern` (可选): 文件模式
- `maxResults` (可选): 最大结果数，默认 50
- `projectRoot` (可选): 项目根目录

**示例**:

```bash
# 搜索所有使用 UserService 的地方
/swarm_search_code
  query: "UserService"
  projectRoot: e:\test-monorepo

# 在 TypeScript 文件中搜索
/swarm_search_code
  query: "interface User"
  filePattern: "*.ts"
  projectRoot: e:\test-monorepo

# 搜索 API 调用
/swarm_search_code
  query: "fetchUser|getUser"
  maxResults: 20
  projectRoot: e:\test-monorepo
```

**输出**:
```
找到 8 个匹配 "UserService" 的代码位置:

1. **e:\test-monorepo\apps\backend\src\services\user.service.ts:7**
   `export class UserService {`

2. **e:\test-monorepo\apps\backend\src\controllers\user.controller.ts:3**
   `import { UserService } from '../services/user.service';`

3. **e:\test-monorepo\apps\backend\src\index.ts:12**
   `const userService = new UserService();`
...
```

---

### 7. swarm_build_index - 构建代码索引

**用途**: 构建整个代码库的索引，用于快速搜索和导航。

**参数**:
- `projectRoot` (必填): 项目根目录

**示例**:

```bash
# 构建索引
/swarm_build_index
  projectRoot: e:\test-monorepo
```

**输出**:
```
✅ 代码库索引构建完成

项目根目录：e:\test-monorepo
耗时：12.5 秒
索引文件数：245
符号数量：1,832
构建时间：2026/2/25 13:40:00

📊 文件类型分布:
  - .ts: 120 个文件
  - .tsx: 45 个文件
  - .js: 35 个文件
  - .sql: 15 个文件
  - .json: 30 个文件
```

---

## 🎯 实战场景

### 场景 1: 全链路需求变更（带文件操作）

**任务**: 给 User 表添加 vip_level 字段

**步骤**:

#### 1. 先探索项目结构
```bash
/swarm_list_directory
  projectRoot: e:\test-monorepo
  maxDepth: 3
```

#### 2. 读取现有 User Entity
```bash
/swarm_read_file
  path: apps/backend/src/entities/user.entity.ts
  projectRoot: e:\test-monorepo
```

#### 3. 读取现有前端组件
```bash
/swarm_read_file
  path: apps/frontend/src/components/UserProfile.tsx
  projectRoot: e:\test-monorepo
```

#### 4. 创建 Migration
```bash
/swarm_write_file
  path: database/migrations/20240102_add_vip_level.sql
  content: |
    ALTER TABLE users ADD COLUMN vip_level INT NOT NULL DEFAULT 0;
    
    -- 回滚
    -- ALTER TABLE users DROP COLUMN vip_level;
  projectRoot: e:\test-monorepo
```

#### 5. 修改 User Entity
```bash
/swarm_modify_file
  path: apps/backend/src/entities/user.entity.ts
  replacements:
    - search: "email: string;"
      replace: |
        email: string;

        @Column({ type: 'int', default: 0 })
        vip_level: number;
  projectRoot: e:\test-monorepo
```

#### 6. 修改前端组件
```bash
/swarm_modify_file
  path: apps/frontend/src/components/UserProfile.tsx
  replacements:
    - search: "<label>邮箱:</label>"
      replace: |
        <label>会员等级:</label>
        <select value={user.vip_level} onChange={...}>
          <option value={0}>普通</option>
          <option value={1}>VIP 1</option>
        </select>

        <label>邮箱:</label>
  projectRoot: e:\test-monorepo
```

---

### 场景 2: 代码重构

**任务**: 将所有 Class Component 重构为 Function Component

**步骤**:

#### 1. 搜索所有 Class Component
```bash
/swarm_search_code
  query: "extends React.Component"
  filePattern: "*.tsx"
  projectRoot: e:\test-monorepo
```

#### 2. 读取第一个组件
```bash
/swarm_read_file
  path: apps/frontend/src/components/OldComponent.tsx
  projectRoot: e:\test-monorepo
```

#### 3. 创建新的 Function Component
```bash
/swarm_write_file
  path: apps/frontend/src/components/NewComponent.tsx
  content: |
    import React, { useState } from 'react';
    
    // Function Component with Hooks
    export const NewComponent: React.FC<Props> = (props) => {
      const [state, setState] = useState(initialState);
      
      return <div>{/* ... */}</div>;
    };
  projectRoot: e:\test-monorepo
```

---

### 场景 3: 批量添加日志

**任务**: 给所有 Service 类添加日志

**步骤**:

#### 1. 搜索所有 Service 文件
```bash
/swarm_search_files
  pattern: "*.service.ts"
  projectRoot: e:\test-monorepo
```

#### 2. 对每个文件添加日志
```bash
/swarm_modify_file
  path: apps/backend/src/services/user.service.ts
  replacements:
    - search: "export class UserService {"
      replace: |
        export class UserService {
          private logger = new Logger('UserService');
    - search: "async create"
      replace: |
        async create(data: CreateUserDto): Promise<User> {
          this.logger.log('Creating user', data);
```

---

## ✅ 安全特性

### 1. 自动备份
所有修改操作都会自动创建备份：
```
文件.backup.时间戳
```

### 2. 路径安全检查
防止路径遍历攻击，只允许访问指定目录：
```typescript
// 只允许访问这些目录
allowedPrefixes = ["apps/", "packages/", "services/", "database/", "src/"];
```

### 3. 原子操作
修改失败时会自动回滚到备份。

### 4. 恢复备份
```bash
# 可以通过文件系统工具恢复
await tools.restoreBackup('path/to/file.ts');
```

---

## 🚀 最佳实践

### 1. 先读后写
修改文件前先读取，了解现有代码风格。

### 2. 小步修改
不要一次性修改太多，分多次小修改更安全。

### 3. 验证修改
修改后读取文件确认变更正确。

### 4. 使用备份
重要修改前手动备份：
```bash
# 先读取保存
/swarm_read_file path: ...
# 修改
/swarm_modify_file path: ...
# 如有问题，手动恢复备份文件
```

---

## 📝 注意事项

1. **项目根目录必须指定**: 所有文件操作都需要 `projectRoot` 参数
2. **路径相对性**: `path` 参数是相对于 `projectRoot` 的
3. **备份管理**: 每个文件最多保留 10 个备份，自动清理
4. **目录限制**: 默认只允许访问 `apps/`, `packages/`, `services/`, `database/`, `src/`

---

现在，让我们用这些新工具**复测测试用例 2**！
