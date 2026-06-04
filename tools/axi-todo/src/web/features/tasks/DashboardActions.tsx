import { AxiIconButton, AxiSvgIcon } from "@axi/core";
import { AxiSelect } from "@axi/widgets";
import { exportFormatOptions } from "../../app/constants";
import type { ExportFormat, RouteKey, StatusFilter } from "../../app/types";

export function DashboardBreadcrumbActions({
  activeRoute,
  exportFormat,
  projectFilter,
  projectOptions,
  statusFilter,
  statusFilterOptions,
  todoItemsCount,
  onClearItems,
  onCopyItems,
  onCreateTask,
  onExportFormatChange,
  onProjectFilterChange,
  onStatusFilterChange,
  onTableToolbarContainerChange,
}: {
  activeRoute: RouteKey;
  exportFormat: ExportFormat;
  projectFilter: string;
  projectOptions: Array<{ label: string; value: string }>;
  statusFilter: StatusFilter;
  statusFilterOptions: Array<{ label: string; value: StatusFilter }>;
  todoItemsCount: number;
  onClearItems: () => void;
  onCopyItems: () => void;
  onCreateTask: () => void;
  onExportFormatChange: (value: ExportFormat) => void;
  onProjectFilterChange: (value: string) => void;
  onStatusFilterChange: (value: StatusFilter) => void;
  onTableToolbarContainerChange: (element: HTMLDivElement | null) => void;
}) {
  if (activeRoute === "items") {
    return (
      <div className="todo-breadcrumb-actions">
        <AxiSelect
          className="todo-items-format"
          options={exportFormatOptions}
          size="small"
          value={exportFormat}
          onChange={onExportFormatChange}
        />
        <AxiIconButton
          disabled={!todoItemsCount}
          icon={<AxiSvgIcon name="export" size={14} />}
          title="复制待办事项"
          variant="primary"
          onClick={onCopyItems}
        />
        <AxiIconButton
          disabled={!todoItemsCount}
          icon={<AxiSvgIcon name="recycle-bin" size={14} />}
          title="清空待办事项"
          variant="danger"
          onClick={onClearItems}
        />
      </div>
    );
  }

  return (
    <div className="todo-breadcrumb-actions">
      <AxiSelect className="status-filter" options={statusFilterOptions} size="small" value={statusFilter} onChange={onStatusFilterChange} />
      <AxiSelect className="project-filter" options={projectOptions} size="small" value={projectFilter} onChange={onProjectFilterChange} />
      <div className="todo-breadcrumb-table-toolbar" ref={onTableToolbarContainerChange} />
      <AxiIconButton icon={<AxiSvgIcon name="plus" size={14} />} title="新增任务" variant="primary" onClick={onCreateTask} />
    </div>
  );
}
