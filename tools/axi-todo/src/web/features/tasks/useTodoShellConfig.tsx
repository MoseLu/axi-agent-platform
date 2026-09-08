import { message } from "antd";
import { AxiSvgIcon, type AxiIconName } from "@axi/core";
import { AxiGlobalSearch, AxiGlobalSearchTrigger, type AxiDashboardAvatarConfig, type AxiDashboardNavGroup } from "@axi/shell";
import { useMemo, type MouseEvent } from "react";
import type { RouteKey } from "../../app/types";
import type { AxiTodoTask } from "../../native";
import { formatTime, projectLabel } from "./taskUtils";
import { t } from "../../app/i18n";

const navGroups: AxiDashboardNavGroup[] = [
  {
    children: [
      {
        iconName: "task",
        key: "route:tasks",
        label: t("nav.tasks"),
      },
      {
        iconName: "list",
        key: "route:personal",
        label: t("nav.personal"),
      },
      {
        iconName: "list",
        key: "route:items",
        label: t("nav.items"),
      },
    ],
    iconName: "menu",
    key: "pages",
    label: t("nav.menu"),
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
    description: t("avatar.localDesktop"),
    label: t("avatar.admin"),
    menuItems: [
      {
        iconName: "refresh",
        key: "refresh",
        label: t("action.refresh"),
        onClick: () => {
          void refresh();
        },
      },
      {
        iconName: "settings",
        key: "settings",
        label: t("action.settings"),
        onClick: onSettingsOpen,
      },
    ],
    name: t("avatar.admin"),
  }), [onSettingsOpen, refresh]);

  const topbarActions = useMemo(() => ({
    github: {
      iconName: "github" as AxiIconName,
      key: "github",
      label: t("topbar.github"),
      onClick: () => message.info("当前本地仓库未配置 GitHub remote"),
    },
    notice: {
      badge: tasks.filter((task) => task.status === "failed" || task.status === "blocked").length || undefined,
      badgeTone: "warning" as const,
      iconName: "notice" as AxiIconName,
      key: "notice",
      label: t("topbar.notice"),
      popover: (
        <div className="todo-topbar-panel">
          <strong>{t("panel.tasks")}</strong>
          <span>{tasks.filter((task) => task.status === "failed" || task.status === "blocked").length ? t("panel.hasIssues") : t("panel.noIssues")}</span>
        </div>
      ),
    },
    message: {
      iconName: "msg" as AxiIconName,
      key: "message",
      label: t("topbar.message"),
      popover: (
        <div className="todo-topbar-panel">
          <strong>{t("panel.messages")}</strong>
          <span>{t("panel.totalTasks", { count: tasks.length })}</span>
        </div>
      ),
    },
    language: {
      iconName: "lang" as AxiIconName,
      key: "language",
      label: t("topbar.language"),
      popover: (
        <div className="todo-topbar-panel is-compact">
          <span className="is-active">{t("panel.locale")}</span>
        </div>
      ),
    },
    theme: {
      iconName: (mode === "dark" ? "light" : "dark") as AxiIconName,
      key: "theme",
      label: mode === "dark" ? t("topbar.switchToLight") : t("topbar.switchToDark"),
      onClick: onThemeToggle,
    },
    settings: {
      iconName: "theme" as AxiIconName,
      key: "settings",
      label: t("topbar.settings"),
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
        footer={<span>{t("search.count", { count: globalSearchItems.length })}</span>}
        items={globalSearchItems}
        open={globalSearchOpen}
        placeholder={t("search.placeholder")}
        title={t("search.title")}
        value={searchText}
        onChange={onSearchTextChange}
        onOpenChange={onGlobalSearchOpenChange}
        onSearch={onSearchTextChange}
      />
    </>
  ), [globalSearchItems, globalSearchOpen, onGlobalSearchOpenChange, onSearchTextChange, searchText]);

  return { avatarConfig, globalSearchNode, navGroups, topbarActions };
}
