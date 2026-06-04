import { message } from "antd";
import { AxiSvgIcon, type AxiIconName } from "@axi/core";
import { AxiGlobalSearch, AxiGlobalSearchTrigger, type AxiDashboardAvatarConfig, type AxiDashboardNavGroup } from "@axi/shell";
import { useMemo, type MouseEvent } from "react";
import type { RouteKey } from "../../app/types";
import type { AxiTodoTask } from "../../native";
import { formatTime, projectLabel } from "./taskUtils";

const navGroups: AxiDashboardNavGroup[] = [
  {
    children: [
      {
        iconName: "task",
        key: "route:tasks",
        label: "Todo",
      },
      {
        iconName: "list",
        key: "route:items",
        label: "待办事项",
      },
    ],
    iconName: "menu",
    key: "pages",
    label: "菜单",
  },
];

export function useTodoShellConfig({
  closeEditor,
  globalSearchOpen,
  mode,
  refresh,
  searchText,
  tasks,
  visibleTasks,
  onEditingIdChange,
  onGlobalSearchOpenChange,
  onRouteChange,
  onSearchTextChange,
  onSettingsOpen,
  onThemeToggle,
}: {
  closeEditor: () => void;
  globalSearchOpen: boolean;
  mode: string;
  refresh: () => Promise<void>;
  searchText: string;
  tasks: AxiTodoTask[];
  visibleTasks: AxiTodoTask[];
  onEditingIdChange: (id: string) => void;
  onGlobalSearchOpenChange: (open: boolean) => void;
  onRouteChange: (route: RouteKey) => void;
  onSearchTextChange: (text: string) => void;
  onSettingsOpen: () => void;
  onThemeToggle: (event: MouseEvent<HTMLElement>) => void;
}) {
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
        onClick: onSettingsOpen,
      },
    ],
    name: "管理员",
  }), [onSettingsOpen, refresh]);

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
      onClick: onThemeToggle,
    },
    settings: {
      iconName: "theme" as AxiIconName,
      key: "settings",
      label: "设置",
      onClick: onSettingsOpen,
    },
  }), [mode, onSettingsOpen, onThemeToggle, tasks]);

  const globalSearchItems = useMemo(() => visibleTasks.map((task) => ({
    description: `${projectLabel(task.cwd)} · ${formatTime(task.updatedAt)}`,
    icon: <AxiSvgIcon name="task" size={16} />,
    key: task.id,
    label: task.title,
    title: task.title,
    onClick: () => {
      onRouteChange("tasks");
      closeEditor();
      onEditingIdChange(task.id);
      onGlobalSearchOpenChange(false);
    },
  })), [closeEditor, onEditingIdChange, onGlobalSearchOpenChange, onRouteChange, visibleTasks]);

  const globalSearchNode = useMemo(() => (
    <>
      <AxiGlobalSearchTrigger
        icon={<AxiSvgIcon name="search" size={15} />}
        shortcut="Ctrl K"
        onClick={() => onGlobalSearchOpenChange(true)}
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
        onChange={onSearchTextChange}
        onOpenChange={onGlobalSearchOpenChange}
        onSearch={onSearchTextChange}
      />
    </>
  ), [globalSearchItems, globalSearchOpen, onGlobalSearchOpenChange, onSearchTextChange, searchText]);

  return { avatarConfig, globalSearchNode, navGroups, topbarActions };
}
