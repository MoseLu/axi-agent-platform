import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

export const STORE_VERSION = 3;

export const TASK_STATUSES = new Set([
  "pending",
  "running",
  "waiting",
  "awaiting_audit",
  "completed",
  "failed",
  "blocked",
  "cancelled",
]);

export const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
export const TASK_DOMAINS = new Set(["agent", "personal"]);
export const PERSONAL_LIFECYCLE_STATUSES = new Set(["open", "completed", "cancelled", "archived"]);
export const EXECUTION_STATUSES = new Set(["idle", "queued", "running", "succeeded", "failed", "blocked"]);
export const REMINDER_STATES = new Set(["none", "scheduled", "snoozed", "fired", "cancelled"]);
export const TASK_KINDS = new Set(["task", "inspect", "edit", "test", "verify", "doc", "research"]);
export const RISK_LEVELS = new Set(["low", "medium", "high"]);
export const AUDIT_LEVELS = new Set(["none", "standard", "strict"]);
export const MEMORY_CARD_TYPES = new Set([
  "planning_pattern",
  "execution_lesson",
  "failure_lesson",
  "user_preference",
  "audit_lesson",
  "completion_fact",
]);
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
    taskCharters: [],
    planningRecords: [],
    taskRuns: [],
    taskEvents: [],
    failureAnalyses: [],
    auditReviews: [],
    userPreferences: [],
    completionSummaries: [],
    memoryCards: [],
  };
}

export function normalizeState(raw) {
  if (!raw || typeof raw !== "object") return createEmptyState();
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(normalizeExistingTask).filter(Boolean) : [];
  return {
    version: STORE_VERSION,
    tasks,
    taskCharters: normalizeRecordList(raw.taskCharters ?? raw.task_charters),
    planningRecords: normalizeRecordList(raw.planningRecords ?? raw.planning_records),
    taskRuns: normalizeRecordList(raw.taskRuns ?? raw.task_runs),
    taskEvents: normalizeRecordList(raw.taskEvents ?? raw.task_events),
    failureAnalyses: normalizeRecordList(raw.failureAnalyses ?? raw.failure_analyses),
    auditReviews: normalizeRecordList(raw.auditReviews ?? raw.audit_reviews),
    userPreferences: normalizeRecordList(raw.userPreferences ?? raw.user_preferences),
    completionSummaries: normalizeRecordList(raw.completionSummaries ?? raw.completion_summaries),
    memoryCards: normalizeRecordList(raw.memoryCards ?? raw.memory_cards),
  };
}

