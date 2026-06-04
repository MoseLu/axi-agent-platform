import { Empty } from "antd";
import { AxiTable, type AxiTableColumn } from "@axi/crud";
import type { AxiTodoTask } from "../../native";

export function TaskListPage({
  columns,
  compact,
  latestUpdate,
  loading,
  tableToolbarContainer,
  tasks,
  onEdit,
}: {
  columns: AxiTableColumn<AxiTodoTask>[];
  compact: boolean;
  latestUpdate: string;
  loading: boolean;
  tableToolbarContainer: HTMLDivElement | null;
  tasks: AxiTodoTask[];
  onEdit: (id: string) => void;
}) {
  return (
    <section className="todo-table-panel">
      <AxiTable<AxiTodoTask>
        bordered
        className="todo-task-table"
        columns={columns}
        dataSource={tasks}
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
        onRow={(row) => ({ onClick: () => onEdit(row.id) })}
      />
      <footer className="todo-table-footer">
        <span>共 {tasks.length} 个任务</span>
        <span>最近更新 {latestUpdate}</span>
      </footer>
    </section>
  );
}
