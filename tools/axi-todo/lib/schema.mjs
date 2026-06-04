import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

export const STORE_VERSION = 1;

export const TASK_STATUSES = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "blocked",
  "cancelled",
]);

export const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
export const TASK_KINDS = new Set(["task", "inspect", "edit", "test", "verify", "doc", "research"]);
export const RISK_LEVELS = new Set(["low", "medium", "high"]);
export const AGENT_ROLES = new Set([
  "sisyphus",
  "prometheus",
  "atlas",
  "sisyphus-junior",
  "hephaestus",
  "oracle",
  "librarian",
  "explore",
  "metis",
  "momus",
  "multimodal-looker",
]);
export const AGENT_CATEGORIES = new Set([
  "visual-engineering",
  "ultrabrain",
  "deep",
  "artistry",
  "quick",
  "unspecified-low",
  "unspecified-high",
  "writing",
]);
export const EXECUTION_MODES = new Set(["plan", "inspect", "worker", "verify", "consult", "write"]);

export function defaultAxiTodoHome(env = process.env) {
  return path.resolve(env.AXI_TODO_HOME || path.join(os.homedir(), ".axi-todo"));
}

export function nowIso() {
  return new Date().toISOString();
}

export function createEmptyState() {
  return {
    version: STORE_VERSION,
    tasks: [],
  };
}

export function normalizeState(raw) {
  if (!raw || typeof raw !== "object") return createEmptyState();
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(normalizeExistingTask).filter(Boolean) : [];
  return {
    version: STORE_VERSION,
    tasks,
  };
}

export function createTask(input = {}, { now = nowIso(), cwd = process.cwd() } = {}) {
  const title = requiredText(input.title, "title");
  const prompt = requiredText(input.prompt, "prompt");
  const status = normalizeStatus(input.status || "pending");
  const task = {
    id: String(input.id || crypto.randomUUID()),
    title,
    prompt,
    cwd: path.resolve(String(input.cwd || cwd)),
    status,
    priority: normalizePriority(input.priority),
    attempts: normalizeNonNegativeInt(input.attempts, 0),
    maxAttempts: normalizePositiveInt(input.maxAttempts ?? input.max_attempts, 3),
    dueAt: normalizeOptionalIso(input.dueAt ?? input.due_at) || now,
    verifyCommand: optionalText(input.verifyCommand ?? input.verify_command),
    parentId: optionalText(input.parentId ?? input.parent_id),
    dependsOn: normalizeStringList(input.dependsOn ?? input.depends_on),
    resourceKeys: normalizeStringList(input.resourceKeys ?? input.resource_keys),
    taskKind: normalizeEnum(input.taskKind ?? input.task_kind, TASK_KINDS, "task"),
    estimatedCostPercent: normalizeBoundedNumber(input.estimatedCostPercent ?? input.estimated_cost_percent, 0, 100),
    riskLevel: normalizeEnum(input.riskLevel ?? input.risk_level, RISK_LEVELS, "medium"),
    plannerConfidence: normalizeBoundedNumber(input.plannerConfidence ?? input.planner_confidence, 0, 1),
    evidenceContract: optionalText(input.evidenceContract ?? input.evidence_contract),
    agentRole: normalizeOptionalEnum(input.agentRole ?? input.agent_role, AGENT_ROLES),
    agentCategory: normalizeOptionalEnum(input.agentCategory ?? input.agent_category, AGENT_CATEGORIES),
    executionMode: normalizeOptionalEnum(input.executionMode ?? input.execution_mode, EXECUTION_MODES),
    modelHint: optionalText(input.modelHint ?? input.model_hint),
    fallbackModels: normalizeStringList(input.fallbackModels ?? input.fallback_models),
    parallelGroup: optionalText(input.parallelGroup ?? input.parallel_group),
    maxParallelGroup: normalizeOptionalPositiveInt(input.maxParallelGroup ?? input.max_parallel_group),
    notepadPath: optionalResolvedPath(input.notepadPath ?? input.notepad_path),
    mailboxThreadId: optionalText(input.mailboxThreadId ?? input.mailbox_thread_id),
    worktreePath: optionalResolvedPath(input.worktreePath ?? input.worktree_path),
    summary: optionalText(input.summary),
    error: optionalText(input.error),
    createdAt: normalizeOptionalIso(input.createdAt ?? input.created_at) || now,
    updatedAt: now,
    startedAt: normalizeOptionalIso(input.startedAt ?? input.started_at),
    completedAt: normalizeOptionalIso(input.completedAt ?? input.completed_at),
    lastRunId: optionalText(input.lastRunId ?? input.last_run_id),
    lastOutputPath: optionalText(input.lastOutputPath ?? input.last_output_path),
    verification: normalizeVerification(input.verification),
    history: [],
  };
  appendHistory(task, "created", "Task created", {}, now);
  return task;
}

