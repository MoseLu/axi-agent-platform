import dayjs from "dayjs";
import { draftPrompt, workspaceRoot } from "../../app/constants";
import type { AxiTodoTask } from "../../native";

export function projectKey(cwd: string) {
  const normalized = cwd.replace(/\/+$/, "");
  const prefix = `${workspaceRoot}/projects/`;
  if (normalized === workspaceRoot) return workspaceRoot;
  if (normalized.startsWith(prefix)) {
    const [project] = normalized.slice(prefix.length).split("/");
    return project ? `${prefix}${project}` : workspaceRoot;
  }
  return normalized || cwd;
}

export function projectLabel(cwd: string) {
  const key = projectKey(cwd);
  if (key === workspaceRoot) return "workspace";
  return key.split("/").filter(Boolean).at(-1) || key;
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
    dueAt: now,
    history: [],
    id: `draft-${crypto.randomUUID()}`,
    maxAttempts: 3,
    priority: 0,
    prompt: "",
    status: "pending",
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
    && Date.parse(task.dueAt) > Date.now() + 60_000
  ) {
    next.dueAt = new Date().toISOString();
  }
  return next;
}

export function isDraftPrompt(value: string) {
  return value.trim() === draftPrompt;
}
