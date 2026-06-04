import fs from "node:fs/promises";
import path from "node:path";
import {
  appendHistory,
  canRetry,
  createEmptyState,
  createTask,
  defaultAxiTodoHome,
  isActionableTask,
  isDue,
  normalizePatch,
  normalizeState,
  nowIso,
  taskSort,
} from "./schema.mjs";

const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 5000;

export class TaskStore {
  constructor({ home = defaultAxiTodoHome(), filePath } = {}) {
    this.home = path.resolve(home);
    this.filePath = path.resolve(filePath || path.join(this.home, "tasks.json"));
    this.lockPath = `${this.filePath}.lock`;
  }

  async readState() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      if (error?.code === "ENOENT") return createEmptyState();
      throw error;
    }
  }

  async listTasks({ status } = {}) {
    const state = await this.readState();
    return state.tasks
      .filter((task) => !status || task.status === status)
      .sort(taskSort);
  }

  async listReadyTasks({ limit = 50, now = nowIso() } = {}) {
    const state = await this.readState();
    return selectSchedulableTasks(state, { limit, now });
  }

  async scheduleTasks({ limit = 50, now = nowIso() } = {}) {
    const state = await this.readState();
    return {
      now,
      limit,
      tasks: selectSchedulableTasks(state, { limit, now }),
      blocked: explainBlockedTasks(state, { now }),
    };
  }

  async getTask(id) {
    const state = await this.readState();
    return state.tasks.find((task) => task.id === id) || null;
  }

  async addTask(input, options = {}) {
    return this.mutate((state) => {
      const task = createTask(input, options);
      state.tasks.push(task);
      return { state, result: task };
    });
  }

  async updateTask(id, patchInput, { note, event = "updated", now = nowIso() } = {}) {
    const patch = normalizePatch(patchInput);
    return this.mutate((state) => {
      const task = findTaskOrThrow(state, id);
      Object.assign(task, patch);
      task.updatedAt = now;
      if (patch.status === "completed" && !task.completedAt) task.completedAt = now;
      appendHistory(task, event, note || "Task updated", { patch }, now);
      return { state, result: task };
    });
  }

  async deleteTask(id, { now = nowIso() } = {}) {
    return this.mutate((state) => {
      const index = state.tasks.findIndex((candidate) => candidate.id === id);
      if (index === -1) throw new Error(`unknown task: ${id}`);
      const task = state.tasks[index];
      if (task.status === "running") {
        throw new Error(`cannot delete running task: ${id}`);
      }
      state.tasks.splice(index, 1);
      task.updatedAt = now;
      appendHistory(task, "deleted", "Task deleted", {}, now);
      return { state, result: task };
    });
  }

  async claimNextTask({ runnerId = process.pid, now = nowIso() } = {}) {
    return this.mutate((state) => {
      const task = selectSchedulableTasks(state, { limit: 1, now })[0];
      if (!task) return { state, result: null };
      task.status = "running";
      task.attempts = Number(task.attempts || 0) + 1;
      task.startedAt = now;
      task.updatedAt = now;
      task.error = undefined;
      appendHistory(task, "claimed", "Task claimed by runner", { runnerId }, now);
      return { state, result: task };
    });
  }

  async completeTask(id, result, { now = nowIso() } = {}) {
    return this.mutate((state) => {
      const task = findTaskOrThrow(state, id);
      task.status = "completed";
      task.summary = result.summary || task.summary;
      task.error = undefined;
      task.completedAt = now;
      task.updatedAt = now;
      task.lastRunId = result.runId || task.lastRunId;
      task.lastOutputPath = result.outputPath || task.lastOutputPath;
      if (result.verification) task.verification = result.verification;
      appendHistory(task, "completed", "Task completed", compactRunResult(result), now);
      return { state, result: task };
    });
  }

  async failTask(id, result, { now = nowIso(), retryDelayMs = 0 } = {}) {
    return this.mutate((state) => {
      const task = findTaskOrThrow(state, id);
      const retry = canRetry(task);
      task.status = retry ? "pending" : "failed";
      task.error = result.error || "Task failed";
      task.summary = result.summary || task.summary;
      task.updatedAt = now;
      task.lastRunId = result.runId || task.lastRunId;
      task.lastOutputPath = result.outputPath || task.lastOutputPath;
      if (retry && retryDelayMs > 0) {
        task.dueAt = new Date(Date.parse(now) + retryDelayMs).toISOString();
      }
      if (result.verification) task.verification = result.verification;
      appendHistory(
        task,
        retry ? "retry_scheduled" : "failed",
        retry ? "Task failed; retry scheduled" : "Task failed",
        compactRunResult(result),
        now,
      );
      return { state, result: task };
    });
  }

  async reconcileStaleRunning({ now = nowIso(), timeoutMs = 60 * 60 * 1000 } = {}) {
    return this.mutate((state) => {
      const nowMs = Date.parse(now);
      const changed = [];
      for (const task of state.tasks) {
        if (task.status !== "running" || !task.startedAt) continue;
        const ageMs = nowMs - Date.parse(task.startedAt);
        if (ageMs <= timeoutMs) continue;
        task.status = "pending";
        task.updatedAt = now;
        task.error = "Runner timed out before finishing the task.";
        appendHistory(task, "requeued_stale_running", "Stale running task returned to pending", { ageMs }, now);
        changed.push(task.id);
      }
      return { state, result: changed };
    });
  }

  async markVerificationResult(id, verification, { now = nowIso(), failureStatus = "pending" } = {}) {
    return this.mutate((state) => {
      const task = findTaskOrThrow(state, id);
      task.verification = verification;
      task.updatedAt = now;
      if (verification.status === "failed") {
        task.status = canRetry(task) ? failureStatus : "failed";
        task.error = "Verification failed after completion.";
      } else if (verification.status === "passed") {
        task.status = "completed";
        task.error = undefined;
      }
      appendHistory(task, "verification_checked", "Task verification checked", verification, now);
      return { state, result: task };
    });
  }

  async mutate(mutator) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    return withFileLock(this.lockPath, async () => {
      const state = await this.readState();
      const { state: nextState, result } = await mutator(state);
      await writeJsonAtomic(this.filePath, normalizeState(nextState));
      return result;
    });
  }
}

