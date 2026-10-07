# 2026-09-28 — axi-agent backup-dev-20260822094638 迁移 disclose

## 任务 / 目标

按 todo 文档 §5 B-2 方案(c) 与用户最新策略"新建同内容分支取代"，
将 axi-agent 的违规分支 `backup-dev-20260822094638` 替换为合规的
`agent/backup-dev-20260822094638`（ADR-011 whitelist 允许的 `agent/*` 前缀）。

## 分支领先分析

```
$ git rev-list --count dev..backup-dev-20260822094638
29
$ git rev-list --count --cherry-pick dev..backup-dev-20260822094638
29
$ git rev-list --count origin/main..backup-dev-20260822094638
70
```

29 unique commits ahead of dev，全部领先 origin/main 70 commits。

## commit 类型分布（按 conventional commit 标题）

| 类型 | 数量 | 处理 |
|---|---|---|
| `chore(batch)` | 11 | AR-GIT-010 违规模板（todo §6 C-2 已记录），不迁移 |
| `chore(hooks)` / `ci(hooks)` | 6 | 老 hooks infra（被 HEAD 取代），不迁移 |
| UI 调整（`Stop stretching`、`Tighten`、`Remove`、`Set`、`Match`） | 6 | 5/6 已应用，仅 4/18 真未应用（迁移 4 + 1个 empty marker） |
| `chore(packages)` pin desktop glass pnpm | 1 | 已应用，不迁移 |
| `feat(agent-runtime)` bounded workflow routes | 1 | 已应用，不迁移 |
| `chore` CLAUDE.md redirect | 1 | 迁移（HEAD 没有 CLAUDE.md） |
| 其他 hooks-related (record workspace hook submit log 等) | 3 | 老 hooks infra，不迁移 |

## 实际迁移的 5 个 commits

按时间正序排列（最早→最新），每个 commit 保留原 author + 原 commit message + 加迁移标注 + 5 Lore trailer：

| New SHA | Old SHA | Subject | Files |
|---|---|---|---|
| f6cc26f | 6a4f5a2 | Tighten the glass shell navigation density | Sidebar.tsx + Chat.tsx（4/6 已应用） |
| ce23ab0 | fbe06bd | Set the chat composer side inset to ten pixels | Chat.tsx +2/-2 |
| 74bce7b | f23df66 | Match the chat composer internal padding to ten pixels | Chat.tsx +1/-1 |
| cc57c7e | 989fc4e | Remove the empty chat stub from the glass sidebar | Sidebar.tsx -7（empty marker，owner dev 已应用） |
| 6224121 | 4f29359 | chore: add CLAUDE.md redirect | CLAUDE.md +3 |

## 不迁移的 commits 与原因

### 11 个 `chore(batch)`（AR-GIT-010 违规模板）

`4297966 a33bcbc 83b081e c151fa1 df5fef8 03c1e94 531880a fd52b48 7be3a24 e8c165a 20bc940`

按 AR-GIT-010 模板化批量提交，违反 1-commit-per-intent-group 规则。todo §6 C-2 已要求
整体 revert 这些 commits，不应在 migration 分支中复活。owner dev 当前已通过其他路径
吸收了这些 commits 的核心内容（dedupe, mirror paths, sources.lock.json 等等）；保留
batch commits 等于重新引入违规模式。

### 8 个 `chore(hooks)` / `ci(hooks)` 老 hooks infra

`8569729 828e823 d377f47 6add62d 0215654 9bef113 76c281e bfd5e82`

这些 commits 修改 `.githooks/post-commit` 或 `.githooks/commit-msg` 或添加
`.github/workflows/axi-rules-hooks.yml`。在 owner dev HEAD 上 hooks 文件已被
`workspace-git-hooks.mjs install` 重新生成（41 行新版本，包含更复杂的 governance
discovery loop），而 backup-dev tip 上的版本是 16 行老版本（直接指向
`infra/axi-workspace-governance/...`）。

迁移这些 commits 等于把 owner 已经升级的 hooks 倒退到老版本（错误）。owner dev 上的
`.github/workflows/axi-rules-hooks.yml` 已经是 v2 workflow（commit 76c281e 中已经
完成 git clone 改造），HEAD 上的版本比 backup-dev tip 更现代。

最终决策：**不迁移**。这 8 个 commits 的"价值"已被 HEAD 上的更新版本取代。

### 1 个 `92981d9 axi-todo: evidence guardrails + drop relocated root docs`

owner dev HEAD 上已经有 `axi-todo` 脚本和 AGENTS.md 链，evidence guardrails
逻辑已被同步应用。1/1 文件已应用，无需迁移。

### 1 个 `8acff81 chore(packages): pin desktop glass pnpm version`

1/1 文件已应用（desktop glass 的 pnpm 锁定版本已生效），无需迁移。

### 1 个 `6e2a27e feat(agent-runtime): enforce bounded workflow routes`

1/1 文件已应用（owner dev 上 workflow routes 边界已生效），无需迁移。

## owner dev dirty 处理

执行前 owner 在 dev dirty 工作树：
- `M CHANGELOG.md`
- `M backend/app/config.py`
- `M backend/app/core/workflow_event_client.py`
- `M backend/tests/test_workflow_event_client.py`
- `M docs/HANDOFF.md`
- `M infra/axi-agent-mcp/README.zh-CN.md`（对应 todo #70 fix，已在另一路径处理）
- `M tools/axi-feishu-codex-bridge`（gitlink modified）
- 大量 untracked submit logs（gitignored）

策略：`git stash push -u` 暂存全部 dirty → checkout -b agent/backup-dev-20260822094638
→ 5 个 migration commits（不动 dirty 文件）→ 待回到 dev 后 `git stash pop` 恢复 dirty。

注：stash 中 `tools/axi-feishu-codex-bridge` gitlink 状态 checkout 后需要在 agent
分支上 unstage 避免污染（不通过 `git add` 或 commit 操作）。最终 checkout dev 时会
自动恢复 dirty 状态。

## 剩余风险 / remaining risks

| 风险 | 等级 | 说明 |
|------|------|------|
| 8 个 hooks infra commits 不迁移 = 旧 hooks 路径信息丢失 | L1 | HEAD 上 hooks 已升级到新版本（axi-workspace-git-hooks.mjs generate），路径信息在新版中保留；老路径 `/Volumes/code/workspace/infra/axi-workspace-governance/...` 在迁移时已迁移到 `/Volumes/code/workspace/foundation/workspace-governance/...`，HEAD 版本自动反映新路径。 |
| 11 个 batch commits 信息丢失 | L1 | 按 AR-GIT-010 规则明确禁止，不应保留。todo §6 C-2 已规划整体 revert。 |
| 5 commits 迁移到 agent/backup-dev-20260822094638 分支后 owner 是否要 merge 到 dev | L2 | 等待 owner 决策（按 AR-GIT-004 push/merge 是 owner 权限）。当前 owner dev already has CHANGELOG.md dirty，agent 分支在 fast-forward 后可与 dev 合并。 |
| change ledger 模块路径错误 (`/Volumes/code/workspace/foundation/workspace-governance/scripts/workspace-change-ledger.mjs` not found) | L0 | 每次 commit 都报一次但不影响 commit 成功；需要 foundation/workspace-governance 侧修复路径（基础架构问题，与本次任务无关）。 |