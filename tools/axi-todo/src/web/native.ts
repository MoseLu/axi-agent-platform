export type AxiTaskStatus = "pending" | "running" | "completed" | "failed" | "blocked" | "cancelled";

export type AxiTodoTask = {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  status: AxiTaskStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  dueAt: string;
  verifyCommand?: string;
  summary?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  lastRunId?: string;
  lastOutputPath?: string;
  verification?: Record<string, unknown>;
  history?: unknown[];
};

export type TaskListResponse = {
  storePath: string;
  tasks: AxiTodoTask[];
};

export type AxiWorkspaceProject = {
  label: string;
  path: string;
};

export type WorkspaceProjectListResponse = {
  projects: AxiWorkspaceProject[];
};

type NativeResponse = {
  error?: string | null;
  id: string;
  result?: unknown;
};

type NativeRequest = {
  id: string;
  method: string;
  payload?: Record<string, unknown>;
};

declare global {
  interface Window {
    __axiTodoResolve?: (response: NativeResponse) => void;
    webkit?: {
      messageHandlers?: {
        axiTodoNative?: {
          postMessage: (request: NativeRequest) => void;
        };
      };
    };
  }
}

const pending = new Map<string, { reject: (error: Error) => void; resolve: (value: unknown) => void }>();

window.__axiTodoResolve = (response: NativeResponse) => {
  const entry = pending.get(response.id);
  if (!entry) return;
  pending.delete(response.id);
  if (response.error) {
    entry.reject(new Error(response.error));
  } else {
    entry.resolve(response.result);
  }
};

function callNative<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  const bridge = window.webkit?.messageHandlers?.axiTodoNative;
  if (!bridge) {
    return Promise.reject(new Error("Axi Todo desktop bridge is unavailable."));
  }

  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      reject,
      resolve: (value) => resolve(value as T),
    });
    bridge.postMessage({ id, method, payload });
  });
}

export const native = {
  createTask(payload: Partial<AxiTodoTask>) {
    return callNative<AxiTodoTask>("createTask", payload as Record<string, unknown>);
  },
  listTasks() {
    return callNative<TaskListResponse>("listTasks");
  },
  listWorkspaceProjects() {
    return callNative<WorkspaceProjectListResponse>("listWorkspaceProjects");
  },
  saveTask(task: AxiTodoTask) {
    return callNative<AxiTodoTask>("saveTask", { task });
  },
  deleteTask(id: string) {
    return callNative<AxiTodoTask>("deleteTask", { id });
  },
  updateStatus(id: string, status: AxiTaskStatus) {
    return callNative<AxiTodoTask>("updateStatus", { id, status });
  },
};