export function createTask(input = {}, { now = nowIso(), cwd = process.cwd() } = {}) {
  const title = requiredText(input.title, "title");
  const taskDomain = normalizeEnum(input.taskDomain ?? input.task_domain, TASK_DOMAINS, "agent");
  const prompt = taskDomain === "personal"
    ? optionalText(input.prompt) || title
    : requiredText(input.prompt, "prompt");
  const status = normalizeStatus(input.status || "pending");
  const lifecycleStatus = normalizeLifecycleStatus(input.lifecycleStatus ?? input.lifecycle_status, status);
  const executionStatus = normalizeExecutionStatus(input.executionStatus ?? input.execution_status, status, taskDomain);
  const dueAt = normalizeOptionalIso(input.dueAt ?? input.due_at) || (taskDomain === "personal" ? undefined : now);
  const dueDate = normalizeOptionalDateOnly(input.dueDate ?? input.due_date) || (taskDomain === "personal" && dueAt ? dueAt.slice(0, 10) : undefined);
  const remindAt = normalizeOptionalIso(input.remindAt ?? input.remind_at);
  const task = {
    id: String(input.id || crypto.randomUUID()),
    title,
    prompt,
    body: optionalText(input.body),
    taskDomain,
    lifecycleStatus,
    executionStatus,
    cwd: path.resolve(String(input.cwd || cwd)),
    status,
    priority: normalizePriority(input.priority),
    attempts: normalizeNonNegativeInt(input.attempts, 0),
    maxAttempts: normalizePositiveInt(input.maxAttempts ?? input.max_attempts, 3),
    dueAt,
    dueDate,
    remindAt,
    reminderState: normalizeEnum(input.reminderState ?? input.reminder_state, REMINDER_STATES, remindAt ? "scheduled" : "none"),
    verifyCommand: optionalText(input.verifyCommand ?? input.verify_command),
    charterId: optionalText(input.charterId ?? input.charter_id),
    expectedResult: optionalText(input.expectedResult ?? input.expected_result),
    acceptanceChecks: normalizeStringList(input.acceptanceChecks ?? input.acceptance_checks),
    auditLevel: normalizeEnum(input.auditLevel ?? input.audit_level, AUDIT_LEVELS, "none"),
    waitState: normalizePlainObject(input.waitState ?? input.wait_state),
    checkpoint: optionalText(input.checkpoint),
    heartbeatAt: normalizeOptionalIso(input.heartbeatAt ?? input.heartbeat_at),
    runManifestPath: optionalResolvedPath(input.runManifestPath ?? input.run_manifest_path),
    taskGranularity: optionalText(input.taskGranularity ?? input.task_granularity),
    modelSelectionReason: optionalText(input.modelSelectionReason ?? input.model_selection_reason),
    rejectedApproaches: normalizeStringList(input.rejectedApproaches ?? input.rejected_approaches),
    parentId: optionalText(input.parentId ?? input.parent_id),
    dependsOn: normalizeStringList(input.dependsOn ?? input.depends_on),
    resourceKeys: normalizeStringList(input.resourceKeys ?? input.resource_keys),
    taskKind: normalizeEnum(input.taskKind ?? input.task_kind, TASK_KINDS, "task"),
    estimatedCostPercent: normalizeBoundedNumber(input.estimatedCostPercent ?? input.estimated_cost_percent, 0, 100),
    riskLevel: normalizeEnum(input.riskLevel ?? input.risk_level, RISK_LEVELS, "medium"),
    plannerConfidence: normalizeBoundedNumber(input.plannerConfidence ?? input.planner_confidence, 0, 1),
    // evidenceContract (hard contract — see lib/codex-runner.mjs buildCodexPrompt
    // and lib/store.mjs completeTask): when non-empty, the runner MUST append
    // a `## Evidence` section to its final message in this exact shape, or
    // completeTask will refuse to flip the task to `completed` and will
    // instead move it to `awaiting_audit`:
    //   ## Evidence
    //   - claim: <one-sentence conclusion>
    //   - files:
    //     - <path relative to the working directory>
    //   - checks:
    //     - <check name>: <result>
    //   - warnings:
    //     - <anything the next agent should know>
    // `claim` OR a non-empty `files:` list is required; `checks` and
    // `warnings` are optional. The string stored here is also forwarded
    // verbatim into the prompt the runner sends to Codex.
    evidenceContract: optionalText(input.evidenceContract ?? input.evidence_contract),
    // See the long block on `evidenceContract` above; `evidenceMissing` is
    // the per-run marker that completeTask sets when the gate fires, so
    // downstream agents can see at a glance that this task is being held
    // because its `## Evidence` block did not parse.
    evidenceMissing: normalizeOptionalBoolean(input.evidenceMissing ?? input.evidence_missing),
    // Echoes the last evidenceContract the runner actually enforced; useful
    // for audit trail and for "what was the contract this task was held on".
    evidenceContractSeen: optionalText(input.evidenceContractSeen ?? input.evidence_contract_seen),
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
    verifyLoggedAt: normalizeOptionalIso(input.verifyLoggedAt ?? input.verify_logged_at),
    history: [],
  };
  appendHistory(task, "created", "Task created", {}, now, taskDomain === "personal" ? "user" : "system");
  return task;
}