export function normalizePatch(input = {}) {
  const patch = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    switch (key) {
      case "title":
      case "prompt":
      case "summary":
      case "error":
        patch[key] = optionalText(value);
        break;
      case "cwd":
        patch.cwd = path.resolve(String(value));
        break;
      case "status":
        patch.status = normalizeStatus(value);
        break;
      case "priority":
        patch.priority = normalizePriority(value);
        break;
      case "maxAttempts":
      case "max_attempts":
        patch.maxAttempts = normalizePositiveInt(value, 3);
        break;
      case "dueAt":
      case "due_at":
        patch.dueAt = normalizeOptionalIso(value);
        break;
      case "verifyCommand":
      case "verify_command":
        patch.verifyCommand = optionalText(value);
        break;
      case "parentId":
      case "parent_id":
        patch.parentId = optionalText(value);
        break;
      case "dependsOn":
      case "depends_on":
        patch.dependsOn = normalizeStringList(value);
        break;
      case "resourceKeys":
      case "resource_keys":
        patch.resourceKeys = normalizeStringList(value);
        break;
      case "taskKind":
      case "task_kind":
        patch.taskKind = normalizeEnum(value, TASK_KINDS, "task");
        break;
      case "estimatedCostPercent":
      case "estimated_cost_percent":
        patch.estimatedCostPercent = normalizeBoundedNumber(value, 0, 100);
        break;
      case "riskLevel":
      case "risk_level":
        patch.riskLevel = normalizeEnum(value, RISK_LEVELS, "medium");
        break;
      case "plannerConfidence":
      case "planner_confidence":
        patch.plannerConfidence = normalizeBoundedNumber(value, 0, 1);
        break;
      case "evidenceContract":
      case "evidence_contract":
        patch.evidenceContract = optionalText(value);
        break;
      case "agentRole":
      case "agent_role":
        patch.agentRole = normalizeOptionalEnum(value, AGENT_ROLES);
        break;
      case "agentCategory":
      case "agent_category":
        patch.agentCategory = normalizeOptionalEnum(value, AGENT_CATEGORIES);
        break;
      case "executionMode":
      case "execution_mode":
        patch.executionMode = normalizeOptionalEnum(value, EXECUTION_MODES);
        break;
      case "modelHint":
      case "model_hint":
        patch.modelHint = optionalText(value);
        break;
      case "fallbackModels":
      case "fallback_models":
        patch.fallbackModels = normalizeStringList(value);
        break;
      case "parallelGroup":
      case "parallel_group":
        patch.parallelGroup = optionalText(value);
        break;
      case "maxParallelGroup":
      case "max_parallel_group":
        patch.maxParallelGroup = normalizeOptionalPositiveInt(value);
        break;
      case "notepadPath":
      case "notepad_path":
        patch.notepadPath = optionalResolvedPath(value);
        break;
      case "mailboxThreadId":
      case "mailbox_thread_id":
        patch.mailboxThreadId = optionalText(value);
        break;
      case "worktreePath":
      case "worktree_path":
        patch.worktreePath = optionalResolvedPath(value);
        break;
      default:
        break;
    }
  }
  return patch;
}

