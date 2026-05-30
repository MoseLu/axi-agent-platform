# 工业级 Code Swarm 测试计划

## 测试环境准备

### 目标项目
选择一个真实的 Monorepo 全栈项目进行测试。

**推荐项目结构**:
```
ecommerce-monorepo/
├── apps/
│   ├── frontend/          # React + TypeScript
│   ├── backend/           # Node.js + TypeORM
│   └── admin/             # Vue + TypeScript
├── packages/
│   ├── shared/            # 共享类型和工具
│   └── ui-kit/            # UI 组件库
├── services/
│   ├── api-gateway/       # API 网关
│   ├── user-service/      # 用户服务
│   └── order-service/     # 订单服务
├── database/
│   ├── migrations/        # 数据库迁移
│   └── seeds/             # 种子数据
└── docker/
    ├── docker-compose.yml
    └── Dockerfile
```

### 测试工具
- ripgrep (rg) - 代码搜索
- tree-sitter - AST 解析
- Git - 版本控制
- Docker - 容器化环境

---

## 测试用例 1: 代码库索引能力验证

### 1.1 全局符号搜索

**指令**:
```
在这个代码库中搜索所有名为 "UserService" 的类和函数，
列出它们所在的文件路径、行号和简要说明。
```

**验证点**:
- [ ] 是否找到了所有相关文件？
- [ ] 路径和行号是否准确？
- [ ] 是否区分了 class UserService 和 function userService？

**预期输出**:
```
找到 5 个匹配:

1. apps/backend/src/services/user.service.ts:15
   - class UserService
   - 用户业务逻辑服务类

2. apps/admin/src/services/user.service.ts:22
   - class UserService  
   - 管理后台用户服务

3. packages/shared/src/types/user.ts:8
   - interface UserService
   - 用户服务接口定义

4. services/user-service/src/index.ts:5
   - const userService = new UserService()
   - 服务实例导出

5. apps/frontend/src/api/user.ts:12
   - function userService()
   - 前端 API 调用封装
```

---

## 测试用例 2: 全链路需求变更 ⭐ 核心测试

### 场景描述
给电商系统添加"会员等级"功能。

**指令**:
```
需求变更：给'用户'表增加一个'会员等级 (vip_level)'字段，类型是 INT，默认值为 0。

要求按顺序完成:
1. 创建数据库 Migration 脚本
2. 修改后端 User Entity 和 DTO
3. 修改前端用户资料编辑页面，增加 VIP 等级选择
4. 确保类型定义一致

项目路径：
- 数据库：database/migrations/
- 后端：apps/backend/src/
- 前端：apps/frontend/src/
- 共享类型：packages/shared/src/types/
```

**验证流程**:

#### Step 1: 代码库探索
```bash
# Swarm 应该先探索项目结构
1. 找到 User 相关的表定义
2. 找到 User Entity/Model
3. 找到前端用户相关组件
4. 找到共享类型定义
```

#### Step 2: 任务拆解
```
任务拆解:
├─ DBEngineerAgent: 创建 Migration
│  └─ 文件：database/migrations/YYYYMMDD_add_vip_level_to_users.sql
│
├─ BackendAgent: 修改后端代码
│  ├─ 文件：apps/backend/src/entities/user.entity.ts
│  ├─ 文件：apps/backend/src/dto/user.dto.ts
│  └─ 文件：apps/backend/src/services/user.service.ts
│
├─ FrontendAgent: 修改前端代码
│  ├─ 文件：apps/frontend/src/components/UserProfile.tsx
│  ├─ 文件：apps/frontend/src/types/user.ts
│  └─ 文件：apps/frontend/src/api/user.ts
│
└─ QAAgent: 验证
   ├─ 检查类型一致性
   └─ 运行 TypeScript 编译
```

#### Step 3: 执行验证

**DB Migration 验证**:
```sql
-- 预期生成的 Migration
ALTER TABLE users 
ADD COLUMN vip_level INT NOT NULL DEFAULT 0;

-- 回滚脚本
ALTER TABLE users DROP COLUMN vip_level;
```

**后端验证**:
```typescript
// User Entity - 应该有 vip_level 字段
@Entity('users')
export class User {
  // ... 其他字段
  @Column({ type: 'int', default: 0 })
  vip_level: number;
}

// DTO - 应该包含 vip_level
export class UpdateUserDto {
  // ... 其他字段
  @IsInt()
  @Min(0)
  @Max(5)
  vip_level?: number;
}
```

**前端验证**:
```tsx
// UserProfile 组件 - 应该有 VIP 选择器
<Select
  label="会员等级"
  value={formData.vip_level}
  onChange={...}
>
  <Option value={0}>普通会员</Option>
  <Option value={1}>VIP 1</Option>
  <Option value={2}>VIP 2</Option>
  <Option value={3}>VIP 3</Option>
</Select>
```

**验证清单**:
- [ ] Migration 可执行（无语法错误）
- [ ] Entity 字段类型正确（INT）
- [ ] DTO 有验证逻辑（范围 0-5）
- [ ] 前端类型定义一致
- [ ] TypeScript 编译通过
- [ ] API 请求/响应类型匹配

