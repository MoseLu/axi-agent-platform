/**
 * TodoDashboard
 *
 * Renders three routing planes via the AxiDashboardShell tab bar:
 *  - "tasks"   → TaskListPage + TaskEditor  (agent tasks only, filtered by project/status)
 *  - "personal"→ PersonalTodoPage            (personal tasks only, self-filtered internally)
 *  - "items"   → TodoItemsPage               (draft checklist items, not persisted as tasks)
 *
 * Domain separation is enforced at the component boundary:
 *   • visibleTasks   = all tasks where taskDomain !== "personal"  (agent tasks)
 *   • PersonalTodoPage receives the raw `tasks` array and filters internally
 *     with `tasks.filter(task => task.taskDomain === "personal")`
 *
 * Topbar indicators (notice badge, total-count) intentionally operate on the
 * full `tasks` array to give a complete system-health picture. Global search
 * results are scoped to agent tasks only via `visibleTasks`.
 */
import { message } from "antd";
import { AxiLogoMark, useAxiTheme } from "@axi/core";
import { AxiIconButton, AxiSvgIcon } from "@axi/icons";

import { AxiDashboardShell } from "@axi/shell";
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { statusOptions, workspaceRoot } from "../../app/constants";
import { t } from "../../app/i18n";
import type { ExportFormat, ProjectSelectOption, RouteKey, StatusFilter, TodoDraftItem } from "../../app/types";
import { writeClipboardText } from "../../shared/clipboard";
import { focusTodoItem, TodoItemsPage } from "../todo-items/TodoItemsPage";
import { createTodoDraftItem, formatTodoItemsAsJson, formatTodoItemsAsMarkdown, getTodoItems } from "../todo-items/todoItems";
import { DashboardBreadcrumbActions } from "./DashboardActions";
import { TaskEditor } from "./TaskEditor";
import { TaskListPage } from "./TaskListPage";
import { PersonalTodoPage } from "./PersonalTodoPage";
import { TodoSettingsPanel } from "./TodoSettingsPanel";
import { formatTime, projectKey, projectLabel } from "./taskUtils";
import { useTaskColumns } from "./useTaskColumns";
import { isAgentTask, useTaskLedger } from "./useTaskLedger";
import { useTodoShellConfig } from "./useTodoShellConfig";

