import dayjs from "dayjs";
import fs from "node:fs";
import { draftPrompt, workspaceRoot } from "../../app/constants";
import type { AxiTodoTask } from "../../native";

/**
 * Returns the canonical project root path for a given cwd, or workspaceRoot as fallback.
 *
 * Edge cases handled:
 * - undefined/null/empty cwd  →  workspaceRoot
 * - cwd outside workspaceRoot  →  workspaceRoot
 * - symlinked cwd  →  resolved real path before comparison
 */
export function projectKey(cwd: string): string {
  if (!cwd) return workspaceRoot;

  // Resolve symlinks and relative segments so we compare real paths
  const resolved = fs.realpathSync.native(cwd);
  const normalized = resolved.replace(/\/+$/, "");
  const prefix = `${workspaceRoot}/projects/`;

  if (normalized === workspaceRoot) return workspaceRoot;
  if (normalized.startsWith(prefix)) {
    const [project] = normalized.slice(prefix.length).split("/");
    return project ? `${prefix}${project}` : workspaceRoot;
  }
  return workspaceRoot;
}

/**
 * Returns a human-readable project label from a cwd.
 * Falls back to "workspace" when cwd is at workspace root.
 */
export function projectLabel(cwd: string): string {
  const key = projectKey(cwd);
  if (key === workspaceRoot) return "workspace";
  return key.split("/").filter(Boolean).at(-1) ?? key;
}

/**
 * Checks whether a project path exists on the filesystem.
 * Used to guard against stale or deleted project directories.
 */
export function projectExists(cwd: string): boolean {
  if (!cwd) return false;
  try {
    const key = projectKey(cwd);
    return fs.existsSync(key) && fs.statSync(key).isDirectory();
  } catch {
    return false;
  }
}

export function formatTime(value: string) {
  const date = dayjs(value);
  return date.isValid() ? date.format("YYYY-MM-DD HH:mm") : value;
}

export function createTaskDraft(): AxiTodoTask {
  const now = new Date().toISOString();
  return {
    attempts: 0,
    createdAt: now,
    cwd: workspaceRoot,
    dueDate: new Date().toISOString().slice(0, 10),
    dueAt: now,
    history: [],
    id: `draft-${crypto.randomUUID()}`,
    executionStatus: "queued",
    lifecycleStatus: "open",
    maxAttempts: 3,
    priority: 0,
    prompt: "",
    reminderState: "none",
    status: "pending",
    taskDomain: "agent",
    title: "新 Todo",
    updatedAt: now,
    verification: {},
  };
}

export function applyTaskPatch(task: AxiTodoTask, patch: Partial<AxiTodoTask>) {
  const next = { ...task, ...patch };
  if (
    typeof patch.prompt === "string"
    && isDraftPrompt(task.prompt)
    && !isDraftPrompt(next.prompt)
    && (!task.dueAt || Date.parse(task.dueAt) > Date.now() + 60_000)
  ) {
    next.dueAt = new Date().toISOString();
  }
  return next;
}

export function isDraftPrompt(value: string) {
  return value.trim() === draftPrompt;
}
