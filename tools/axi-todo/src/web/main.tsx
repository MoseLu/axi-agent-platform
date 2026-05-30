import "antd/dist/reset.css";
import "@axi/tokens/css";
import "@axi/core/styles.css";
import "@axi/widgets/styles.css";
import "@axi/shell/styles.css";
import "@axi/crud/styles.css";
import "@axi/settings/styles.css";
import "./styles.css";

import { Button, ConfigProvider, Empty, Input, InputNumber, Modal, Space, Typography, message, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { AxiIconButton, AxiLogoMark, AxiSvgIcon, AxiTag, AxiThemeProvider, createAxiAntdTheme, useAxiTheme, type AxiIconName, type AxiTagType } from "@axi/core";
import { AxiDashboardShell, AxiGlobalSearch, AxiGlobalSearchTrigger, type AxiDashboardAvatarConfig, type AxiDashboardNavGroup } from "@axi/shell";
import { AxiDialog, AxiTable, AxiTableActions, AxiTableButton, type AxiTableColumn } from "@axi/crud";
import { AxiSettingsCompactRow, AxiSettingsPanel, AxiSettingsSection, AxiSettingsThemeSection } from "@axi/settings";
import { AxiDatePicker, AxiSelect } from "@axi/widgets";
import dayjs from "dayjs";
import React, { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { native, type AxiTaskStatus, type AxiTodoTask, type AxiWorkspaceProject } from "./native";

const workspaceRoot = "/Volumes/code/workspace";
const draftPrompt = "待填写";

const statusOptions = [
  { color: "blue", label: "待处理", value: "pending" },
  { color: "gold", label: "运行中", value: "running" },
  { color: "green", label: "已完成", value: "completed" },
  { color: "red", label: "失败", value: "failed" },
  { color: "purple", label: "存疑", value: "blocked" },
  { color: "info", label: "已取消", value: "cancelled" },
] satisfies Array<{ color: AxiTagType; label: string; value: AxiTaskStatus }>;

type ProjectSelectOption = {
  label: string;
  title: string;
  value: string;
};

type StatusFilter = AxiTaskStatus | "all";

function AxiTodoApp() {
  return (
    <AxiThemeProvider defaultPreference="dark" storageNamespace="axi-todo-dashboard">
      <TodoThemeSurface>
        <TodoTable />
      </TodoThemeSurface>
    </AxiThemeProvider>
  );
}

function TodoThemeSurface({ children }: { children: ReactNode }) {
  const { mode, preset } = useAxiTheme();
  const antdTheme = useMemo(() => ({
    algorithm: mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
    ...createAxiAntdTheme(mode, preset, {
      borderRadius: 6,
      token: {
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      },
    }),
  }), [mode, preset]);

  return (
    <ConfigProvider button={{ autoInsertSpace: false }} locale={zhCN} theme={antdTheme}>
      {children}
    </ConfigProvider>
  );
}

function TodoTable() {
  const { mode, preference, setPreference, toggleMode } = useAxiTheme();
  const [tasks, setTasks] = useState<AxiTodoTask[]>([]);
  const [workspaceProjects, setWorkspaceProjects] = useState<AxiWorkspaceProject[]>([{ label: "workspace", path: workspaceRoot }]);
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [compact, setCompact] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTask, setDraftTask] = useState<AxiTodoTask | null>(null);
  const [loading, setLoading] = useState(false);
  const [tableToolbarContainer, setTableToolbarContainer] = useState<HTMLDivElement | null>(null);
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setGlobalSearchOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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

  const projectOptions = useMemo(() => {
    const projects = new Map<string, string>();
    tasks.forEach((task) => projects.set(projectKey(task.cwd), projectLabel(task.cwd)));
    return [
      { label: "全部项目", value: "all" },
      ...Array.from(projects, ([value, label]) => ({ label, value })).sort((left, right) => left.label.localeCompare(right.label)),
    ];
  }, [tasks]);

  const statusFilterOptions = useMemo(() => [
    { label: "全部状态", value: "all" as StatusFilter },
    ...statusOptions.map((option) => ({ label: option.label, value: option.value as StatusFilter })),
  ], []);

  const projectSelectOptions = useMemo<ProjectSelectOption[]>(() => {
    const byPath = new Map<string, ProjectSelectOption>();
    const addProject = (path: string, label = projectLabel(path)) => {
      const value = path.trim();
      if (!value || byPath.has(value)) return;
      byPath.set(value, { label, title: value, value });
    };

    workspaceProjects.forEach((project) => addProject(project.path, project.label));
    tasks.forEach((task) => addProject(task.cwd));

    return Array.from(byPath.values()).sort((left, right) => {
      if (left.value === workspaceRoot) return -1;
      if (right.value === workspaceRoot) return 1;
      return left.label.localeCompare(right.label);
    });
  }, [tasks, workspaceProjects]);

  const avatarConfig = useMemo<AxiDashboardAvatarConfig>(() => ({
    avatar: <AxiSvgIcon name="my" size={16} />,
    description: "本地桌面任务",
    label: "管理员",
    menuItems: [
      {
        iconName: "refresh",
        key: "refresh",
        label: "刷新",
        onClick: () => {
          void refresh();
        },
      },
      {
        iconName: "settings",
        key: "settings",
        label: "设置",
        onClick: () => {
          setSettingsOpen(true);
        },
      },
    ],
    name: "管理员",
  }), [refresh]);

  const navGroups = useMemo<AxiDashboardNavGroup[]>(() => [
    {
      children: projectOptions.map((option) => ({
        iconName: (option.value === "all" ? "list" : "folder") as AxiIconName,
        key: option.value,
        label: option.label,
      })),
      iconName: "folder",
      key: "projects",
      label: "项目",
    },
  ], [projectOptions]);

  useEffect(() => {
    if (projectFilter !== "all" && !projectOptions.some((option) => option.value === projectFilter)) {
      setProjectFilter("all");
    }
  }, [projectFilter, projectOptions]);

  const visibleTasks = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return tasks.filter((task) => {
      if (projectFilter !== "all" && projectKey(task.cwd) !== projectFilter) return false;
      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      if (!query) return true;
      return [task.title, task.prompt, task.cwd, task.status, task.summary, task.error]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [projectFilter, searchText, statusFilter, tasks]);

  const editingTask = useMemo(() => draftTask || tasks.find((task) => task.id === editingId) || null, [draftTask, editingId, tasks]);
  const latestUpdate = useMemo(() => {
    const latest = visibleTasks.map((task) => task.updatedAt).sort().at(-1);
    return latest ? formatTime(latest) : "-";
  }, [visibleTasks]);
  const topbarActions = useMemo(() => ({
    github: {
      iconName: "github" as AxiIconName,
      key: "github",
      label: "GitHub",
      onClick: () => message.info("当前本地仓库未配置 GitHub remote"),
    },
    notice: {
      badge: tasks.filter((task) => task.status === "failed" || task.status === "blocked").length || undefined,
      badgeTone: "warning" as const,
      iconName: "notice" as AxiIconName,
      key: "notice",
      label: "通知",
      popover: (
        <div className="todo-topbar-panel">
          <strong>任务通知</strong>
          <span>{tasks.filter((task) => task.status === "failed" || task.status === "blocked").length ? "有任务需要处理" : "当前没有异常任务"}</span>
        </div>
      ),
    },
    message: {
      iconName: "msg" as AxiIconName,
      key: "message",
      label: "消息",
      popover: (
        <div className="todo-topbar-panel">
          <strong>执行消息</strong>
          <span>当前共 {tasks.length} 个本地任务</span>
        </div>
      ),
    },
    language: {
      iconName: "lang" as AxiIconName,
      key: "language",
      label: "语言",
      popover: (
        <div className="todo-topbar-panel is-compact">
          <span className="is-active">简体中文</span>
        </div>
      ),
    },
    theme: {
      iconName: (mode === "dark" ? "light" : "dark") as AxiIconName,
      key: "theme",
      label: mode === "dark" ? "切换亮色模式" : "切换暗色模式",
      onClick: (event: MouseEvent<HTMLElement>) => toggleMode(event.currentTarget),
    },
    settings: {
      iconName: "theme" as AxiIconName,
      key: "settings",
      label: "设置",
      onClick: () => setSettingsOpen(true),
    },
  }), [mode, tasks, toggleMode]);
  const globalSearchItems = useMemo(() => visibleTasks.map((task) => ({
    description: `${projectLabel(task.cwd)} · ${formatTime(task.updatedAt)}`,
    icon: <AxiSvgIcon name="task" size={16} />,
    key: task.id,
    label: task.title,
    title: task.title,
    onClick: () => {
      setDraftTask(null);
      setEditingId(task.id);
      setGlobalSearchOpen(false);
    },
  })), [visibleTasks]);
  const globalSearchNode = useMemo(() => (
    <>
      <AxiGlobalSearchTrigger
        icon={<AxiSvgIcon name="search" size={15} />}
        shortcut="Ctrl K"
        onClick={() => setGlobalSearchOpen(true)}
      >
        搜索
      </AxiGlobalSearchTrigger>
      <AxiGlobalSearch
        footer={<span>共 {globalSearchItems.length} 个任务</span>}
        items={globalSearchItems}
        open={globalSearchOpen}
        placeholder="搜索任务"
        title="Todo 搜索"
        value={searchText}
        onChange={setSearchText}
        onOpenChange={setGlobalSearchOpen}
        onSearch={(value) => setSearchText(value)}
      />
    </>
  ), [globalSearchItems, globalSearchOpen, searchText]);

  const columns = useMemo<AxiTableColumn<AxiTodoTask>[]>(() => [
    {
      align: "center",
      alwaysVisible: true,
      dataIndex: "status",
      fixed: "left",
      key: "status",
      title: "状态",
      width: 106,
      render: (value: AxiTaskStatus) => {
        const option = statusOptions.find((item) => item.value === value) || statusOptions[0];
        return (
          <AxiTag className="todo-status-chip" effect="light" round type={option.color}>
            <span className="todo-status-dot" />
            {option.label}
          </AxiTag>
        );
      },
    },
    {
      align: "center",
      dataIndex: "title",
      fixed: "left",
      key: "title",
      title: "标题",
      width: 282,
      render: (value: string, row: AxiTodoTask) => (
        <div className="title-cell">
          <strong>{value}</strong>
          {row.error ? <span>{row.error}</span> : null}
        </div>
      ),
    },
    {
      align: "center",
      dataIndex: "prompt",
      key: "prompt",
      title: "内容",
      width: 400,
      render: (value: string) => <span className="prompt-preview">{value}</span>,
    },
    {
      align: "center",
      dataIndex: "cwd",
      key: "cwd",
      title: "项目",
      width: 198,
      render: (value: string) => (
        <div className="project-cell">
          <strong>{projectLabel(value)}</strong>
          <span>{value}</span>
        </div>
      ),
    },
    {
      align: "center",
      dataIndex: "updatedAt",
      key: "updatedAt",
      title: "更新",
      width: 132,
      render: (value: string) => <Typography.Text className="muted-text timestamp-text">{formatTime(value)}</Typography.Text>,
    },
    {
      align: "center",
      alwaysVisible: true,
      fixed: "right",
      key: "actions",
      title: "操作",
      width: 188,
      render: (_: unknown, row: AxiTodoTask) => (
        <AxiTableActions>
          <AxiTableButton
            icon={<AxiSvgIcon name="edit" size={14} />}
            label="编辑"
            tone="primary"
            onClick={(event) => {
              event.stopPropagation();
              setEditingId(row.id);
            }}
          />
          {row.status === "completed" ? (
            <AxiTableButton
              icon={<AxiSvgIcon name="warn" size={14} />}
              label="存疑"
              tone="warning"
              onClick={(event) => markDoubted(row.id, event)}
            />
          ) : null}
          {row.status === "running" ? null : (
            <AxiTableButton
              icon={<AxiSvgIcon name="delete" size={14} />}
              label="删除"
              tone="danger"
              onClick={(event) => deleteTask(row.id, event)}
            />
          )}
        </AxiTableActions>
      ),
    },
  ], [deleteTask, markDoubted]);

  return (
    <AxiDashboardShell
      activeNavKey={projectFilter}
      activeTabKey="tasks"
      brand={{
        className: "todo-sidebar-brand",
        logo: <AxiLogoMark className="todo-sidebar-logo" size={24} />,
        title: "Axi Todo",
      }}
      avatarConfig={avatarConfig}
      breadcrumbActions={(
        <div className="todo-breadcrumb-actions">
          <AxiSelect className="status-filter" options={statusFilterOptions} size="small" value={statusFilter} onChange={setStatusFilter} />
          <AxiSelect className="project-filter" options={projectOptions} size="small" value={projectFilter} onChange={setProjectFilter} />
          <div className="todo-breadcrumb-table-toolbar" ref={setTableToolbarContainer} />
          <AxiIconButton icon={<AxiSvgIcon name="plus" size={14} />} title="新增任务" variant="primary" onClick={createTask} />
        </div>
      )}
      breadcrumbs={[
        { icon: <AxiSvgIcon name="app" size={14} />, key: "axi", label: "Axi 应用" },
        { current: true, icon: <AxiSvgIcon name="task" size={14} />, key: "todo", label: "Todo" },
      ]}
      className="todo-dashboard-shell"
      globalSearch={globalSearchNode}
      labels={{
        github: "GitHub",
        settings: "设置",
        sidebarCollapse: "收起侧栏",
        sidebarExpand: "展开侧栏",
        theme: "切换主题",
      }}
      navGroups={navGroups}
      pageProps={{ fluid: true, padded: true }}
      sidebarCollapsed={sidebarCollapsed}
      sidebarSearchPlaceholder="搜索任务"
      sidebarSearchValue={searchText}
      tabbarLeftActions={(
        <div className="todo-tabbar-actions">
          <AxiIconButton icon={<AxiSvgIcon name="refresh" size={14} />} title="刷新任务" onClick={() => void refresh()} />
          <AxiIconButton icon={<AxiSvgIcon name="home" size={14} />} title="重置筛选" onClick={() => {
            setSearchText("");
            setProjectFilter("all");
            setStatusFilter("all");
          }} />
        </div>
      )}
      tabs={[{ key: "tasks", label: "Todo", pinned: true }]}
      topbarActions={topbarActions}
      onNavSelect={(key) => setProjectFilter(key)}
      onSidebarSearchChange={setSearchText}
      onSidebarToggle={() => setSidebarCollapsed((current) => !current)}
    >
      <main className="todo-surface">
        <section className="todo-table-panel">
          <AxiTable<AxiTodoTask>
            bordered
            className="todo-task-table"
            columns={columns}
            dataSource={visibleTasks}
            loading={loading}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有 Todo" /> }}
            pagination={false}
            rowKey="id"
            rowClassName={(row) => `task-row is-${row.status}`}
            scroll={{ x: 1250 }}
            size={compact ? "small" : "middle"}
            tableLayout="fixed"
            themedHorizontalScrollbar
            toolbar={{ storageKey: "axi-todo-table-v2", visible: true }}
            toolbarContainer={tableToolbarContainer}
            onRow={(row) => ({ onClick: () => setEditingId(row.id) })}
          />
          <footer className="todo-table-footer">
            <span>共 {visibleTasks.length} 个任务</span>
            <span>最近更新 {latestUpdate}</span>
          </footer>
        </section>

        <TaskEditor
          isNew={Boolean(draftTask)}
          projectOptions={projectSelectOptions}
          task={editingTask}
          onChange={patchTask}
          onClose={closeEditor}
          onSubmit={submitDraftTask}
        />
      </main>
      <AxiSettingsPanel
        className="todo-settings-panel"
        labels={{ title: "设置" }}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      >
        <AxiSettingsThemeSection
          labels={{ theme: "主题" }}
          value={preference}
          onChange={setPreference}
        />
        <AxiSettingsCompactRow
          checked={compact}
          labels={{ compact: "紧凑密度" }}
          onChange={setCompact}
        />
        <AxiSettingsSection title="概览">
          <div className="todo-settings-summary">
            <span>当前项目</span>
            <strong>{projectFilter === "all" ? "全部项目" : projectLabel(projectFilter)}</strong>
            <span>任务数量</span>
            <strong>{visibleTasks.length}/{tasks.length}</strong>
          </div>
        </AxiSettingsSection>
      </AxiSettingsPanel>
    </AxiDashboardShell>
  );
}

function TaskEditor({
  isNew,
  projectOptions,
  task,
  onChange,
  onClose,
  onSubmit,
}: {
  isNew: boolean;
  projectOptions: ProjectSelectOption[];
  task: AxiTodoTask | null;
  onChange: (id: string, patch: Partial<AxiTodoTask>) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const canSubmit = Boolean(task && task.title.trim() && task.prompt.trim() && !isDraftPrompt(task.prompt));
  return (
    <AxiDialog
      className="task-editor-dialog"
      controls={["fullscreen", "close"]}
      height="min(72vh, 680px)"
      footer={isNew ? (
        <div className="task-editor-footer">
          <Button onClick={onClose}>取消</Button>
          <Button disabled={!canSubmit} type="primary" onClick={onSubmit}>提交</Button>
        </div>
      ) : null}
      open={Boolean(task)}
      title={task ? (
        <Space size={8}>
          <StatusLabel status={task.status} />
          <span>{task.title || "新 Todo"}</span>
        </Space>
      ) : null}
      width={920}
      onClose={onClose}
    >
      {task ? (
        <div className="task-editor">
          <label className="editor-field editor-field--title">
            <span>标题</span>
            <Input
              status={!task.title.trim() ? "error" : undefined}
              value={task.title}
              onChange={(event) => onChange(task.id, { title: event.target.value })}
            />
          </label>

          <label className="editor-field editor-field--prompt">
            <span>Prompt</span>
            <Input.TextArea
              autoSize={false}
              status={!task.prompt.trim() ? "error" : undefined}
              value={task.prompt}
              onChange={(event) => onChange(task.id, { prompt: event.target.value })}
            />
          </label>

          <label className="editor-field">
            <span>工作目录</span>
            <AxiSelect
              className="editor-project-select"
              filterOption={(input: string, option?: ProjectSelectOption) => {
                const query = input.toLowerCase();
                return String(option?.label || "").toLowerCase().includes(query)
                  || String(option?.title || "").toLowerCase().includes(query);
              }}
              optionFilterProp="label"
              optionLabelProp="label"
              options={projectOptions}
              placeholder="选择工作目录"
              showSearch
              value={task.cwd}
              onChange={(cwd: string) => onChange(task.id, { cwd })}
            />
          </label>

          <label className="editor-field">
            <span>验证命令</span>
            <Input value={task.verifyCommand || ""} onChange={(event) => onChange(task.id, { verifyCommand: event.target.value })} />
          </label>

          <div className="editor-grid">
            <label className="editor-field">
              <span>到期时间</span>
              <AxiDatePicker
                format="YYYY-MM-DD HH:mm"
                showTime={{ format: "HH:mm" }}
                value={dayjs(task.dueAt)}
                onChange={(date: unknown) => onChange(task.id, { dueAt: (dayjs.isDayjs(date) ? date : dayjs()).toISOString() })}
              />
            </label>

            <label className="editor-field">
              <span>优先级</span>
              <InputNumber max={100} min={-100} value={task.priority} onChange={(next) => onChange(task.id, { priority: Number(next || 0) })} />
            </label>

            <label className="editor-field">
              <span>最大尝试</span>
              <InputNumber max={20} min={1} value={task.maxAttempts} onChange={(next) => onChange(task.id, { maxAttempts: Number(next || 1) })} />
            </label>

            <div className="editor-meta">
              <span>状态</span>
              <StatusLabel status={task.status} />
            </div>
          </div>
        </div>
      ) : null}
    </AxiDialog>
  );
}

function StatusLabel({ status }: { status: AxiTaskStatus }) {
  const option = statusOptions.find((item) => item.value === status) || statusOptions[0];
  return (
    <AxiTag className="todo-status-chip" effect="light" round type={option.color}>
      <span className="todo-status-dot" />
      {option.label}
    </AxiTag>
  );
}

function projectKey(cwd: string) {
  const normalized = cwd.replace(/\/+$/, "");
  const prefix = `${workspaceRoot}/projects/`;
  if (normalized === workspaceRoot) return workspaceRoot;
  if (normalized.startsWith(prefix)) {
    const [project] = normalized.slice(prefix.length).split("/");
    return project ? `${prefix}${project}` : workspaceRoot;
  }
  return normalized || cwd;
}

function projectLabel(cwd: string) {
  const key = projectKey(cwd);
  if (key === workspaceRoot) return "workspace";
  return key.split("/").filter(Boolean).at(-1) || key;
}

function formatTime(value: string) {
  const date = dayjs(value);
  return date.isValid() ? date.format("YYYY-MM-DD HH:mm") : value;
}

function createTaskDraft(): AxiTodoTask {
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

function applyTaskPatch(task: AxiTodoTask, patch: Partial<AxiTodoTask>) {
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

function isDraftPrompt(value: string) {
  return value.trim() === draftPrompt;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AxiTodoApp />
  </React.StrictMode>,
);
