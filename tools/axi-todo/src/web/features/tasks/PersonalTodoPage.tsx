import { Empty, Input, type InputRef } from "antd";
import { AxiIconButton, AxiSvgIcon } from "@axi/core";
import { AxiDatePicker } from "@axi/widgets";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AxiTodoTask } from "../../native";
import { formatTime } from "./taskUtils";

type PersonalView = "today" | "open" | "completed";
type ActivityEntry = {
  id?: string;
  actor?: string;
  at?: string;
  event?: string;
  message?: string;
};

const activityLabels: Record<string, string> = {
  completed: "已完成",
  created: "已创建",
  edited: "已编辑",
  reminder_snoozed: "已延后提醒",
  reopened: "已恢复",
  status_updated: "状态已更新",
};

function dateKey(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleDateString("sv-SE");
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE");
}

function yesterdayKey() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toLocaleDateString("sv-SE");
}

function isOpenTask(task: AxiTodoTask) {
  return task.lifecycleStatus === "open" && task.status !== "completed" && task.status !== "cancelled";
}

function dueValue(task: AxiTodoTask) {
  return task.dueAt || task.dueDate;
}

function dateValue(date: Dayjs | null) {
  return date?.isValid() ? date.toISOString() : undefined;
}

function dateOnlyValue(date: Dayjs | null) {
  return date?.isValid() ? date.format("YYYY-MM-DD") : undefined;
}