export function createStoreFromEnv(env = process.env) {
  return new TaskStore({ home: defaultAxiTodoHome(env) });
}

async function withFileLock(lockPath, fn) {
  const started = Date.now();
  let handle;
  while (!handle) {
    try {
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, at: nowIso() }));
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() - started > LOCK_TIMEOUT_MS) {
        throw new Error(`timed out waiting for store lock: ${lockPath}`);
      }
      await delay(LOCK_RETRY_MS);
    }
  }
  try {
    return await fn();
  } finally {
    await handle.close().catch(() => {});
    await fs.unlink(lockPath).catch(() => {});
  }
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

function findTaskOrThrow(state, id) {
  const task = state.tasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`unknown task: ${id}`);
  return task;
}

function compactRunResult(result = {}) {
  return {
    success: Boolean(result.success),
    runId: result.runId,
    outputPath: result.outputPath,
    exitCode: result.exitCode,
    error: result.error,
    verification: result.verification,
  };
}

function selectSchedulableTasks(state, { limit, now }) {
  const runningKeys = new Set(state.tasks
    .filter((task) => task.status === "running")
    .flatMap(effectiveResourceKeys));
  const selectedKeys = new Set();
  const completedIds = completedTaskIds(state);
  const selected = [];
  for (const task of state.tasks
    .filter((candidate) => isReadyCandidate(candidate, now, completedIds))
    .sort(taskSort)) {
    const keys = effectiveResourceKeys(task);
    if (keys.some((key) => runningKeys.has(key) || selectedKeys.has(key))) continue;
    selected.push(task);
    for (const key of keys) selectedKeys.add(key);
    if (selected.length >= limit) break;
  }
  return selected;
}

function explainBlockedTasks(state, { now }) {
  const completedIds = completedTaskIds(state);
  const runningKeys = new Set(state.tasks
    .filter((task) => task.status === "running")
    .flatMap(effectiveResourceKeys));
  return state.tasks
    .filter((task) => task.status === "pending")
    .map((task) => {
      const reasons = [];
      if (!isDue(task, now)) reasons.push("not_due");
      if (!isActionableTask(task)) reasons.push("missing_prompt");
      const missing = task.dependsOn.filter((id) => !completedIds.has(id));
      if (missing.length) reasons.push(`waiting_on:${missing.join(",")}`);
      const conflicts = effectiveResourceKeys(task).filter((key) => runningKeys.has(key));
      if (conflicts.length) reasons.push(`resource_locked:${conflicts.join(",")}`);
      return reasons.length ? { id: task.id, title: task.title, reasons } : null;
    })
    .filter(Boolean);
}

function isReadyCandidate(task, now, completedIds) {
  return task.status === "pending"
    && isDue(task, now)
    && isActionableTask(task)
    && task.dependsOn.every((id) => completedIds.has(id));
}

function completedTaskIds(state) {
  return new Set(state.tasks
    .filter((task) => task.status === "completed")
    .map((task) => task.id));
}

function effectiveResourceKeys(task) {
  return task.resourceKeys.length ? task.resourceKeys : [task.cwd];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
