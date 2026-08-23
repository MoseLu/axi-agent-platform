import { Modal, message } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { workspaceRoot } from "../../app/constants";
import { native, type AxiTodoTask, type AxiWorkspaceProject } from "../../native";
import { applyTaskPatch, createTaskDraft, isDraftPrompt } from "./taskUtils";

export function useTaskLedger() {
  const [tasks, setTasks] = useState<AxiTodoTask[]>([]);
  const [workspaceProjects, setWorkspaceProjects] = useState<AxiWorkspaceProject[]>([{ label: "workspace", path: workspaceRoot }]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTask, setDraftTask] = useState<AxiTodoTask | null>(null);
  const [loading, setLoading] = useState(false);
  const latestTasks = useRef(tasks);
  const saveTimers = useRef(new Map<string, number>());

  useEffect(() => {
    latestTasks.current = tasks;
  }, [tasks]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await native.listTasks();
      setTasks(response.tasks);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "读取任务失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    native.listWorkspaceProjects()
      .then((response) => {
        if (!cancelled && response.projects.length) setWorkspaceProjects(response.projects);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const replaceTask = useCallback((updated: AxiTodoTask) => {
    setTasks((current) => current.map((task) => task.id === updated.id ? updated : task));
  }, []);

  const saveNow = useCallback(async (id: string) => {
    const task = latestTasks.current.find((candidate) => candidate.id === id);
    if (!task || !task.title.trim() || !task.prompt.trim()) return;
    try {
      replaceTask(await native.saveTask(task));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "保存失败");
    }
  }, [replaceTask]);

  const scheduleSave = useCallback((id: string) => {
    const existing = saveTimers.current.get(id);
    if (existing) window.clearTimeout(existing);
    saveTimers.current.set(id, window.setTimeout(() => {
      saveTimers.current.delete(id);
      void saveNow(id);
    }, 550));
  }, [saveNow]);

  const patchTask = useCallback((id: string, patch: Partial<AxiTodoTask>) => {
    if (draftTask?.id === id) {
      setDraftTask((current) => current?.id === id ? applyTaskPatch(current, patch) : current);
      return;
    }
    setTasks((current) => current.map((task) => {
      if (task.id !== id) return task;
      return applyTaskPatch(task, patch);
    }));
    scheduleSave(id);
  }, [draftTask?.id, scheduleSave]);

  const createTask = useCallback(() => {
    setDraftTask(createTaskDraft());
    setEditingId(null);
  }, []);

  const createPersonalTask = useCallback(async ({
    body,
    dueDate,
    dueAt,
    remindAt,
    title,
  }: { body?: string; dueDate?: string; dueAt?: string; remindAt?: string; title: string }) => {
    const task = await native.createPersonalTask({
      body,
      dueDate,
      dueAt,
      lifecycleStatus: "open",
      prompt: title,
      remindAt,
      reminderState: remindAt ? "scheduled" : "none",
      taskDomain: "personal",
      title,
    });
    setTasks((current) => [task, ...current]);
    return task;
  }, []);

  const updateStatus = useCallback(async (id: string, status: AxiTodoTask["status"]) => {
    try {
      replaceTask(await native.updateStatus(id, status));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "更新状态失败");
    }
  }, [replaceTask]);

  const snoozeTask = useCallback(async (id: string) => {
    try {
      replaceTask(await native.snoozeTask(id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "稍后提醒失败");
    }
  }, [replaceTask]);

  const closeEditor = useCallback(() => {
    setDraftTask(null);
    setEditingId(null);
  }, []);

  const submitDraftTask = useCallback(async () => {
    if (!draftTask) return;
    if (!draftTask.title.trim()) {
      message.error("请填写标题");
      return;
    }
    if (!draftTask.prompt.trim() || isDraftPrompt(draftTask.prompt)) {
      message.error("请先填写 Prompt，再提交");
      return;
    }
    try {
      const task = await native.createTask({
        cwd: draftTask.cwd,
        dueAt: draftTask.dueAt,
        maxAttempts: draftTask.maxAttempts,
        priority: draftTask.priority,
        prompt: draftTask.prompt,
        title: draftTask.title,
        verifyCommand: draftTask.verifyCommand,
      });
      setTasks((current) => [task, ...current]);
      closeEditor();
      message.success("Todo 已提交");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "提交失败");
    }
  }, [closeEditor, draftTask]);

  const markDoubted = useCallback(async (id: string, event: MouseEvent) => {
    event.stopPropagation();
    try {
      replaceTask(await native.updateStatus(id, "blocked"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "标记存疑失败");
    }
  }, [replaceTask]);

  const deleteTask = useCallback((id: string, event: MouseEvent) => {
    event.stopPropagation();
    const task = latestTasks.current.find((candidate) => candidate.id === id);
    Modal.confirm({
      centered: true,
      cancelText: "取消",
      content: (
        <div className="todo-delete-confirm">
          <span>此操作会永久从本地任务列表中移除该 Todo。</span>
          <strong>{task?.title || id}</strong>
        </div>
      ),
      okButtonProps: { danger: true },
      okText: "删除",
      title: "删除这个 Todo？",
      onOk: async () => {
        try {
          await native.deleteTask(id);
          setTasks((current) => current.filter((item) => item.id !== id));
          if (editingId === id) setEditingId(null);
          if (draftTask?.id === id) setDraftTask(null);
          message.success("Todo 已删除");
        } catch (error) {
          message.error(error instanceof Error ? error.message : "删除失败");
          throw error;
        }
      },
    });
  }, [draftTask?.id, editingId]);

  const editingTask = useMemo(() => draftTask || tasks.find((task) => task.id === editingId) || null, [draftTask, editingId, tasks]);

  return {
    closeEditor,
    createTask,
    createPersonalTask,
    deleteTask,
    draftTask,
    editingTask,
    loading,
    markDoubted,
    patchTask,
    refresh,
    setEditingId,
    submitDraftTask,
    snoozeTask,
    tasks,
    updateStatus,
    workspaceProjects,
  };
}
