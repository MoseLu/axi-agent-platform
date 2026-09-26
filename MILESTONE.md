# Axi Agent Milestone

> 由 audit-remediation 2026-09-25 自动生成基础结构；后续 entry 与 evidence 由项目 owner 维护。
> 当前 stage: `active-development`

## M1: Handoff-check 闭环

- **Status**: active
- **Goal**: 完成 handoff-check 闭环（documented 或 verified 状态）
- **Evidence**:
  - `AGENTS.md`、`docs/HANDOFF.md`（如尚未创建，需补齐）
  - `workspace-project handoff-check <project-id>` 输出
- **Verify**: `workspace-project validate` ok；`handoff-check` 返回 `documented` 或 `verified`。

## M2: PRD 内容化

- **Status**: pending
- **Goal**: PRD 进入真实内容阶段（替换 stub）
- **Evidence**:
  - `PRD.md` 替换为真实产品/能力内容（去除 placeholder）
  - 至少 1 条可被外部观察的 acceptance criterion
- **Verify**: `PRD.md` 不含 "TODO" / "placeholder" 字样；与 `docs/HANDOFF.md` currentWork 一致。

## M3: 下一生命周期阶段

- **Status**: pending
- **Goal**: 基于 stage=active-development 自动判断的下一阶段推进
- **Evidence**:
  - 当前 stage: `active-development`
  - 推进目标依据 `docs/policies/project-lifecycle-and-release.md`（project-maturity-v1 决策记录）
- **Verify**: `workspace.json` / `workspace.graph.json` 中本项目的 `stage` / `status` / `tier` 字段与 M3 目标一致。

---

## Notes

- 每个里程碑的 status 必须由 evidence 支撑，禁止凭口头标记 `completed`。
- 当 M1→M2→M3 顺序出现阻塞时，把阻塞项升级到 `foundation/axi-rules/todo/` 并在 `TODO.md` 写明 ID。
- Stage 字段（如 `incubation` / `candidate` / `feature-stage` / `active-development` / `product`）从 `workspace.graph.json` 读取。
