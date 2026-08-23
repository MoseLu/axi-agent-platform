import type { AxiTaskStatus } from "../native";

export type ExportFormat = "markdown" | "json";
export type RouteKey = "tasks" | "personal" | "items";
export type StatusFilter = AxiTaskStatus | "all";

export type ProjectSelectOption = {
  label: string;
  title: string;
  value: string;
};

export type TodoItem = {
  index: number;
  text: string;
};

export type TodoDraftItem = {
  id: string;
  text: string;
};
