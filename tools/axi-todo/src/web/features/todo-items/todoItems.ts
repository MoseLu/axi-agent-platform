import type { TodoDraftItem, TodoItem } from "../../app/types";

export function createTodoDraftItem(text = ""): TodoDraftItem {
  return {
    id: crypto.randomUUID(),
    text,
  };
}

export function getTodoItems(drafts: TodoDraftItem[]) {
  return drafts
    .map((draft) => draft.text.trim())
    .filter(Boolean)
    .map<TodoItem>((text, index) => ({
      index: index + 1,
      text,
    }));
}

export function patchTodoDraftItem(drafts: TodoDraftItem[], id: string, text: string) {
  return drafts.map((draft) => draft.id === id ? { ...draft, text } : draft);
}

export function splitTodoDraftItem(drafts: TodoDraftItem[], id: string, selectionStart: number, selectionEnd: number) {
  const index = drafts.findIndex((draft) => draft.id === id);
  if (index < 0) return { drafts, nextId: null };

  const current = drafts[index];
  const next = createTodoDraftItem(current.text.slice(selectionEnd));
  return {
    drafts: [
      ...drafts.slice(0, index),
      { ...current, text: current.text.slice(0, selectionStart) },
      next,
      ...drafts.slice(index + 1),
    ],
    nextId: next.id,
  };
}

export function removeEmptyTodoDraftItem(drafts: TodoDraftItem[], id: string) {
  const index = drafts.findIndex((draft) => draft.id === id);
  if (index <= 0 || drafts[index].text) return { drafts, previousId: null };
  return {
    drafts: drafts.filter((draft) => draft.id !== id),
    previousId: drafts[index - 1].id,
  };
}

export function formatTodoItemsAsMarkdown(items: TodoItem[]) {
  return items.map((item, index) => {
    const [firstLine, ...restLines] = item.text.split("\n");
    return [
      `${index + 1}. ${firstLine}`,
      ...restLines.map((line) => `   ${line}`),
    ].join("\n");
  }).join("\n");
}

export function formatTodoItemsAsJson(items: TodoItem[]) {
  return JSON.stringify(items.map((item, index) => ({
    index: index + 1,
    text: item.text,
  })), null, 2);
}