export function normalizePatch(input = {}) {
  const patch = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    switch (key) {
      case "title":
      case "prompt":
      case "body":
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
      case "taskDomain":
      case "task_domain":
        patch.taskDomain = normalizeEnum(value, TASK_DOMAINS, "agent");
        break;
      case "lifecycleStatus":
      case "lifecycle_status":
        patch.lifecycleStatus = normalizeEnum(value, PERSONAL_LIFECYCLE_STATUSES, "open");
        break;
      case "executionStatus":
      case "execution_status":
        patch.executionStatus = normalizeEnum(value, EXECUTION_STATUSES, "idle");
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
      case "dueDate":
      case "due_date":
        patch.dueDate = normalizeOptionalDateOnly(value);
        break;
      case "remindAt":
      case "remind_at":
        patch.remindAt = normalizeOptionalIso(value);
        break;
      case "reminderState":
      case "reminder_state":
        patch.reminderState = normalizeEnum(value, REMINDER_STATES, "none");
        break;
      case "verifyCommand":
      case "verify_command":
        patch.verifyCommand = optionalText(value);
        break;
      case "verifyLoggedAt":
      case "verify_logged_at":
        patch.verifyLoggedAt = normalizeOptionalIso(value);
        break;
      case "completedAt":
      case "completed_at":
        patch.completedAt = normalizeOptionalIso(value);
        break;
      case "charterId":
      case "charter_id":
        patch.charterId = optionalText(value);
        break;
      case "expectedResult":
      case "expected_result":
        patch.expectedResult = optionalText(value);
        break;
      case "acceptanceChecks":
      case "acceptance_checks":
        patch.acceptanceChecks = normalizeStringList(value);
        break;
      case "auditLevel":
      case "audit_level":
        patch.auditLevel = normalizeEnum(value, AUDIT_LEVELS, "none");
        break;
      case "waitState":
      case "wait_state":
        patch.waitState = normalizePlainObject(value);
        break;
      case "checkpoint":
        patch.checkpoint = optionalText(value);
        break;
      case "heartbeatAt":
      case "heartbeat_at":
        patch.heartbeatAt = normalizeOptionalIso(value);
        break;
      case "runManifestPath":
      case "run_manifest_path":
        patch.runManifestPath = optionalResolvedPath(value);
        break;
      case "taskGranularity":
      case "task_granularity":
        patch.taskGranularity = optionalText(value);
        break;
      case "modelSelectionReason":
      case "model_selection_reason":
        patch.modelSelectionReason = optionalText(value);
        break;
      case "rejectedApproaches":
      case "rejected_approaches":
        patch.rejectedApproaches = normalizeStringList(value);
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
      case "evidenceMissing":
      case "evidence_missing":
        patch.evidenceMissing = normalizeOptionalBoolean(value);
        break;
      case "evidenceContractSeen":
      case "evidence_contract_seen":
        patch.evidenceContractSeen = optionalText(value);
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
    const taskDomain = normalizeEnum(input.taskDomain ?? input.task_domain, TASK_DOMAINS, "agent");
    const dueAt = normalizeOptionalIso(input.dueAt ?? input.due_at) || (taskDomain === "personal" ? undefined : now);
    return {
      id: requiredText(input.id, "id"),
      title: requiredText(input.title, "title"),
      taskDomain,
      prompt: requiredText(input.prompt || (taskDomain === "personal" ? input.title : undefined), "prompt"),
      body: optionalText(input.body),
      cwd: path.resolve(String(input.cwd || process.cwd())),
      status: normalizeStatus(input.status || "pending"),
      lifecycleStatus: normalizeLifecycleStatus(input.lifecycleStatus ?? input.lifecycle_status, input.status || "pending"),
      executionStatus: normalizeExecutionStatus(input.executionStatus ?? input.execution_status, input.status || "pending", taskDomain),
      priority: normalizePriority(input.priority),
      attempts: normalizeNonNegativeInt(input.attempts, 0),
      maxAttempts: normalizePositiveInt(input.maxAttempts ?? input.max_attempts, 3),
      dueAt,
      dueDate: normalizeOptionalDateOnly(input.dueDate ?? input.due_date) || (taskDomain === "personal" && dueAt ? dueAt.slice(0, 10) : undefined),
      remindAt: normalizeOptionalIso(input.remindAt ?? input.remind_at),
      reminderState: normalizeEnum(input.reminderState ?? input.reminder_state, REMINDER_STATES, (input.remindAt ?? input.remind_at) ? "scheduled" : "none"),
      verifyCommand: optionalText(input.verifyCommand ?? input.verify_command),
      charterId: optionalText(input.charterId ?? input.charter_id),
      expectedResult: optionalText(input.expectedResult ?? input.expected_result),
      acceptanceChecks: normalizeStringList(input.acceptanceChecks ?? input.acceptance_checks),
      auditLevel: normalizeEnum(input.auditLevel ?? input.audit_level, AUDIT_LEVELS, "none"),
      waitState: normalizePlainObject(input.waitState ?? input.wait_state),
      checkpoint: optionalText(input.checkpoint),
      heartbeatAt: normalizeOptionalIso(input.heartbeatAt ?? input.heartbeat_at),
      runManifestPath: optionalResolvedPath(input.runManifestPath ?? input.run_manifest_path),
      taskGranularity: optionalText(input.taskGranularity ?? input.task_granularity),
      modelSelectionReason: optionalText(input.modelSelectionReason ?? input.model_selection_reason),
      rejectedApproaches: normalizeStringList(input.rejectedApproaches ?? input.rejected_approaches),
      parentId: optionalText(input.parentId ?? input.parent_id),
      dependsOn: normalizeStringList(input.dependsOn ?? input.depends_on),
      resourceKeys: normalizeStringList(input.resourceKeys ?? input.resource_keys),
      taskKind: normalizeEnum(input.taskKind ?? input.task_kind, TASK_KINDS, "task"),
      estimatedCostPercent: normalizeBoundedNumber(input.estimatedCostPercent ?? input.estimated_cost_percent, 0, 100),
      riskLevel: normalizeEnum(input.riskLevel ?? input.risk_level, RISK_LEVELS, "medium"),
      plannerConfidence: normalizeBoundedNumber(input.plannerConfidence ?? input.planner_confidence, 0, 1),
      evidenceContract: optionalText(input.evidenceContract ?? input.evidence_contract),
      // See the long block on `evidenceContract` above; these fields are
      // retained so older runner records remain auditable after normalization.
      evidenceMissing: normalizeOptionalBoolean(input.evidenceMissing ?? input.evidence_missing),
      evidenceContractSeen: optionalText(input.evidenceContractSeen ?? input.evidence_contract_seen),
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
      history: normalizeHistory(input.history),
    };
  } catch {
    return null;
  }
}