export function normalizeExistingTask(input) {
  if (!input || typeof input !== "object") return null;
  try {
    const now = nowIso();
    return {
      id: requiredText(input.id, "id"),
      title: requiredText(input.title, "title"),
      prompt: requiredText(input.prompt, "prompt"),
      cwd: path.resolve(String(input.cwd || process.cwd())),
      status: normalizeStatus(input.status || "pending"),
      priority: normalizePriority(input.priority),
      attempts: normalizeNonNegativeInt(input.attempts, 0),
      maxAttempts: normalizePositiveInt(input.maxAttempts ?? input.max_attempts, 3),
      dueAt: normalizeOptionalIso(input.dueAt ?? input.due_at) || now,
      verifyCommand: optionalText(input.verifyCommand ?? input.verify_command),
      parentId: optionalText(input.parentId ?? input.parent_id),
      dependsOn: normalizeStringList(input.dependsOn ?? input.depends_on),
      resourceKeys: normalizeStringList(input.resourceKeys ?? input.resource_keys),
      taskKind: normalizeEnum(input.taskKind ?? input.task_kind, TASK_KINDS, "task"),
      estimatedCostPercent: normalizeBoundedNumber(input.estimatedCostPercent ?? input.estimated_cost_percent, 0, 100),
      riskLevel: normalizeEnum(input.riskLevel ?? input.risk_level, RISK_LEVELS, "medium"),
      plannerConfidence: normalizeBoundedNumber(input.plannerConfidence ?? input.planner_confidence, 0, 1),
      evidenceContract: optionalText(input.evidenceContract ?? input.evidence_contract),
      agentRole: normalizeOptionalEnum(input.agentRole ?? input.agent_role, AGENT_ROLES),
      agentCategory: normalizeOptionalEnum(input.agentCategory ?? input.agent_category, AGENT_CATEGORIES),
      executionMode: normalizeOptionalEnum(input.executionMode ?? input.execution_mode, EXECUTION_MODES),
      modelHint: optionalText(input.modelHint ?? input.model_hint),
      fallbackModels: normalizeStringList(input.fallbackModels ?? input.fallback_models),
      parallelGroup: optionalText(input.parallelGroup ?? input.parallel_group),
      maxParallelGroup: normalizeOptionalPositiveInt(input.maxParallelGroup ?? input.max_parallel_group),
      notepadPath: optionalResolvedPath(input.notepadPath ?? input.notepad_path),
      mailboxThreadId: optionalText(input.mailboxThreadId ?? input.mailbox_thread_id),
      worktreePath: optionalResolvedPath(input.worktreePath ?? input.worktree_path),
      summary: optionalText(input.summary),
      error: optionalText(input.error),
      createdAt: normalizeOptionalIso(input.createdAt ?? input.created_at) || now,
      updatedAt: normalizeOptionalIso(input.updatedAt ?? input.updated_at) || now,
      startedAt: normalizeOptionalIso(input.startedAt ?? input.started_at),
      completedAt: normalizeOptionalIso(input.completedAt ?? input.completed_at),
      lastRunId: optionalText(input.lastRunId ?? input.last_run_id),
      lastOutputPath: optionalText(input.lastOutputPath ?? input.last_output_path),
      verification: normalizeVerification(input.verification),
      history: Array.isArray(input.history) ? input.history.slice(-100) : [],
    };
  } catch {
    return null;
  }
}

export function appendHistory(task, event, message, data = {}, at = nowIso()) {
  const entry = {
    at,
    event: String(event || "event"),
    message: String(message || ""),
    data: data && typeof data === "object" ? data : {},
  };
  task.history = Array.isArray(task.history) ? task.history : [];
  task.history.push(entry);
  if (task.history.length > 100) task.history = task.history.slice(-100);
}

export function taskSort(left, right) {
  if (left.priority !== right.priority) return right.priority - left.priority;
  return String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
}

export function isDue(task, at = nowIso()) {
  return !task.dueAt || Date.parse(task.dueAt) <= Date.parse(at);
}

export function isActionableTask(task) {
  const prompt = optionalText(task?.prompt);
  return Boolean(prompt && prompt !== "待填写");
}

export function canRetry(task) {
  return Number(task.attempts || 0) < Number(task.maxAttempts || 1);
}

function requiredText(value, name) {
  const text = optionalText(value);
  if (!text) throw new Error(`${name} is required`);
  return text;
}

function optionalText(value) {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function normalizeStatus(value) {
  const status = String(value || "").trim();
  if (!TASK_STATUSES.has(status)) {
    throw new Error(`invalid task status: ${status}`);
  }
  return status;
}

function normalizePriority(value) {
  const parsed = Number.parseInt(value ?? 0, 10);
  return Number.isFinite(parsed) ? Math.max(-100, Math.min(100, parsed)) : 0;
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeOptionalPositiveInt(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`invalid positive integer: ${value}`);
  return parsed;
}

function normalizeStringList(value) {
  if (value === null || value === undefined) return [];
  const raw = Array.isArray(value) ? value : String(value).split(",");
  return Array.from(new Set(raw.map((item) => optionalText(item)).filter(Boolean)));
}

function normalizeEnum(value, allowed, fallback) {
  const text = optionalText(value) || fallback;
  if (!allowed.has(text)) throw new Error(`invalid enum value: ${text}`);
  return text;
}

function normalizeOptionalEnum(value, allowed) {
  const text = optionalText(value);
  if (!text) return undefined;
  if (!allowed.has(text)) throw new Error(`invalid enum value: ${text}`);
  return text;
}

function optionalResolvedPath(value) {
  const text = optionalText(value);
  return text ? path.resolve(text) : undefined;
}

function normalizeBoundedNumber(value, min, max) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeOptionalIso(value) {
  const text = optionalText(value);
  if (!text) return undefined;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Error(`invalid ISO date: ${text}`);
  return new Date(ms).toISOString();
}

function normalizeVerification(value = {}) {
  if (!value || typeof value !== "object") return {};
  return {
    status: optionalText(value.status),
    checkedAt: normalizeOptionalIso(value.checkedAt ?? value.checked_at),
    exitCode: value.exitCode === undefined ? undefined : Number(value.exitCode),
    output: optionalText(value.output),
  };
}
