import { Typography } from "antd";
import { AxiSvgIcon, AxiTag } from "@axi/core";
import { AxiTableActions, AxiTableButton, type AxiTableColumn } from "@axi/crud";
import { useMemo, type MouseEvent } from "react";
import { statusOptions } from "../../app/constants";
import type { AxiTaskStatus, AxiTodoTask } from "../../native";
import { formatTime, projectLabel } from "./taskUtils";

export function useTaskColumns({
  deleteTask,
  markDoubted,
  setEditingId,
}: {
  deleteTask: (id: string, event: MouseEvent) => void;
  markDoubted: (id: string, event: MouseEvent) => void;
  setEditingId: (id: string) => void;
}) {
  return useMemo<AxiTableColumn<AxiTodoTask>[]>(() => [
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
  ], [deleteTask, markDoubted, setEditingId]);
}