export function appendHistory(task, event, message, data = {}, at = nowIso(), actor = "system") {
  const entry = {
    id: crypto.randomUUID(),
    at,
    event: String(event || "event"),
    actor: optionalText(actor) || "system",
    message: String(message || ""),
    data: data && typeof data === "object" ? data : {},
  };
  task.history = Array.isArray(task.history) ? task.history : [];
  task.history.push(entry);
  if (task.history.length > 100) task.history = task.history.slice(-100);
}

export function synchronizeTaskState(task, { patch = {}, now = nowIso() } = {}) {
  if (patch.status === "completed") {
    task.completedAt = task.completedAt || now;
  } else if (patch.status && patch.status !== "completed") {
    task.completedAt = undefined;
  }

  if (task.taskDomain === "personal") {
    if (patch.status === "completed" || patch.lifecycleStatus === "completed") {
      task.status = "completed";
      task.lifecycleStatus = "completed";
      task.executionStatus = "idle";
      task.completedAt = task.completedAt || now;
      task.reminderState = "cancelled";
    } else if (patch.status === "cancelled" || patch.lifecycleStatus === "cancelled") {
      task.status = "cancelled";
      task.lifecycleStatus = "cancelled";
      task.executionStatus = "idle";
    } else if (patch.status === "pending" || patch.lifecycleStatus === "open") {
      task.status = "pending";
      task.lifecycleStatus = "open";
      task.executionStatus = "idle";
      task.completedAt = undefined;
      if (task.remindAt) task.reminderState = "scheduled";
    }
    if (patch.remindAt !== undefined && patch.reminderState === undefined && task.lifecycleStatus === "open") {
      task.reminderState = task.remindAt ? "scheduled" : "none";
    }
    return task;
  }

  if (patch.status) task.executionStatus = normalizeExecutionStatus(undefined, task.status, "agent");
  if (patch.lifecycleStatus === "completed") task.completedAt = task.completedAt || now;
  return task;
}

export function taskSort(left, right) {
  if (left.priority !== right.priority) return right.priority - left.priority;
  return String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
}

export function isDue(task, at = nowIso()) {
  return !task.dueAt || Date.parse(task.dueAt) <= Date.parse(at);
}

export function isActionableTask(task) {
  if (task?.taskDomain === "personal") return false;
  const prompt = optionalText(task?.prompt);
  return Boolean(prompt && prompt !== "待填写");
}

export function canRetry(task) {
  return Number(task.attempts || 0) < Number(task.maxAttempts || 1);
}

export function normalizeMemoryCardType(value) {
  return normalizeEnum(value, MEMORY_CARD_TYPES, "execution_lesson");
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

function normalizeLifecycleStatus(value, status) {
  const fallback = status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "open";
  return normalizeEnum(value, PERSONAL_LIFECYCLE_STATUSES, fallback);
}

function normalizeExecutionStatus(value, status, taskDomain) {
  if (taskDomain === "personal" && value === undefined) return "idle";
  const fallback = {
    pending: "queued",
    running: "running",
    waiting: "queued",
    awaiting_audit: "blocked",
    completed: "succeeded",
    failed: "failed",
    blocked: "blocked",
    cancelled: "idle",
  }[status] || "idle";
  return normalizeEnum(value, EXECUTION_STATUSES, fallback);
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

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return { ...value };
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

function normalizeOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (text === "true" || text === "1" || text === "yes") return true;
  if (text === "false" || text === "0" || text === "no") return false;
  return undefined;
}

function normalizeOptionalIso(value) {
  const text = optionalText(value);
  if (!text) return undefined;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) throw new Error(`invalid ISO date: ${text}`);
  return new Date(ms).toISOString();
}

function normalizeOptionalDateOnly(value) {
  const text = optionalText(value);
  if (!text) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`invalid date: ${text}`);
  const parsed = Date.parse(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) throw new Error(`invalid date: ${text}`);
  return text;
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

function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => {
      const at = normalizeOptionalIso(entry.at) || nowIso();
      const event = String(entry.event || "event");
      const message = String(entry.message || "");
      return {
        id: optionalText(entry.id) || `legacy-${at}-${event}-${index}`,
        at,
        event,
        actor: optionalText(entry.actor) || "system",
        message,
        data: entry.data && typeof entry.data === "object" && !Array.isArray(entry.data) ? entry.data : {},
      };
    })
    .slice(-100);
}

function normalizeRecordList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({ ...item }))
    .slice(-5000);
}
