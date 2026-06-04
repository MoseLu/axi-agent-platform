import { Button, Input, InputNumber, Space } from "antd";
import { AxiDialog } from "@axi/crud";
import { AxiDatePicker, AxiSelect } from "@axi/widgets";
import dayjs from "dayjs";
import type { ProjectSelectOption } from "../../app/types";
import type { AxiTodoTask } from "../../native";
import { StatusLabel } from "./StatusLabel";
import { isDraftPrompt } from "./taskUtils";

export function TaskEditor({
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
