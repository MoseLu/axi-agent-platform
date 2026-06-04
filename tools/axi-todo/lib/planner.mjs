import path from "node:path";

const DEFAULT_TARGET_READY = 24;
const MAX_TARGET_READY = 64;

const TASK_TEMPLATES = [
  {
    taskKind: "inspect",
    agentRole: "explore",
    agentCategory: "quick",
    executionMode: "inspect",
    title: "Map the current implementation boundary",
    prompt: "Inspect the relevant code paths for this goal. Identify the smallest files/modules to touch, current tests, likely resource conflicts, and concrete acceptance criteria. Do not edit files unless the inspection itself requires a harmless generated report.",
    riskLevel: "low",
    estimatedCostPercent: 3,
    evidenceContract: "Include file paths inspected, current behavior, and the recommended implementation slice boundaries.",
  },
  {
    taskKind: "test",
    agentRole: "atlas",
    agentCategory: "quick",
    executionMode: "verify",
    title: "Add or tighten focused regression coverage",
    prompt: "Add the smallest regression coverage that locks the intended behavior for this goal. Keep the test focused on one behavior surface and avoid broad refactors.",
    riskLevel: "medium",
    estimatedCostPercent: 6,
    evidenceContract: "Include changed test files and the exact test command/output.",
  },
  {
    taskKind: "edit",
    agentRole: "sisyphus-junior",
    agentCategory: "deep",
    executionMode: "worker",
    title: "Implement one narrow behavior slice",
    prompt: "Implement one narrow, independently reviewable behavior slice for this goal. Stay inside the resource boundary and avoid unrelated cleanup.",
    riskLevel: "medium",
    estimatedCostPercent: 8,
    evidenceContract: "Include changed files, behavior summary, and verification evidence.",
  },
  {
    taskKind: "verify",
    agentRole: "atlas",
    agentCategory: "quick",
    executionMode: "verify",
    title: "Run targeted verification and capture evidence",
    prompt: "Run the closest meaningful verification for this goal. Fix only small issues directly caused by the target slice; otherwise report blockers with exact commands.",
    riskLevel: "low",
    estimatedCostPercent: 4,
    evidenceContract: "Include commands, exit codes, key output, and any remaining risk.",
  },
  {
    taskKind: "doc",
    agentRole: "librarian",
    agentCategory: "writing",
    executionMode: "write",
    title: "Update concise user/developer documentation",
    prompt: "Update only the documentation needed to make this goal understandable and repeatable. Do not rewrite unrelated sections.",
    riskLevel: "low",
    estimatedCostPercent: 3,
    evidenceContract: "Include changed docs and a short summary of the documented workflow.",
  },
];

export function createSplitPlan({
  goal,
  cwd = process.cwd(),
  targetReady = DEFAULT_TARGET_READY,
  verifyCommand = "",
  priority = 0,
  parentId = "",
  resourcePrefix = "",
} = {}) {
  const text = requiredText(goal, "goal");
  const root = path.resolve(String(cwd || process.cwd()));
  const count = Math.max(1, Math.min(MAX_TARGET_READY, Number.parseInt(targetReady, 10) || DEFAULT_TARGET_READY));
  const prefix = resourcePrefix || compactResourcePrefix(root);
  const tasks = [];
  for (let index = 0; index < count; index += 1) {
    const template = TASK_TEMPLATES[index % TASK_TEMPLATES.length];
    const slice = Math.floor(index / TASK_TEMPLATES.length) + 1;
    const title = `${template.title} (${slice})`;
    tasks.push({
      title,
      prompt: buildPrompt({ goal: text, template, index, count }),
      cwd: root,
      priority: normalizePriority(priority),
      maxAttempts: 2,
      verifyCommand: verifyCommand || defaultVerifyCommand(template.taskKind),
      parentId: parentId || undefined,
      dependsOn: [],
      resourceKeys: [`${prefix}:${template.taskKind}:${slice}`],
      taskKind: template.taskKind,
      estimatedCostPercent: template.estimatedCostPercent,
      riskLevel: template.riskLevel,
      plannerConfidence: 0.55,
      evidenceContract: template.evidenceContract,
      agentRole: template.agentRole,
      agentCategory: template.agentCategory,
      executionMode: template.executionMode,
      parallelGroup: `${prefix}:${template.agentCategory}`,
      maxParallelGroup: defaultMaxParallelGroup(template.agentCategory),
    });
  }
  return {
    goal: text,
    cwd: root,
    targetReady: count,
    planner: "axi-todo-deterministic-v1",
    tasks,
  };
}

function buildPrompt({ goal, template, index, count }) {
  return `Goal:
${goal}

Slice ${index + 1} of ${count}: ${template.prompt}

Constraints:
- Keep the change small enough for one worker to finish with evidence.
- Do not broaden scope beyond this slice.
- Preserve unrelated local edits.
- Final answer must include an Evidence section.

Evidence contract:
${template.evidenceContract}`;
}

function defaultVerifyCommand(taskKind) {
  if (taskKind === "doc" || taskKind === "research" || taskKind === "inspect") return "";
  return "pnpm test";
}

function defaultMaxParallelGroup(agentCategory) {
  if (agentCategory === "deep" || agentCategory === "ultrabrain") return 2;
  if (agentCategory === "visual-engineering") return 1;
  return 4;
}

function compactResourcePrefix(cwd) {
  return path.basename(cwd) || "workspace";
}

function normalizePriority(value) {
  const parsed = Number.parseInt(value ?? 0, 10);
  return Number.isFinite(parsed) ? Math.max(-100, Math.min(100, parsed)) : 0;
}

function requiredText(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${name} is required`);
  return text;
}