export function TodoDashboard() {
  const { mode, preference, setPreference, toggleMode } = useAxiTheme();
  const [activeRoute, setActiveRoute] = useState<RouteKey>("tasks");
  const [openRoutes, setOpenRoutes] = useState<RouteKey[]>(["tasks"]);
  const {
    closeEditor,
    createPersonalTask,
    createTask: createLedgerTask,
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
  } = useTaskLedger();
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [todoDrafts, setTodoDrafts] = useState<TodoDraftItem[]>(() => [createTodoDraftItem()]);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("markdown");
  const [compact, setCompact] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [personalAddSignal, setPersonalAddSignal] = useState(0);
  const [tableToolbarContainer, setTableToolbarContainer] = useState<HTMLDivElement | null>(null);
  const todoItems = useMemo(() => getTodoItems(todoDrafts), [todoDrafts]);
  const openRoute = useCallback((route: RouteKey) => {
    setOpenRoutes((current) => current.includes(route) ? current : [...current, route]);
    setActiveRoute(route);
  }, []);
  const closeRoute = useCallback((route: string) => {
    if (route !== "items") return;
    setOpenRoutes((current) => current.filter((item) => item !== route));
    setActiveRoute((current) => current === route ? "tasks" : current);
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

  const createTask = useCallback(() => {
    openRoute("tasks");
    createLedgerTask();
  }, [createLedgerTask, openRoute]);

  const requestPersonalAdd = useCallback(() => {
    openRoute("personal");
    setPersonalAddSignal((current) => current + 1);
  }, [openRoute]);

  const copyTodoItems = useCallback(async () => {
    if (!todoItems.length) {
      message.error(t("todo.copyEmptyError"));
      return;
    }

    const text = exportFormat === "json" ? formatTodoItemsAsJson(todoItems) : formatTodoItemsAsMarkdown(todoItems);
    try {
      await writeClipboardText(text);
      message.success(t("todo.copySuccess", { count: todoItems.length, format: exportFormat === "json" ? "JSON" : "Markdown" }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("todo.copyFailed"));
    }
  }, [exportFormat, todoItems]);

  const clearTodoItems = useCallback(() => {
    const draft = createTodoDraftItem();
    setTodoDrafts([draft]);
    requestAnimationFrame(() => focusTodoItem(draft.id));
  }, []);

  const projectOptions = useMemo(() => {
    const projects = new Map<string, string>();
    tasks.filter(isAgentTask).forEach((task) => projects.set(projectKey(task.cwd), projectLabel(task.cwd)));
    return [
      { label: t("todo.filterAllProjects"), value: "all" },
      ...Array.from(projects, ([value, label]) => ({ label, value })).sort((left, right) => left.label.localeCompare(right.label)),
    ];
  }, [tasks]);

  const statusFilterOptions = useMemo(() => [
    { label: t("todo.filterAllStatuses"), value: "all" as StatusFilter },
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
    tasks.filter(isAgentTask).forEach((task) => addProject(task.cwd));

    return Array.from(byPath.values()).sort((left, right) => {
      if (left.value === workspaceRoot) return -1;
      if (right.value === workspaceRoot) return 1;
      return left.label.localeCompare(right.label);
    });
  }, [tasks, workspaceProjects]);

  useEffect(() => {
    if (projectFilter !== "all" && !projectOptions.some((option) => option.value === projectFilter)) {
      setProjectFilter("all");
    }
  }, [projectFilter, projectOptions]);

  const visibleTasks = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return tasks.filter(isAgentTask).filter((task) => {
      if (projectFilter !== "all" && projectKey(task.cwd) !== projectFilter) return false;
      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      if (!query) return true;
      return [task.title, task.prompt, task.cwd, task.status, task.summary, task.error]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [projectFilter, searchText, statusFilter, tasks]);

  const latestUpdate = useMemo(() => {
    const latest = visibleTasks.map((task) => task.updatedAt).sort().at(-1);
    return latest ? formatTime(latest) : "-";
  }, [visibleTasks]);
  const handleThemeToggle = useCallback((event: MouseEvent<HTMLElement>) => {
    toggleMode(event.currentTarget);
  }, [toggleMode]);
  const { avatarConfig, globalSearchNode, navGroups, topbarActions } = useTodoShellConfig({
    closeEditor,
    globalSearchOpen,
    mode,
    refresh,
    searchText,
    tasks,
    visibleTasks,
    onEditingIdChange: setEditingId,
    onGlobalSearchOpenChange: setGlobalSearchOpen,
    onRouteChange: openRoute,
    onSearchTextChange: setSearchText,
    onSettingsOpen: () => setSettingsOpen(true),
    onThemeToggle: handleThemeToggle,
  });

  const columns = useTaskColumns({ deleteTask, markDoubted, setEditingId });

  // Compute workspace-level project summary (tasks grouped by project cwd)
  const workspaceProjectSummary = useMemo(() => {
    const summary = new Map<string, { label: string; count: number }>();
    tasks
      .filter(isAgentTask)
      .forEach((task) => {
        const key = projectKey(task.cwd);
        const label = projectLabel(task.cwd);
        const existing = summary.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          summary.set(key, { label, count: 1 });
        }
      });
    return Array.from(summary.values()).sort((a, b) => b.count - a.count);
  }, [tasks]);

  return (
    <AxiDashboardShell
      activeNavKey={activeRoute === "items" ? "route:items" : activeRoute === "personal" ? "route:personal" : "route:tasks"}
      activeTabKey={activeRoute}
      brand={{
        className: "todo-sidebar-brand",
        logo: <AxiLogoMark className="todo-sidebar-logo" size={24} />,
        title: t("shell.brand"),
      }}
      avatarConfig={avatarConfig}
      breadcrumbActions={(
        <DashboardBreadcrumbActions
          activeRoute={activeRoute}
          exportFormat={exportFormat}
          projectFilter={projectFilter}
          projectOptions={projectOptions}
          statusFilter={statusFilter}
          statusFilterOptions={statusFilterOptions}
          todoItemsCount={todoItems.length}
          onClearItems={clearTodoItems}
          onCopyItems={() => void copyTodoItems()}
          onCreateTask={activeRoute === "personal" ? requestPersonalAdd : createTask}
          onExportFormatChange={setExportFormat}
          onProjectFilterChange={setProjectFilter}
          onStatusFilterChange={setStatusFilter}
          onTableToolbarContainerChange={setTableToolbarContainer}
        />
      )}
      breadcrumbs={activeRoute === "items" ? [
        { icon: <AxiSvgIcon name="app" size={14} />, key: "axi", label: t("nav.axiApp") },
        { current: true, icon: <AxiSvgIcon name="list" size={14} />, key: "todo-items", label: t("nav.items") },
      ] : activeRoute === "personal" ? [
        { icon: <AxiSvgIcon name="app" size={14} />, key: "axi", label: t("nav.axiApp") },
        { current: true, icon: <AxiSvgIcon name="list" size={14} />, key: "personal-todo", label: t("nav.personal") },
      ] : [
        { icon: <AxiSvgIcon name="app" size={14} />, key: "axi", label: t("nav.axiApp") },
        { current: true, icon: <AxiSvgIcon name="task" size={14} />, key: "todo", label: t("nav.tasks") },
      ]}
      className="todo-dashboard-shell"
      globalSearch={globalSearchNode}
      labels={{
        github: t("topbar.github"),
        settings: t("topbar.settings"),
        sidebarCollapse: t("topbar.sidebarCollapse"),
        sidebarExpand: t("topbar.sidebarExpand"),
        theme: t("topbar.theme"),
      }}
      navGroups={navGroups}
      pageProps={{ fluid: true, padded: true }}
      sidebarCollapsed={sidebarCollapsed}
      sidebarSearchPlaceholder={t("search.placeholder")}
      sidebarSearchValue={searchText}
      tabbarLeftActions={activeRoute === "tasks" ? (
        <div className="todo-tabbar-actions">
          <AxiIconButton icon={<AxiSvgIcon name="refresh" size={14} />} title={t("todo.refreshTasks")} onClick={() => void refresh()} />
          <AxiIconButton icon={<AxiSvgIcon name="home" size={14} />} title={t("todo.resetFilters")} onClick={() => {
            setSearchText("");
            setProjectFilter("all");
            setStatusFilter("all");
          }} />
        </div>
      ) : activeRoute === "personal" ? (
        <div className="todo-tabbar-actions">
          <AxiIconButton icon={<AxiSvgIcon name="refresh" size={14} />} title={t("todo.refreshPersonal")} onClick={() => void refresh()} />
        </div>
      ) : null}
      tabs={openRoutes.map((route) => route === "items"
        ? { closable: true, key: route, label: t("nav.items") }
        : route === "personal" ? { key: route, label: t("nav.personal") }
        : { key: route, label: t("nav.tasks") })}
      topbarActions={topbarActions}
      onNavSelect={(key) => {
        if (key === "route:tasks") {
          openRoute("tasks");
          return;
        }
        if (key === "route:personal") {
          openRoute("personal");
          return;
        }
        if (key === "route:items") {
          openRoute("items");
        }
      }}
      onSidebarSearchChange={setSearchText}
      onSidebarToggle={() => setSidebarCollapsed((current) => !current)}
      onTabSelect={(key) => {
        if (key === "tasks" || key === "personal" || key === "items") setActiveRoute(key);
      }}
      onTabClose={closeRoute}
    >
      <main className="todo-surface">
        {activeRoute === "items" ? (
          <TodoItemsPage
            drafts={todoDrafts}
            exportFormat={exportFormat}
            parsedItems={todoItems}
            onDraftsChange={setTodoDrafts}
          />
        ) : activeRoute === "personal" ? (
          <PersonalTodoPage
            addSignal={personalAddSignal}
            loading={loading}
            tasks={tasks}
            onCreate={createPersonalTask}
            onRefresh={refresh}
            onSnooze={snoozeTask}
            onUpdateStatus={updateStatus}
          />
        ) : (
          <>
            <TaskListPage
              columns={columns}
              compact={compact}
              latestUpdate={latestUpdate}
              loading={loading}
              tableToolbarContainer={tableToolbarContainer}
              tasks={visibleTasks}
              onEdit={setEditingId}
            />
            <TaskEditor
              isNew={Boolean(draftTask)}
              projectOptions={projectSelectOptions}
              task={editingTask}
              onChange={patchTask}
              onClose={closeEditor}
              onSubmit={submitDraftTask}
            />
          </>
        )}
      </main>
      <TodoSettingsPanel
        compact={compact}
        open={settingsOpen}
        preference={preference}
        projectLabel={projectFilter === "all" ? t("todo.filterAllProjects") : projectLabel(projectFilter)}
        taskCount={visibleTasks.length}
        totalTaskCount={tasks.length}
        workspaceProjectSummary={workspaceProjectSummary}
        onCompactChange={setCompact}
        onOpenChange={setSettingsOpen}
        onPreferenceChange={setPreference}
      />
    </AxiDashboardShell>
  );
}
