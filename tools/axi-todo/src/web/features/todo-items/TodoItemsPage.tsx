import { Input } from "antd";
import { useCallback, useEffect } from "react";
import type { ExportFormat, TodoDraftItem, TodoItem } from "../../app/types";
import { patchTodoDraftItem, removeEmptyTodoDraftItem, splitTodoDraftItem } from "./todoItems";

export function TodoItemsPage({
  drafts,
  exportFormat,
  parsedItems,
  onDraftsChange,
}: {
  drafts: TodoDraftItem[];
  exportFormat: ExportFormat;
  parsedItems: TodoItem[];
  onDraftsChange: (drafts: TodoDraftItem[]) => void;
}) {
  useEffect(() => {
    const frame = requestAnimationFrame(() => focusTodoItem(drafts[0]?.id));
    return () => cancelAnimationFrame(frame);
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>, id: string) => {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const target = event.currentTarget;
      const next = splitTodoDraftItem(drafts, id, target.selectionStart, target.selectionEnd);
      onDraftsChange(next.drafts);
      requestAnimationFrame(() => focusTodoItem(next.nextId));
      return;
    }

    if (event.key === "Backspace" && !event.currentTarget.value && drafts.length > 1) {
      event.preventDefault();
      const next = removeEmptyTodoDraftItem(drafts, id);
      onDraftsChange(next.drafts);
      requestAnimationFrame(() => focusTodoItem(next.previousId, true));
    }
  }, [drafts, onDraftsChange]);

  return (
    <section className="todo-items-page">
      <div className="todo-items-table">
        <div className="todo-items-head">
          <span>序号</span>
          <span>事项</span>
        </div>
        <div className="todo-items-body">
          {drafts.map((draft, index) => (
            <div className="todo-items-row" data-todo-item-id={draft.id} key={draft.id}>
              <span className="todo-items-index">{index + 1}</span>
              <Input.TextArea
                autoSize={{ minRows: 1, maxRows: 8 }}
                placeholder="输入待办事项"
                value={draft.text}
                onChange={(event) => onDraftsChange(patchTodoDraftItem(drafts, draft.id, event.target.value))}
                onKeyDown={(event) => handleKeyDown(event, draft.id)}
              />
            </div>
          ))}
        </div>
      </div>

      <footer className="todo-items-footer">
        <span>共 {parsedItems.length} 条</span>
        <span>{exportFormat === "json" ? "复制为 JSON" : "复制为 Markdown"}</span>
      </footer>
    </section>
  );
}

export function focusTodoItem(id?: string | null, cursorAtEnd = false) {
  if (!id) return;
  const textarea = document.querySelector<HTMLTextAreaElement>(`[data-todo-item-id="${id}"] textarea`);
  if (!textarea) return;
  textarea.focus();
  const cursor = cursorAtEnd ? textarea.value.length : 0;
  textarea.setSelectionRange(cursor, cursor);
}
