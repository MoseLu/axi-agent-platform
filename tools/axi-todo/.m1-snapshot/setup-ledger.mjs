import fs from "node:fs/promises";
import path from "node:path";
import { TaskStore } from "/Volumes/code/workspace/agent-cluster/axi-agent/tools/axi-todo/lib/store.mjs";

const home = "/Volumes/code/workspace/agent-cluster/axi-agent/tools/axi-todo/.m1-snapshot/ledger";
const store = new TaskStore({ home });

// M1 持久主任务：本次里程碑 (taskDomain=personal → 手动完成独立，不走 evidence gate)
const milestone = await store.addTask({
  title: "M1: Axi Todo 可信完成与统一账本",
  prompt: "本里程碑: 让 harness-task 信任度可被审计;修复完成 gate;统一多 backend;让 desktop/CLI/MCP/daemon 看到同一份事实在;个人待办手动完成语义独立。",
  taskDomain: "personal",
  lifecycleStatus: "open",
  executionStatus: "idle",
  dueDate: "2026-10-04",
  acceptanceChecks: [
    "A1: 同 task 在 JSON/PG/daemon/MCP/Swift 状态相同",
    "A2: 缺证据/验证失败/旧版本证据/直接 updateTask->completed 均拒绝工程 completed",
    "A3: personal task 手动完成保持独立",
    "A4: 迁移/备份/对账/恢复方案可复查",
  ],
  auditLevel: "none",
  riskLevel: "medium",
});

// 子任务：每个验收 case + 实施步骤
const subTasks = [
  { id: "M1.S1", title: "提取共享 completion gate 到 lib/completion-gate.mjs", deps: [] },
  { id: "M1.S2", title: "让 JSON store.completeTask + markVerificationResult + updateTask->completed 走 gate", deps: ["M1.S1"] },
  { id: "M1.S3", title: "让 PG postgres-store.completeTask + markVerificationResult + updateTask->completed 走 gate", deps: ["M1.S1"] },
  { id: "M1.S4", title: "codex-runner propagate task.evidenceContract/auditLevel/verification 给 result", deps: ["M1.S1"] },
  { id: "M1.S5", title: "Swift AxiTodoStore.updateStatus + saveTask 加 Swift mirror gate", deps: ["M1.S1"] },
  { id: "M1.S6", title: "补回归测试：缺证据/验证失败/旧证据/直接 update/个人手动 5 类", deps: ["M1.S2", "M1.S3", "M1.S5"] },
  { id: "M1.S7", title: "运行 evidence-guardrails + 新测试 + 复现脚本三件套", deps: ["M1.S6"] },
  { id: "M1.S8", title: "按 Lore Commit Protocol 提交 + 任务账本更新 run/checkpoint", deps: ["M1.S7"] },
];

const subIdByTag = new Map();
for (const sub of subTasks) {
  const t = await store.addTask({
    title: `[${sub.id}] ${sub.title}`,
    prompt: `${sub.title}\n\n依赖: ${sub.deps.length ? sub.deps.join(", ") : "(无)"}\n验证: 跑相应测试 + 记录 checkpoint`,
    taskDomain: "personal",
    lifecycleStatus: "open",
    executionStatus: "idle",
    dueDate: "2026-10-03",
    priority: 50,
    parentId: milestone.id,
    auditLevel: "none",
  });
  subIdByTag.set(sub.id, t.id);
}

// 记录依赖（按 ID 关联）
const tagToId = subIdByTag;
for (const sub of subTasks) {
  if (!sub.deps.length) continue;
  const depIds = sub.deps.map((d) => tagToId.get(d)).filter(Boolean);
  const t = await store.getTask(tagToId.get(sub.id));
  await store.updateTask(t.id, { dependsOn: depIds, subTaskTag: sub.id });
}

// 写一份 ledger 入口到 json/m1-entries.json
const out = {
  milestoneId: milestone.id,
  milestoneStatus: milestone.status,
  subTasks: subTasks.map((sub) => ({ tag: sub.id, id: tagToId.get(sub.id), deps: sub.deps })),
};
await fs.writeFile(
  path.join(home, "m1-entries.json"),
  JSON.stringify(out, null, 2)
);
console.log(JSON.stringify(out, null, 2));