---

## 测试用例 3: Git 操作验证

### 场景
将测试用例 2 的修改提交到 Git 并创建 MR。

**指令**:
```
基于当前 dev 分支，创建 feature/vip-level 分支。
提交所有修改，使用 Conventional Commits 规范。
生成 Pull Request 描述。
```

**验证点**:
- [ ] 是否正确创建分支？
- [ ] Commit Message 是否符合规范？
- [ ] 是否只提交了源代码（排除 node_modules、dist 等）？
- [ ] PR 描述是否完整？

**预期 Commit Message**:
```
feat(user): add vip_level field to user model

- Add vip_level column to users table (Migration)
- Update User entity and DTO
- Add vip_level to frontend UserProfile component
- Update shared types

Closes: #123
```

**预期 PR 描述**:
```markdown
## 变更说明
添加用户会员等级功能

## 变更列表
- [数据库] 添加 vip_level 字段
- [后端] 更新 User Entity 和 DTO
- [前端] 添加 VIP 等级选择器
- [类型] 更新共享类型定义

## 测试
- [x] TypeScript 编译通过
- [ ] E2E 测试待补充

## 截图
（如有 UI 变更）
```

---

## 测试用例 4: CI/CD 验证

### 场景
运行项目的 Lint 和 Test，并修复错误。

**指令**:
```
运行项目的 lint 和 test 命令，如果有错误请自动修复。
```

**验证流程**:
```bash
# 1. 运行 Lint
pnpm lint

# 2. 如果有错误，Swarm 应该:
#    - 读取错误信息
#    - 定位到具体文件和行号
#    - 自动修复或给出修复建议

# 3. 运行测试
pnpm test

# 4. 处理失败的测试
```

**验证点**:
- [ ] 是否能正确解析 ESLint 错误？
- [ ] 是否能自动修复简单问题（如 missing semicolon）？
- [ ] 是否能识别测试失败原因？
- [ ] 是否会无限循环尝试修复？

---

## 测试用例 5: 并行任务处理

### 场景
同时执行多个独立任务。

**指令**:
```
同时处理以下任务:
1. 给所有 Python 文件添加 Docstring
2. 重构 React Class Components 为 Hooks
3. 运行测试并修复失败用例
```

**验证点**:
- [ ] 三个任务是否同时开始？
- [ ] 是否有文件冲突？
- [ ] 如果一个任务失败，其他任务是否继续？
- [ ] CPU/内存使用情况如何？

---

## 评分标准

### A+ (工业级)
- ✅ 所有测试用例 100% 通过
- ✅ 生成的代码可直接运行
- ✅ 无类型错误
- ✅ Git 操作规范
- ✅ CI 全绿

### A (优秀)
- ✅ 核心功能（测试用例 2）完全通过
- ✅ 代码质量高，只需少量手动调整
- ⚠️ 少数边缘情况需要人工干预

### B (良好)
- ✅ 主要功能实现
- ⚠️ 需要人工修复部分错误
- ⚠️ 类型定义有小问题

### C (及格)
- ⚠️ 基本功能实现
- ❌ 需要大量手动修复
- ❌ 类型不一致

### D (不及格)
- ❌ 无法完成核心任务
- ❌ 生成的代码无法运行
- ❌ 严重类型错误

---

## 执行顺序

1. **准备阶段** (30 分钟)
   - 准备测试项目
   - 安装必要工具
   - 配置环境变量

2. **测试用例 1** (15 分钟)
   - 代码库索引
   - 符号搜索

3. **测试用例 2** ⭐ (60 分钟)
   - 全链路需求变更
   - 核心验证

4. **测试用例 3** (30 分钟)
   - Git 操作
   - MR 创建

5. **测试用例 4** (30 分钟)
   - CI/CD验证
   - 自动修复

6. **总结** (15 分钟)
   - 评分
   - 问题记录
   - 改进建议

**总耗时**: 约 3 小时

---

## 测试报告模板

```markdown
# Code Swarm 测试报告

## 测试日期
2026-02-25

## 测试项目
[项目名称/链接]

## 测试用例结果

### 用例 1: 代码库索引
- 得分：[A/B/C/D]
- 备注：...

### 用例 2: 全链路需求变更 ⭐
- 得分：[A/B/C/D]
- 生成的文件数：X
- 类型错误数：Y
- 编译结果：通过/失败

### 用例 3: Git 操作
- 得分：[A/B/C/D]
- 分支创建：✓/✗
- Commit 规范：✓/✗
- PR 描述质量：...

### 用例 4: CI/CD
- 得分：[A/B/C/D]
- Lint 错误修复率：X%
- 测试通过率：Y%

## 总体评分
[A/B/C/D]

## 优点
1. ...
2. ...

## 需要改进
1. ...
2. ...

## 结论
[是否具备工业级生产力]
```

---

现在，让我们开始**测试用例 1** 的实战验证！
