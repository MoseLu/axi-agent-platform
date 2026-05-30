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