export function PersonalTodoPage({
  loading,
  addSignal = 0,
  onCreate,
  onRefresh,
  onSnooze,
  onUpdateStatus,
  tasks,
}: {
  addSignal?: number;
  loading: boolean;
  onCreate: (input: { body?: string; dueDate?: string; dueAt?: string; remindAt?: string; title: string }) => Promise<unknown>;
  onRefresh: () => Promise<void>;
  onSnooze: (id: string) => Promise<void>;
  onUpdateStatus: (id: string, status: AxiTodoTask["status"]) => Promise<void>;
  tasks: AxiTodoTask[];
}) {
  const [view, setView] = useState<PersonalView>("today");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState<string>();
  const [dueAt, setDueAt] = useState<string>();
  const [remindAt, setRemindAt] = useState<string>();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const titleInputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (addSignal > 0) titleInputRef.current?.focus();
  }, [addSignal]);

  const personalTasks = useMemo(
    () => tasks.filter((task) => task.taskDomain === "personal"),
    [tasks],
  );
  const today = todayKey();

  const visibleTasks = useMemo(() => {
    if (view === "completed") {
      return personalTasks
        .filter((task) => task.lifecycleStatus === "completed" || task.status === "completed")
        .sort((left, right) => String(right.completedAt || right.updatedAt).localeCompare(String(left.completedAt || left.updatedAt)));
    }

    const openTasks = personalTasks.filter(isOpenTask);
    if (view === "today") {
      return openTasks
        .filter((task) => {
          const dueDay = dateKey(dueValue(task));
          return Boolean(dueDay && dueDay <= today);
        })
        .sort((left, right) => String(dueValue(left) || "").localeCompare(String(dueValue(right) || "")));
    }
    return openTasks.sort((left, right) => {
      const leftDue = dueValue(left) ? Date.parse(dueValue(left) as string) : Number.POSITIVE_INFINITY;
      const rightDue = dueValue(right) ? Date.parse(dueValue(right) as string) : Number.POSITIVE_INFINITY;
      return leftDue - rightDue || left.createdAt.localeCompare(right.createdAt);
    });
  }, [personalTasks, today, view]);

  const groupedTasks = useMemo(() => {
    if (view === "completed") {
      const groups = new Map<string, AxiTodoTask[]>();
      visibleTasks.forEach((task) => {
        const completedDay = dateKey(task.completedAt || task.updatedAt) || "earlier";
        const key = completedDay === today ? "今天完成" : completedDay === yesterdayKey() ? "昨天完成" : "更早完成";
        groups.set(key, [...(groups.get(key) || []), task]);
      });
      return Array.from(groups, ([label, groupTasks]) => ({ label, tasks: groupTasks }));
    }

    const groups = new Map<string, AxiTodoTask[]>();
    visibleTasks.forEach((task) => {
      const dueDay = dateKey(dueValue(task));
      const label = !dueDay ? "无日期" : dueDay < today ? "逾期" : dueDay === today ? "今天" : "即将到期";
      groups.set(label, [...(groups.get(label) || []), task]);
    });
    const order = view === "today" ? ["逾期", "今天"] : ["逾期", "今天", "即将到期", "无日期"];
    return order.filter((label) => groups.has(label)).map((label) => ({ label, tasks: groups.get(label) || [] }));
  }, [today, view, visibleTasks]);

  async function submit() {
    const cleanTitle = title.trim();
    if (!cleanTitle) return;
    await onCreate({
      body: body.trim() || undefined,
      dueDate,
      dueAt,
      remindAt,
      title: cleanTitle,
    });
    setTitle("");
    setBody("");
    setDueDate(undefined);
    setDueAt(undefined);
    setRemindAt(undefined);
  }

  return (
    <section className="personal-todo-page" aria-label="个人待办">
      <header className="personal-todo-header">
        <div>
          <h1>个人待办</h1>
        </div>
        <div className="personal-todo-header-actions">
          <span>{personalTasks.filter(isOpenTask).length} 项待处理</span>
          <AxiIconButton icon={<AxiSvgIcon name="refresh" size={14} />} title="刷新个人待办" onClick={() => void onRefresh()} />
        </div>
      </header>

      <div className="personal-todo-quick-add">
        <div className="personal-todo-quick-row">
          <Input
            aria-label="待办标题"
            className="personal-todo-title-input"
            ref={titleInputRef}
            placeholder="添加待办"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onPressEnter={() => void submit()}
          />
          <AxiIconButton
            disabled={!title.trim()}
            icon={<AxiSvgIcon name="plus" size={15} />}
            title="添加待办"
            variant="primary"
            onClick={() => void submit()}
          />
        </div>
        <div className="personal-todo-quick-meta">
          <Input
            aria-label="待办备注"
            placeholder="备注（可选）"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <AxiDatePicker
            allowClear
            aria-label="截止时间"
            format="MM月DD日 HH:mm"
            placeholder="截止时间"
            showTime={{ format: "HH:mm" }}
            value={dueAt ? dayjs(dueAt) : null}
            onChange={(date) => {
              const nextDate = date as Dayjs | null;
              setDueDate(dateOnlyValue(nextDate));
              setDueAt(dateValue(nextDate));
            }}
          />
          <AxiDatePicker
            allowClear
            aria-label="提醒时间"
            format="MM月DD日 HH:mm"
            placeholder="提醒时间"
            showTime={{ format: "HH:mm" }}
            value={remindAt ? dayjs(remindAt) : null}
            onChange={(date) => setRemindAt(dateValue(date as Dayjs | null))}
          />
        </div>
      </div>

      <nav className="personal-todo-tabs" aria-label="待办视图">
        {([
          ["today", "今天"],
          ["open", "待处理"],
          ["completed", "已完成"],
        ] as const).map(([key, label]) => (
          <button className={view === key ? "is-active" : ""} key={key} type="button" onClick={() => setView(key)}>
            {label}
        <span>{key === "completed" ? personalTasks.filter((task) => task.lifecycleStatus === "completed" || task.status === "completed").length : key === "today" ? personalTasks.filter((task) => isOpenTask(task) && Boolean(dateKey(dueValue(task)) && (dateKey(dueValue(task)) as string) <= today)).length : personalTasks.filter(isOpenTask).length}</span>
          </button>
        ))}
      </nav>

      <div className="personal-todo-list" aria-busy={loading}>
        {!groupedTasks.length ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={view === "completed" ? "还没有完成记录" : view === "today" ? "今天没有需要行动的待办" : "没有待处理的待办"} />
        ) : groupedTasks.map((group) => (
          <section className="personal-todo-group" key={group.label}>
            <h2>{group.label}<span>{group.tasks.length}</span></h2>
            {group.tasks.map((task) => {
              const expanded = expandedId === task.id;
              const activity = (Array.isArray(task.history) ? task.history : []) as ActivityEntry[];
              const completed = task.lifecycleStatus === "completed" || task.status === "completed";
              return (
                <article className={`personal-todo-row ${completed ? "is-completed" : ""}`} key={task.id}>
                  <button
                    aria-label={completed ? `恢复 ${task.title}` : `完成 ${task.title}`}
                    className="personal-todo-check"
                    title={completed ? "恢复待办" : "完成待办"}
                    type="button"
                    onClick={() => void onUpdateStatus(task.id, completed ? "pending" : "completed")}
                  >
                    <AxiSvgIcon name={completed ? "admin-check" : "admin-circle-check"} size={17} />
                  </button>
                  <button className="personal-todo-main" type="button" onClick={() => setExpandedId(expanded ? null : task.id)}>
                    <strong>{task.title}</strong>
                    {task.body ? <span className="personal-todo-body">{task.body}</span> : null}
                    <span className="personal-todo-meta">
                      {dueValue(task) ? <><AxiSvgIcon name="admin-calendar" size={13} />{formatTime(dueValue(task) as string)}</> : <span>无截止时间</span>}
                      {task.remindAt && !completed ? <><AxiSvgIcon name="admin-alarm-clock" size={13} />{formatTime(task.remindAt)}</> : null}
                    </span>
                  </button>
                  <div className="personal-todo-actions">
                    {!completed ? <AxiIconButton icon={<AxiSvgIcon name="admin-time" size={15} />} title="15 分钟后提醒" onClick={() => void onSnooze(task.id)} /> : null}
                    <AxiIconButton icon={<AxiSvgIcon name="admin-history" size={15} />} title={expanded ? "收起活动记录" : "查看活动记录"} onClick={() => setExpandedId(expanded ? null : task.id)} />
                  </div>
                  {expanded ? (
                    <div className="personal-todo-activity" aria-label="活动记录">
                      {activity.length ? activity.slice().reverse().map((entry, index) => (
                        <div className="personal-todo-activity-row" key={`${entry.at}-${entry.event}-${index}`}>
                          <span>{activityLabels[entry.event || ""] || entry.event || "活动"}</span>
                          <span>{entry.message || ""}</span>
                          <time>{entry.at ? formatTime(entry.at) : ""}</time>
                        </div>
                      )) : <span className="muted-text">暂无活动记录</span>}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </section>
  );
}
